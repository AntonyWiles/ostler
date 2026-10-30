import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { LEGACY_NAMES } from '@shared/legacy-names'

/**
 * The product was renamed from Nexus Dashboard to Ostler. This moves what
 * Nexus Dashboard kept on disk to Ostler's names, once, before anything opens
 * a file in the data folder: `main.ts` runs `moveLegacyDataFolder` before it
 * pins the data folder and takes the single-instance lock, and
 * `renameLegacyFiles` before it restores or migrates the database. Git refs in
 * project folders move later, after the first screen (`moveLegacyRefs`).
 */

/** Chromium's own state in the data folder: moved with it, never read here. */
const CHROMIUM_ENTRIES = new Set([
  'Cache',
  'Code Cache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GPUCache',
  'Local Storage',
  'Network',
  'Session Storage',
  'Shared Dictionary',
  'SharedStorage',
  'blob_storage',
  'node_modules'
])

export type DataFolderMove =
  | { kind: 'nothing' }
  | { kind: 'moved'; from: string; to: string }
  | { kind: 'failed'; from: string; to: string; error: string }

/**
 * Moves `<appData>/nexus-dashboard` to `<appData>/<dataFolderName>` when the
 * old folder exists and the new one does not. A data folder named by
 * OSTLER_USER_DATA or NEXUS_USER_DATA is the person's own choice and stays
 * where it is. Fails, leaving everything as it was, while Nexus Dashboard is
 * still running and holds files in the old folder.
 */
export function moveLegacyDataFolder(
  env: NodeJS.ProcessEnv,
  appDataPath: string,
  dataFolderName: string
): DataFolderMove {
  if (env.OSTLER_USER_DATA || env[LEGACY_NAMES.userDataEnv]) return { kind: 'nothing' }
  const from = path.join(appDataPath, LEGACY_NAMES.dataFolderName)
  const to = path.join(appDataPath, dataFolderName)
  if (!fs.existsSync(from) || fs.existsSync(to)) return { kind: 'nothing' }
  try {
    fs.renameSync(from, to)
  } catch (error) {
    return {
      kind: 'failed',
      from,
      to,
      error: error instanceof Error ? error.message : String(error)
    }
  }
  rewriteMovedPaths(to, from)
  repairTaskCopies(to)
  return { kind: 'moved', from, to }
}

/** The ways an absolute path into `folder` is written in the data folder's JSON files. */
function pathSpellings(folder: string): string[] {
  const forward = folder.replaceAll('\\', '/')
  return [...new Set([JSON.stringify(folder).slice(1, -1), forward, folder])]
}

/**
 * The config, harness state and generated agent settings hold absolute paths
 * into the data folder (task copies, runtime homes). After the move they point
 * at the new folder.
 */
function rewriteMovedPaths(to: string, from: string): void {
  const replacements = pathSpellings(from).map(
    (spelling, index) => [spelling, pathSpellings(to)[index] ?? spelling] as const
  )
  for (const file of jsonFiles(to)) {
    const text = fs.readFileSync(file, 'utf8')
    let next = text
    for (const [before, after] of replacements) next = next.split(before).join(after)
    if (next !== text) fs.writeFileSync(file, next, 'utf8')
  }
}

function jsonFiles(folder: string): string[] {
  const found: string[] = []
  const stack = [folder]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        // Task copies are the person's own files: Git repairs their links below.
        if (
          CHROMIUM_ENTRIES.has(entry.name) ||
          (current === folder && entry.name === 'worktrees')
        ) {
          continue
        }
        stack.push(full)
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        found.push(full)
      }
    }
  }
  return found
}

/**
 * Each task copy is a Git worktree whose repository still records the old
 * folder. `git worktree repair`, run inside the moved copy, points the
 * repository at it again. A copy Git cannot repair is reported, not fatal:
 * its task shows the copy as missing, as any lost copy does.
 */
function repairTaskCopies(dataDir: string): void {
  const root = path.join(dataDir, 'worktrees')
  for (const project of safeDirectories(root)) {
    for (const copy of safeDirectories(path.join(root, project))) {
      const folder = path.join(root, project, copy)
      if (!fs.existsSync(path.join(folder, '.git'))) continue
      const result = spawnSync('git', ['worktree', 'repair'], {
        cwd: folder,
        windowsHide: true,
        timeout: 15_000,
        encoding: 'utf8'
      })
      if (result.status !== 0) {
        console.warn(
          `[rename] Could not repair the task copy ${folder}: ${result.stderr || result.error}`
        )
      }
    }
  }
}

function safeDirectories(folder: string): string[] {
  try {
    return fs
      .readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * Renames what lives inside a data folder: `nexus.db` (with its WAL and SHM
 * files) to `ostler.db`, the same in every backup and its manifest, and the
 * discarded-work refs the harness state records. Does nothing once done, so
 * it runs at every start, for a data folder in any place.
 */
export function renameLegacyFiles(dataDir: string, databaseFile: string): void {
  moveDatabase(dataDir, databaseFile)
  const backups = path.join(dataDir, 'backups')
  for (const backup of safeDirectories(backups)) {
    const folder = path.join(backups, backup)
    moveDatabase(folder, databaseFile)
    rewriteFile(path.join(folder, 'manifest.json'), (text) =>
      text
        .replace(/"format":\s*"nexus-backup"/, '"format": "ostler-backup"')
        .replaceAll(`"${LEGACY_NAMES.databaseFile}"`, `"${databaseFile}"`)
    )
  }
  const harness = path.join(dataDir, 'harness')
  for (const project of safeDirectories(harness)) {
    rewriteFile(path.join(harness, project, 'state.json'), (text) =>
      text.replaceAll(`"${LEGACY_NAMES.refsNamespace}`, '"refs/ostler/')
    )
  }
}

function moveDatabase(folder: string, databaseFile: string): void {
  const legacy = path.join(folder, LEGACY_NAMES.databaseFile)
  const current = path.join(folder, databaseFile)
  if (!fs.existsSync(legacy) || fs.existsSync(current)) return
  for (const suffix of ['-wal', '-shm', '']) {
    if (fs.existsSync(`${legacy}${suffix}`))
      fs.renameSync(`${legacy}${suffix}`, `${current}${suffix}`)
  }
}

function rewriteFile(file: string, change: (text: string) => string): void {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return
  }
  const next = change(text)
  if (next !== text) fs.writeFileSync(file, next, 'utf8')
}
