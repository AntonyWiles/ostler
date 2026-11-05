/**
 * Moving a personal space from Google Drive or a folder into the R2 bucket (`r2:Ostler`).
 *
 * The move copies every file of the space and of the project shares beside it into the bucket, at
 * the same paths a space started in the bucket has (`r2:Ostler/Personal`, `r2:Ostler/devices`,
 * `r2:Ostler/Projects/…`). Sync files are written once and never changed, so copying is a set
 * difference: a move that stopped half way is finished by running it again. Then the device writes
 * a "moved" entry into the old personal share, so the other devices of the person (which still read
 * the old place) switch too, and switches its own places. The old copy is left where it was.
 *
 * Share folders outside the space but under the folder that holds it go where the R2 bridge has
 * always copied them (`r2:<path from that folder>`), so phones that already use them keep working.
 * Places that cannot be mapped (a sync server, another Drive folder) stay where they are.
 */
import * as path from 'node:path'
import type Database from 'better-sqlite3'
import { localStamp } from './capture'
import { isDriveLocation, parseDriveLocation } from './drive-transport'
import { sealEnvelope } from './envelope'
import { SyncTransportError, type SyncTransport } from './folder-transport'
import {
  DEVICES_FOLDER,
  SHARE_ENTRY_FILE,
  SHARES_FOLDER,
  personalShareRow,
  SPACE_FOLDER,
  type ShareEntry
} from './pairing'
import { joinPlace } from './sharing'
import { isR2Location, r2Location } from './r2-transport'
import { identityKeys, keyGenerationOf, projectKeyFor } from './sync-keys'
import { PERSONAL_PROJECT_ID } from './synced-tables'

/** The id the "moved" entry is filed under in the personal share's `shares/` folder. */
export const MOVED_ENTRY_ID = 'moved-space'

/** One place to copy and switch: a share (or the devices folder, `projectId` null) and its place in the bucket. */
export interface PlannedMove {
  projectId: string | null
  from: string
  to: string
}

export interface MoveProgress {
  /** Files copied into the bucket so far. */
  copied: number
  /** Files the bucket lacked when the copy began. */
  total: number
}

/** Where `place` goes in the bucket when the space at `space` moves there; null when it stays. */
export function r2PlaceFor(space: string, place: string): string | null {
  const target = joinPlace(r2Location(''), SPACE_FOLDER)
  if (isR2Location(place) || isR2Location(space)) return null
  if (isDriveLocation(space)) {
    if (!isDriveLocation(place)) return null
    const from = parseDriveLocation(space)
    const at = parseDriveLocation(place)
    if (from.folderId !== at.folderId) return null
    if (at.subPath === from.subPath) return target
    const inside =
      from.subPath === ''
        ? at.subPath
        : at.subPath.startsWith(`${from.subPath}/`)
          ? at.subPath.slice(from.subPath.length + 1)
          : null
    return inside ? joinPlace(target, inside) : null
  }
  if (isDriveLocation(place) || !path.isAbsolute(place) || !path.isAbsolute(space)) return null
  const inSpace = relativeInside(space, place)
  if (inSpace !== null) return inSpace === '' ? target : joinPlace(target, inSpace)
  const inRoot = relativeInside(path.dirname(path.resolve(space)), place)
  return inRoot ? r2Location(inRoot) : null
}

/** `child`'s path from `parent` with `/` between segments, '' for the same folder; null when outside. */
function relativeInside(parent: string, child: string): string | null {
  const fold = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
  const relative = path.relative(fold(path.resolve(parent)), fold(path.resolve(child)))
  if (relative === '') return ''
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null
  }
  const original = path.relative(path.resolve(parent), path.resolve(child))
  const segments = original.split(path.sep)
  return segments.some((part) => part === '' || part.includes(':')) ? null : segments.join('/')
}

/** The places to copy for a space: its devices folder and each share that has a place in the bucket. */
export function planMove(
  space: string,
  shares: { project_id: string; folder: string }[]
): { moves: PlannedMove[]; kept: number } {
  const moves: PlannedMove[] = []
  let kept = 0
  const devices = joinPlace(space, DEVICES_FOLDER)
  const devicesTo = r2PlaceFor(space, devices)
  if (devicesTo) moves.push({ projectId: null, from: devices, to: devicesTo })
  for (const share of shares) {
    const to = r2PlaceFor(space, share.folder)
    if (to) moves.push({ projectId: share.project_id, from: share.folder, to })
    else kept += 1
  }
  return { moves, kept }
}

/**
 * Copies what `to` lacks from each pair. Every place is listed first, so the total is known before a
 * file is copied. A file that is already there (another device copied it) counts as copied.
 */
export async function copyPlaces(
  pairs: { from: SyncTransport; to: SyncTransport }[],
  onProgress?: (progress: MoveProgress) => void
): Promise<MoveProgress> {
  const missing: { pair: (typeof pairs)[number]; file: string }[] = []
  for (const pair of pairs) {
    const there = new Set(await pair.to.list(''))
    for (const file of await pair.from.list('')) {
      if (!there.has(file)) missing.push({ pair, file })
    }
  }
  const progress: MoveProgress = { copied: 0, total: missing.length }
  onProgress?.({ ...progress })
  for (const { pair, file } of missing) {
    try {
      await pair.to.writeOnce(file, await pair.from.read(file))
    } catch (error) {
      if (!(error instanceof SyncTransportError && error.reason === 'exists')) throw error
    }
    progress.copied += 1
    onProgress?.({ ...progress })
  }
  return progress
}

/**
 * Writes the "moved" entry to the personal share at `transport`: the other devices that read it
 * move their places to `to` too. Sealed and signed like the shares' entries.
 */
export async function writeMovedEntry(
  db: Database.Database,
  transport: SyncTransport,
  to: string,
  now = Date.now()
): Promise<void> {
  const personal = personalShareRow(db)
  if (!personal) return
  const entry: ShareEntry = {
    projectId: MOVED_ENTRY_ID,
    invite: '',
    folderRelativeToRoot: null,
    location: to,
    addedAt: now,
    removed: false
  }
  const stamp = localStamp(personal.device_id)
  const bytes = sealEnvelope(
    SHARE_ENTRY_FILE,
    {
      formatVersion: 1,
      shareId: personal.share_id,
      memberId: personal.member_id,
      projectId: MOVED_ENTRY_ID,
      stamp
    },
    entry,
    {
      projectKey: projectKeyFor(db, PERSONAL_PROJECT_ID) as Buffer,
      keyGeneration: keyGenerationOf(db, PERSONAL_PROJECT_ID),
      privateKey: identityKeys(db).privateKey
    }
  )
  try {
    await transport.writeOnce(`${SHARES_FOLDER}/${MOVED_ENTRY_ID}/${stamp}.ostlershare`, bytes)
  } catch (error) {
    if (!(error instanceof SyncTransportError && error.reason === 'exists')) throw error
  }
}

/** Where the "moved" entry among `entries` says the space went; null when there is none. */
export function movedTo(entries: ShareEntry[]): string | null {
  const entry = entries.find((one) => one.projectId === MOVED_ENTRY_ID && !one.removed)
  return entry?.location && isR2Location(entry.location) ? entry.location : null
}
