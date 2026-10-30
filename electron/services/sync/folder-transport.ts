/**
 * The folder transport keeps sync files in a folder that OneDrive, Dropbox,
 * Google Drive or a network share keeps in sync. Every file has exactly one
 * writer and is written once, never edited, because sync apps make "conflicted
 * copy" files when two PCs change the same file. A file is assembled under a
 * hidden temporary name and renamed when complete, so other PCs never see half
 * a file. The layout and the sync rules are in
 * `docs/plans/integrations/shared-folder-sync.md`.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  isHiddenOrTemp,
  segmentsOf,
  SyncTransportError,
  type SyncTransportErrorReason
} from './transport-paths'

export { isHiddenOrTemp, segmentsOf, SyncTransportError, type SyncTransportErrorReason }

/** Where sync files are kept. Paths are relative, with `/` between segments. */
export interface SyncTransport {
  /** Every file under `prefix` (a folder path, '' for all), as relative paths, sorted. */
  list(prefix: string): Promise<string[]>
  read(path: string): Promise<Buffer>
  /** Writes a new file; refuses when it already exists. */
  writeOnce(path: string, bytes: Buffer): Promise<void>
  /** Calls `onChange` (at most once per 500 ms) when the folder may have changed; returns a stop function. */
  watch(onChange: () => void): () => void
}

export interface FolderTransportOptions {
  /** How often the folder is scanned even without file events; default 30 000 ms. */
  scanIntervalMs?: number
}

const DEBOUNCE_MS = 500
const DEFAULT_SCAN_INTERVAL_MS = 30_000

/** Windows paths compare without case. */
function foldCase(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

/** True when `child` is `parent` or inside it. */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(foldCase(parent), foldCase(path.resolve(child)))
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.promises.access(file)
    return true
  } catch {
    return false
  }
}

/**
 * Whether files can be written in `folder`, made first when it is missing. Some folders a
 * sync app shows can't hold files, such as the top of a Google Drive letter (only My Drive
 * can). Writes a hidden file and removes it, so it leaves nothing behind.
 */
export async function canWriteIn(folder: string): Promise<boolean> {
  const probe = path.join(folder, `.ostler-check.${randomBytes(4).toString('hex')}.tmp`)
  try {
    if (!(await exists(folder))) await fs.promises.mkdir(folder, { recursive: true })
    await fs.promises.writeFile(probe, '', { flag: 'wx' })
  } catch {
    return false
  }
  await fs.promises.rm(probe, { force: true }).catch(() => undefined)
  return true
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

/** A sync transport over a local folder (or a folder the sync app keeps in step). */
export class FolderTransport implements SyncTransport {
  private readonly root: string
  private readonly scanIntervalMs: number

  constructor(root: string, options: FolderTransportOptions = {}) {
    this.root = path.resolve(root)
    this.scanIntervalMs = options.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS
  }

  async list(prefix: string): Promise<string[]> {
    const folder = this.locate(prefix, true)
    const files: string[] = []
    await this.walk(folder, prefix, files)
    return files.sort()
  }

  async read(relativePath: string): Promise<Buffer> {
    return fs.promises.readFile(this.locate(relativePath, false))
  }

  async writeOnce(relativePath: string, bytes: Buffer): Promise<void> {
    const target = this.locate(relativePath, false)
    // Such a file could never be listed, so it is refused up front.
    if (isHiddenOrTemp(path.basename(target))) throw new SyncTransportError('bad-path')
    if (await exists(target)) throw new SyncTransportError('exists')

    const folder = path.dirname(target)
    await fs.promises.mkdir(folder, { recursive: true })
    const temp = path.join(
      folder,
      `.${path.basename(target)}.${randomBytes(4).toString('hex')}.tmp`
    )
    try {
      await fs.promises.writeFile(temp, bytes, { flag: 'wx' })
      // Another PC may have written the same name meanwhile; never replace it.
      if (await exists(target)) throw new SyncTransportError('exists')
      await fs.promises.rename(temp, target)
    } catch (error) {
      await fs.promises.rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  watch(onChange: () => void): () => void {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let watcher: fs.FSWatcher | undefined

    const notify = (): void => {
      if (stopped || timer) return
      timer = setTimeout(() => {
        timer = undefined
        try {
          onChange()
        } catch {
          // A failing listener must not stop the watching.
        }
      }, DEBOUNCE_MS)
    }

    try {
      watcher = fs.watch(this.root, { recursive: true }, notify)
      watcher.on('error', () => closeWatcher())
    } catch {
      // Recursive watching is not available here; the scan below still runs.
      watcher = undefined
    }

    function closeWatcher(): void {
      try {
        watcher?.close()
      } catch {
        // Already closed.
      }
      watcher = undefined
    }

    const interval = setInterval(notify, this.scanIntervalMs)

    return () => {
      if (stopped) return
      stopped = true
      clearInterval(interval)
      if (timer) clearTimeout(timer)
      timer = undefined
      closeWatcher()
    }
  }

  /** The absolute path of a relative path; refuses anything that leaves the root. */
  private locate(relativePath: string, allowRoot: boolean): string {
    const segments = segmentsOf(relativePath, allowRoot)
    const full = path.join(this.root, ...segments)
    if (!isInside(this.root, full)) throw new SyncTransportError('bad-path')
    return full
  }

  /** Adds the files under `folder` to `files`; `relativeFolder` is its path from the root. */
  private async walk(folder: string, relativeFolder: string, files: string[]): Promise<void> {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(folder, { withFileTypes: true })
    } catch (error) {
      if (isNotFound(error)) return
      throw error
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || isHiddenOrTemp(entry.name)) continue
      const relative = relativeFolder === '' ? entry.name : `${relativeFolder}/${entry.name}`
      if (entry.isDirectory()) {
        await this.walk(path.join(folder, entry.name), relative, files)
      } else if (entry.isFile()) {
        files.push(relative)
      }
    }
  }
}

/** Opens a folder on this PC as a transport; the default way to open a place that is a folder. */
export function openFolderTransport(folder: string): SyncTransport {
  return new FolderTransport(folder)
}
