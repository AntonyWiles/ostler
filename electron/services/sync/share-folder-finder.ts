/**
 * Finding a shared folder on this PC by itself (people and devices, prompt 07, decision D2).
 *
 * Ostler never calls Google, OneDrive or Dropbox. The person shares the folder with
 * themselves in their provider; it then appears under a synced root on this PC. This
 * module lists those roots (`syncedRoots`) and searches them for the `share.json` whose
 * `shareId` is the one in the invite (`findShareFolder`). It reads nothing else. Both
 * take their file system calls as parameters, so tests run on a temp folder tree.
 */
import * as nodeFs from 'node:fs'
import * as path from 'node:path'
import type { SyncProvider } from '@shared/ostler-api'
import { shareFileFrom } from './sharing'

/** The file system calls the finder makes; `node:fs` satisfies it. */
export type FinderFs = Pick<
  typeof nodeFs,
  'existsSync' | 'readdirSync' | 'readFileSync' | 'statSync'
>

export interface FinderLimits {
  /** How many folders below a root to search (a root is depth 0). */
  maxDepth: number
  /** How many folders to look inside, in all. */
  maxFolders: number
  /** Gives up after this long. */
  timeoutMs: number
  fs: FinderFs
  now?: () => number
}

/** Limits for the search when a person joins (folders are cheap; a root can hold many). */
export const JOIN_FOLDER_LIMITS = { maxDepth: 5, maxFolders: 5000, timeoutMs: 20_000 } as const

/** A `share.json` is a few hundred bytes; anything bigger is not one. */
const MAX_SHARE_FILE_BYTES = 64 * 1024

/** Folders the search never looks inside: hidden ones, and Windows' own. */
const SKIPPED_NAMES = new Set(['$recycle.bin', 'system volume information'])

function isDirectory(fs: FinderFs, folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory()
  } catch {
    return false
  }
}

/** A synced provider's folder on this PC: where Ostler offers to keep things, and looks for them. */
export interface SyncPlace {
  provider: SyncProvider
  folder: string
}

/**
 * The folders where OneDrive, Google Drive and Dropbox keep a person's files on this PC, the ones
 * that exist, Google Drive first. One folder appears once, under the first provider that names it.
 */
export function syncPlaces(env: NodeJS.ProcessEnv, fs: FinderFs): SyncPlace[] {
  const candidates: SyncPlace[] = []
  const add = (provider: SyncProvider, folder: string) => candidates.push({ provider, folder })
  // Google Drive for desktop shows My Drive at a drive letter, or in a mirror folder.
  for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
    add('google-drive', `${String.fromCharCode(code)}:\\My Drive`)
  }
  if (env.USERPROFILE) {
    add('google-drive', path.join(env.USERPROFILE, 'My Drive'))
    add('google-drive', path.join(env.USERPROFILE, 'Google Drive'))
  }
  // The OneDrive client sets these while it is set up; its folders keep their default names otherwise.
  for (const name of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const root = env[name]
    if (root && path.isAbsolute(root)) add('onedrive', root)
  }
  for (const name of profileFolders(env, fs)) {
    if (name.toLowerCase() === 'onedrive' || name.toLowerCase().startsWith('onedrive - ')) {
      add('onedrive', path.join(env.USERPROFILE ?? '', name))
    }
  }
  // Dropbox keeps its folders in info.json under %LOCALAPPDATA% or %APPDATA%.
  for (const base of [env.LOCALAPPDATA, env.APPDATA]) {
    if (!base) continue
    for (const folder of dropboxFolders(path.join(base, 'Dropbox', 'info.json'), fs)) {
      add('dropbox', folder)
    }
  }
  if (env.USERPROFILE) add('dropbox', path.join(env.USERPROFILE, 'Dropbox'))
  const seen = new Set<string>()
  return candidates.filter(({ folder }) => {
    const key = path.resolve(folder).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return isDirectory(fs, folder)
  })
}

/** The folders where a synced provider keeps a person's files on this PC, if they exist. */
export function syncedRoots(env: NodeJS.ProcessEnv, fs: FinderFs): string[] {
  return syncPlaces(env, fs).map((place) => place.folder)
}

/** The names of the folders in the person's profile folder; none when it can't be read. */
function profileFolders(env: NodeJS.ProcessEnv, fs: FinderFs): string[] {
  if (!env.USERPROFILE) return []
  try {
    return fs
      .readdirSync(env.USERPROFILE, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** The `personal` and `business` folder paths in a Dropbox `info.json`. */
function dropboxFolders(infoFile: string, fs: FinderFs): string[] {
  try {
    const info = JSON.parse(fs.readFileSync(infoFile, 'utf8')) as Record<string, unknown>
    return ['personal', 'business'].flatMap((account) => {
      const entry = info[account] as { path?: unknown } | undefined
      return typeof entry?.path === 'string' && path.isAbsolute(entry.path) ? [entry.path] : []
    })
  } catch {
    return []
  }
}

/** Folders looked inside before the search gives the main process's event loop a turn. */
const FOLDERS_PER_TURN = 25

/**
 * Searches the roots, breadth first, for the folder whose `share.json` has `shareId`.
 * Returns the folder, or null when it is not found within the limits. It yields to the
 * event loop as it goes, so the app keeps responding while it looks.
 */
export async function findShareFolder(
  shareId: string,
  roots: readonly string[],
  limits: FinderLimits
): Promise<string | null> {
  const now = limits.now ?? Date.now
  const deadline = now() + limits.timeoutMs
  const { fs } = limits
  const queue = roots.map((root) => ({ folder: root, depth: 0 }))
  let examined = 0
  for (let index = 0; index < queue.length; index++) {
    if (examined >= limits.maxFolders || now() > deadline) break
    const { folder, depth } = queue[index]
    examined++
    if (examined % FOLDERS_PER_TURN === 0) await new Promise((resolve) => setImmediate(resolve))
    if (readShareId(fs, folder) === shareId) return folder
    if (depth >= limits.maxDepth) continue
    let entries
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      // Junctions and symbolic links are not followed: they could lead out of the root.
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue
      if (SKIPPED_NAMES.has(entry.name.toLowerCase())) continue
      queue.push({ folder: path.join(folder, entry.name), depth: depth + 1 })
    }
  }
  return null
}

/** The `shareId` in a folder's `share.json`, when the file is there and reads as one. */
function readShareId(fs: FinderFs, folder: string): string | null {
  const file = path.join(folder, 'share.json')
  try {
    if (!fs.existsSync(file)) return null
    if (fs.statSync(file).size > MAX_SHARE_FILE_BYTES) return null
    return shareFileFrom(fs.readFileSync(file, 'utf8'))?.shareId ?? null
  } catch {
    return null
  }
}
