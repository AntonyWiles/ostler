/**
 * A snapshot is a whole shared project at one moment, so a PC that joins (or
 * has fallen far behind) loads it instead of replaying every change file
 * (docs/plans/integrations/shared-folder-sync.md, "Joining and catching up", S7a).
 *
 * It uses the same sealed envelope as a change file (envelope.ts) with its own
 * magic, `OSTLERSN`. The plain header says which share and member wrote it, the
 * highest stamp it includes, and how far it had applied each device's change
 * files, so a pull afterwards starts from there. The payload is every synced row
 * of the project and every field stamp.
 */
import {
  openEnvelope,
  sealEnvelope,
  type EnvelopeKind,
  type SyncFileRefusal,
  type SealKeys,
  type KeySource
} from './envelope'

export type SnapshotFileErrorReason = SyncFileRefusal

export class SnapshotFileError extends Error {
  constructor(readonly reason: SnapshotFileErrorReason) {
    // Only the reason: never key material or file contents.
    super(`Snapshot refused: ${reason}`)
    this.name = 'SnapshotFileError'
  }
}

export const MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024

const FORMAT_VERSION = 1

/** `[table, rowKey, column, stamp]`, one per row of `sync_field_stamps`. */
export type SnapshotStamp = [string, string, string, string]

/** The project's own settings a joining PC needs; never its folder path. */
export interface SnapshotProject {
  name: string
  color: string
  notes: string
  tags: string[]
  /** The prefix of the project's task numbers, so they read the same on every PC. */
  taskPrefix?: string
  /**
   * The project's icon from the curated set (project-icons.ts), or null for none; left out by
   * Ostler from before icons were shared. Any text is accepted here, so an icon a newer Ostler
   * added doesn't lose the rest; the PC applying it keeps only icons it knows.
   */
  icon?: string | null
}

export interface Snapshot {
  formatVersion: 1
  shareId: string
  deviceId: string
  memberId: string
  /** The highest stamp the snapshot includes; the file's name in the share folder. */
  stamp: string
  /** Device id → last applied (or, for the writer, last pushed) change-file sequence. */
  applied: Record<string, number>
  rows: Record<string, Record<string, unknown>[]>
  stamps: SnapshotStamp[]
  project?: SnapshotProject
}

type SnapshotHeader = Omit<Snapshot, 'formatVersion' | 'rows' | 'stamps' | 'project'>

function refuse(reason: SnapshotFileErrorReason): never {
  throw new SnapshotFileError(reason)
}

const SNAPSHOT_FILE: EnvelopeKind = {
  magic: Buffer.from('OSTLERSN', 'ascii'),
  version: FORMAT_VERSION,
  maxBytes: MAX_SNAPSHOT_BYTES,
  refuse
}

export function encodeSnapshot(snapshot: Snapshot, keys: SealKeys): Buffer {
  if (snapshot.formatVersion !== FORMAT_VERSION) {
    throw new RangeError('Snapshot format version must be 1')
  }
  if (!validApplied(snapshot.applied)) {
    throw new RangeError('Snapshot applied sequences must be non-negative integers')
  }
  return sealEnvelope(
    SNAPSHOT_FILE,
    {
      formatVersion: FORMAT_VERSION,
      shareId: snapshot.shareId,
      deviceId: snapshot.deviceId,
      memberId: snapshot.memberId,
      stamp: snapshot.stamp,
      applied: snapshot.applied
    },
    { rows: snapshot.rows, stamps: snapshot.stamps, project: snapshot.project ?? null },
    keys
  )
}

export function decodeSnapshot(
  bytes: Buffer,
  keys: { projectKey: KeySource; publicKeyFor(memberId: string): string | null }
): Snapshot {
  const { header, payload } = openEnvelope(SNAPSHOT_FILE, bytes, keys, parseHeader)
  if (typeof payload !== 'object' || payload === null) refuse('not-a-change-file')
  const { rows, stamps, project } = payload as Record<string, unknown>
  if (
    typeof rows !== 'object' ||
    rows === null ||
    Array.isArray(rows) ||
    !Object.values(rows).every(Array.isArray) ||
    !Array.isArray(stamps) ||
    !stamps.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 4 &&
        entry.every((part) => typeof part === 'string')
    ) ||
    (project !== undefined && project !== null && !isSnapshotProject(project))
  ) {
    refuse('not-a-change-file')
  }
  const snapshot: Snapshot = {
    formatVersion: FORMAT_VERSION,
    ...header,
    rows: rows as Snapshot['rows'],
    stamps: stamps as SnapshotStamp[]
  }
  if (project) snapshot.project = project as SnapshotProject
  return snapshot
}

/** Whether a snapshot or a settings record carries project settings this PC can read. */
export function isSnapshotProject(project: unknown): project is SnapshotProject {
  if (typeof project !== 'object' || project === null) return false
  const { name, color, notes, tags, taskPrefix, icon } = project as Record<string, unknown>
  return (
    (taskPrefix === undefined || typeof taskPrefix === 'string') &&
    (icon === undefined || icon === null || typeof icon === 'string') &&
    typeof name === 'string' &&
    typeof color === 'string' &&
    typeof notes === 'string' &&
    Array.isArray(tags) &&
    tags.every((tag) => typeof tag === 'string')
  )
}

function validApplied(applied: unknown): applied is Record<string, number> {
  return (
    typeof applied === 'object' &&
    applied !== null &&
    !Array.isArray(applied) &&
    Object.values(applied).every(
      (sequence) => typeof sequence === 'number' && Number.isInteger(sequence) && sequence >= 0
    )
  )
}

function parseHeader(header: Record<string, unknown>): SnapshotHeader {
  if (
    header.formatVersion !== FORMAT_VERSION ||
    typeof header.shareId !== 'string' ||
    typeof header.deviceId !== 'string' ||
    typeof header.memberId !== 'string' ||
    typeof header.stamp !== 'string' ||
    !validApplied(header.applied)
  ) {
    refuse('not-a-change-file')
  }
  return {
    shareId: header.shareId,
    deviceId: header.deviceId,
    memberId: header.memberId,
    stamp: header.stamp,
    applied: header.applied
  }
}
