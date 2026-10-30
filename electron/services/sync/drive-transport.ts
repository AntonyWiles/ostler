/**
 * The Drive transport keeps sync files in a Google Drive folder, through the Drive API instead of
 * a synced folder on disk, so Windows and Android can both reach them. The files are the same
 * write-once files as every other transport. Each path segment is a Drive folder. Drive allows
 * two folders (or files) with one name, and two devices may make `changes/` at the same moment,
 * so same-named folders in a parent are read as one folder, and of two same-named files the
 * oldest wins. Platform-neutral: nothing here touches Electron or the file system.
 */
import { isHiddenOrTemp, segmentsOf, SyncTransportError } from './transport-paths'
import type { SyncTransport } from './folder-transport'
import { DRIVE_FOLDER_MIME, DriveError, type DriveClient, type DriveFile } from './drive-client'
import type { DriveChangesPoller } from './drive-changes'

const PREFIX = 'gdrive:'
const LOCATION = /^gdrive:([A-Za-z0-9_-]{10,200})(?:\/(.+))?$/
const DEBOUNCE_MS = 500
const DEFAULT_POLL_MS = 60_000

/** True for `gdrive:<folderId>`, optionally followed by `/` and a relative path. */
export function isDriveLocation(place: string): boolean {
  const match = LOCATION.exec(place)
  if (!match) return false
  if (match[2] === undefined) return true
  try {
    segmentsOf(match[2], false)
    return true
  } catch {
    return false
  }
}

export function driveLocation(folderId: string, subPath = ''): string {
  const place = subPath === '' ? `${PREFIX}${folderId}` : `${PREFIX}${folderId}/${subPath}`
  if (!isDriveLocation(place)) throw new SyncTransportError('bad-path')
  return place
}

export function parseDriveLocation(place: string): { folderId: string; subPath: string } {
  const match = LOCATION.exec(place)
  if (!match || !isDriveLocation(place)) throw new SyncTransportError('bad-path')
  return { folderId: match[1], subPath: match[2] ?? '' }
}

export interface DriveTransportOptions {
  /**
   * Called with a change callback, and the transport asking, when Drive can say what changed
   * (see `pollerSubscription`); returns a stop function.
   */
  subscribe?: (onChange: () => void, transport: DriveTransport) => () => void
  /** How often the folder is listed when there is no `subscribe`; default 60 000 ms. */
  pollMs?: number
}

const isFolder = (file: DriveFile): boolean => file.mimeType === DRIVE_FOLDER_MIME
const isGoogleApp = (file: DriveFile): boolean =>
  file.mimeType.startsWith('application/vnd.google-apps.') && !isFolder(file)
const byAge = (a: DriveFile, b: DriveFile): number =>
  a.createdTime < b.createdTime ? -1 : a.createdTime > b.createdTime ? 1 : a.id < b.id ? -1 : 1

/** The `subscribe` option that lets a `DriveChangesPoller` wake a transport when its folders change. */
export function pollerSubscription(
  poller: DriveChangesPoller
): NonNullable<DriveTransportOptions['subscribe']> {
  return (onChange, transport) =>
    poller.subscribe((parents) => parents.some((id) => transport.ownsFolder(id)), onChange)
}

export class DriveTransport implements SyncTransport {
  private readonly folderId: string
  private readonly baseSegments: string[]
  /** Folder path (from the Drive folder) to the ids of every same-named folder there, oldest first. */
  private readonly cache = new Map<string, string[]>()
  private writes: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly client: DriveClient,
    place: string,
    private readonly options: DriveTransportOptions = {}
  ) {
    const parsed = parseDriveLocation(place)
    this.folderId = parsed.folderId
    this.baseSegments = parsed.subPath === '' ? [] : parsed.subPath.split('/')
  }

  /** True for the Drive folder and any folder below it this transport has resolved so far. */
  ownsFolder(id: string): boolean {
    if (id === this.folderId) return true
    for (const ids of this.cache.values()) if (ids.includes(id)) return true
    return false
  }

  async list(prefix: string): Promise<string[]> {
    const segments = segmentsOf(prefix, true)
    return this.retry(async () => {
      const ids = await this.resolve(segments, false)
      if (!ids) return []
      const files: string[] = []
      await this.walk(ids, segments, files)
      return files.sort()
    })
  }

  async read(path: string): Promise<Buffer> {
    const segments = segmentsOf(path, false)
    const name = segments[segments.length - 1]
    return this.retry(async () => {
      const ids = await this.resolve(segments.slice(0, -1), false)
      const found = ids ? await this.find(ids, name) : null
      if (!found) throw new DriveError(404)
      return Buffer.from(await this.client.download(found.id))
    })
  }

  writeOnce(path: string, bytes: Buffer): Promise<void> {
    let segments: string[]
    try {
      segments = segmentsOf(path, false)
    } catch (error) {
      return Promise.reject(error)
    }
    const name = segments[segments.length - 1]
    // Such a file could never be listed, so it is refused up front.
    if (isHiddenOrTemp(name)) return Promise.reject(new SyncTransportError('bad-path'))
    const run = this.writes.then(() =>
      this.retry(async () => {
        const ids = (await this.resolve(segments.slice(0, -1), true))!
        if (await this.find(ids, name)) throw new SyncTransportError('exists')
        await this.client.upload(name, ids[0], bytes)
      })
    )
    this.writes = run.catch(() => undefined)
    return run
  }

  watch(onChange: () => void): () => void {
    let stopped = false
    let cooling = false
    let pending = false
    let cooldown: ReturnType<typeof setTimeout> | undefined
    const fire = (): void => {
      if (stopped) return
      if (cooling) {
        pending = true
        return
      }
      cooling = true
      onChange()
      cooldown = setTimeout(() => {
        cooling = false
        if (pending) {
          pending = false
          fire()
        }
      }, DEBOUNCE_MS)
    }

    if (this.options.subscribe) {
      const stopSubscription = this.options.subscribe(fire, this)
      return () => {
        stopped = true
        clearTimeout(cooldown)
        stopSubscription()
      }
    }

    let last: string | null = null
    let busy = false
    const poll = async (): Promise<void> => {
      if (stopped || busy) return
      busy = true
      try {
        const now = (await this.list('')).join('\n')
        if (last !== null && now !== last) fire()
        last = now
      } catch {
        // Unreachable for now; the share's own timer still pulls and says so.
      } finally {
        busy = false
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), this.options.pollMs ?? DEFAULT_POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
      clearTimeout(cooldown)
    }
  }

  /** Runs `fn`; when a cached folder id turned out to be gone (404), forgets the cache and runs it once more. */
  private async retry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      if (!(error instanceof DriveError) || error.status !== 404 || this.cache.size === 0) {
        throw error
      }
      this.cache.clear()
      return fn()
    }
  }

  /** Children of every folder in `ids`, Google-app files dropped, oldest first. */
  private async children(ids: string[]): Promise<DriveFile[]> {
    const all: DriveFile[] = []
    for (const id of ids) all.push(...(await this.client.listChildren(id)))
    return all.filter((file) => !isGoogleApp(file)).sort(byAge)
  }

  private async find(ids: string[], name: string): Promise<DriveFile | null> {
    return (await this.children(ids)).find((c) => c.name === name && !isFolder(c)) ?? null
  }

  /** The ids of the folders at `segments` below the share's place; null when missing and not `create`. */
  private async resolve(segments: string[], create: boolean): Promise<string[] | null> {
    let ids = [this.folderId]
    let key = ''
    for (const segment of [...this.baseSegments, ...segments]) {
      key = key === '' ? segment : `${key}/${segment}`
      const cached = this.cache.get(key)
      if (cached) {
        ids = cached
        continue
      }
      let match = (await this.children(ids))
        .filter((c) => isFolder(c) && c.name === segment)
        .map((c) => c.id)
      if (match.length === 0) {
        if (!create) return null
        match = [await this.client.createFolder(segment, ids[0])]
      }
      ids = match
      this.cache.set(key, ids)
    }
    return ids
  }

  private async walk(ids: string[], segments: string[], out: string[]): Promise<void> {
    const folders = new Map<string, string[]>()
    const files = new Set<string>()
    for (const kid of await this.children(ids)) {
      if (isHiddenOrTemp(kid.name) || kid.name.includes('/')) continue
      if (isFolder(kid)) folders.set(kid.name, [...(folders.get(kid.name) ?? []), kid.id])
      else files.add(kid.name)
    }
    for (const name of files) out.push([...segments, name].join('/'))
    for (const [name, folderIds] of folders) {
      const next = [...segments, name]
      this.cache.set([...this.baseSegments, ...next].join('/'), folderIds)
      await this.walk(folderIds, next, out)
    }
  }
}
