/**
 * Writing and loading snapshots of a shared project
 * (docs/plans/integrations/shared-folder-sync.md, "Joining and catching up", S7b).
 *
 * `writeSnapshot` reads every synced row of the project, its field stamps and
 * how far this PC has applied each device's change files, and writes them as
 * `snapshots/<device>/<stamp>.ostlersnap`. `loadSnapshot` puts a decoded
 * snapshot into this database without capturing it again, so a pull afterwards
 * only applies change files newer than the snapshot.
 *
 * Loading follows the same per-field rule as the merge: a column of a row this
 * PC already has is only overwritten when the snapshot's stamp for it is later
 * than the stored one, and a row this PC deleted later than every stamp in the
 * snapshot stays deleted. A row whose parent is not here yet (a personal reminder
 * on a task in a project this device has not joined) waits in `sync_pending`, as
 * a change would, instead of failing the whole snapshot. Table and column names only ever come from
 * `SYNCED_TABLES` and `tableShape`; values are always bound.
 */
import type Database from 'better-sqlite3'
import { formatStamp } from '@shared/sync/clock'
import { openSecret, sealSecret } from './platform'
import { quote, tableShape, type TableShape } from '../change-history/table-shape'
import { advanceTaskCounter } from './task-numbers'
import { observeRemoteStamp, withSyncApplying } from './capture'
import { SyncTransportError, type SyncTransport } from './folder-transport'
import {
  decodeSnapshot,
  encodeSnapshot,
  type Snapshot,
  type SnapshotProject,
  type SnapshotStamp
} from './snapshot-file'
import {
  PERSONAL_TABLES,
  SYNCED_TABLES,
  type PersonalTable,
  type SyncedTable
} from './synced-tables'
import { type KeySource, type SealKeys } from './envelope'

const SNAPSHOT_PATTERN = /^(\d{15}-\d{6}-\S+)\.ostlersnap$/
const CHANGE_PATTERN = /^(\d{6,})\.ostlerchanges$/

interface ShareRow {
  share_id: string
  member_id: string
  device_id: string
  kind: 'project' | 'personal'
}

export interface LoadResult {
  rows: number
  stamps: number
}

/**
 * Writes a snapshot of the project into the folder; returns its path. `project`
 * is the project's own settings from the config store, for a PC that joins.
 */
export async function writeSnapshot(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string,
  keys: SealKeys,
  project?: SnapshotProject | null
): Promise<string> {
  const share = shareOf(db, projectId)
  const snapshot = readSnapshot(db, projectId, share)
  // The personal share has no project settings: its snapshot carries none.
  if (project) snapshot.project = project
  snapshot.applied[share.device_id] = await highestPushed(transport, share.device_id)
  const path = `snapshots/${share.device_id}/${snapshot.stamp}.ostlersnap`
  try {
    await transport.writeOnce(path, encodeSnapshot(snapshot, keys))
  } catch (error) {
    // The name is the newest stamp: one already there holds this same state (nothing changed since).
    if (!(error instanceof SyncTransportError && error.reason === 'exists')) throw error
  }
  return path
}

/** Builds the snapshot of a shared project from this database (without the writer's pushed sequence). */
export function readSnapshot(
  db: Database.Database,
  projectId: string,
  share: ShareRow = shareOf(db, projectId)
): Snapshot {
  const rows: Snapshot['rows'] = {}
  if (share.kind === 'personal') {
    for (const [table, entry] of Object.entries(PERSONAL_TABLES)) {
      const shape = tableShape(db, table)
      if (!shape) continue
      rows[table] = personalRows(db, table, entry, shape)
    }
  } else {
    for (const [table, entry] of Object.entries(SYNCED_TABLES)) {
      const shape = tableShape(db, table)
      if (!shape) continue
      rows[table] = db
        .prepare(`SELECT * FROM ${quote(table)} AS ROW WHERE ${projectTest(entry)}`)
        .all({ projectId }) as Record<string, unknown>[]
    }
  }

  const stamps = (
    db
      .prepare(
        `SELECT table_name, row_key, column_name, stamp FROM sync_field_stamps
         WHERE project_id = @projectId ORDER BY table_name, row_key, column_name`
      )
      .all({ projectId }) as {
      table_name: string
      row_key: string
      column_name: string
      stamp: string
    }[]
  ).map((row): SnapshotStamp => [row.table_name, row.row_key, row.column_name, row.stamp])

  const applied: Record<string, number> = {}
  for (const row of db
    .prepare('SELECT device_id, last_sequence FROM sync_applied WHERE share_id = @shareId')
    .all({ shareId: share.share_id }) as { device_id: string; last_sequence: number }[]) {
    applied[row.device_id] = row.last_sequence
  }

  const highest = stamps.reduce((max, [, , , stamp]) => (stamp > max ? stamp : max), '')
  const snapshot: Snapshot = {
    formatVersion: 1,
    shareId: share.share_id,
    deviceId: share.device_id,
    memberId: share.member_id,
    stamp: highest || formatStamp({ wall: Date.now(), counter: 0, device: share.device_id }),
    applied,
    rows,
    stamps
  }
  return snapshot
}

/** The newest snapshot in the folder across every device, by the stamp in its name; null when there is none. */
export async function latestSnapshot(transport: SyncTransport): Promise<string | null> {
  return (await snapshotsNewestFirst(transport))[0] ?? null
}

/** Every snapshot in the folder, newest first by the stamp in its name. */
export async function snapshotsNewestFirst(transport: SyncTransport): Promise<string[]> {
  const found: { path: string; stamp: string }[] = []
  for (const relativePath of await transport.list('snapshots')) {
    const segments = relativePath.split('/')
    if (segments.length !== 3) continue
    const match = SNAPSHOT_PATTERN.exec(segments[2])
    if (match) found.push({ path: relativePath, stamp: match[1] })
  }
  return found
    .sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : 0))
    .map((snapshot) => snapshot.path)
}

/** Reads and checks a snapshot file against the share's members. */
export async function readSnapshotFile(
  db: Database.Database,
  transport: SyncTransport,
  shareId: string,
  path: string,
  projectKey: KeySource
): Promise<Snapshot> {
  // A removed member's snapshots are not trusted: they could say anything about later changes.
  const memberKey = db.prepare(
    'SELECT public_key FROM sync_members WHERE share_id = @shareId AND member_id = @memberId AND removed_at IS NULL'
  )
  const snapshot = decodeSnapshot(await transport.read(path), {
    projectKey,
    publicKeyFor: (memberId) =>
      (memberKey.get({ shareId, memberId }) as { public_key: string } | undefined)?.public_key ??
      null
  })
  if (snapshot.shareId !== shareId) throw new Error('The snapshot belongs to another share')
  return snapshot
}

/**
 * Loads a snapshot into a shared project on this PC, parents before children,
 * in one transaction. Nothing it writes is captured again.
 */
export function loadSnapshot(
  db: Database.Database,
  projectId: string,
  snapshot: Snapshot
): LoadResult {
  const share = shareOf(db, projectId)
  if (snapshot.shareId !== share.share_id) throw new Error('The snapshot belongs to another share')
  const personal = share.kind === 'personal'
  const registry: Record<string, SyncedTable | PersonalTable> = personal
    ? PERSONAL_TABLES
    : SYNCED_TABLES

  const incoming = new Map<string, Map<string, string>>()
  for (const [table, key, column, stamp] of snapshot.stamps) {
    const id = `${table}\u0000${key}`
    const columns = incoming.get(id) ?? new Map<string, string>()
    columns.set(column, stamp)
    incoming.set(id, columns)
  }

  // Cannot change inside a transaction, so it is set before the one below opens.
  db.pragma('foreign_keys = ON')
  let rows = 0
  let stamps = 0
  withSyncApplying(() =>
    db.transaction(() => {
      db.pragma('defer_foreign_keys = ON')
      const written: WrittenRow[] = []
      for (const [table, entry] of Object.entries(registry)) {
        const shape = tableShape(db, table)
        const tableRows = snapshot.rows[table]
        if (!shape || !Array.isArray(tableRows)) continue
        const keyColumns = entry.keyColumns ?? shape.keyColumns
        for (const row of tableRows) {
          const loaded = loadRow(db, projectId, entry, shape, keyColumns, row, incoming)
          if (loaded) written.push({ table, keyColumns, ...loaded })
        }
      }
      const waiting = parkOrphans(db, share.share_id, written, incoming)
      rows = written.length - waiting.size

      const writeStamp = db.prepare(
        `INSERT INTO sync_field_stamps (table_name, row_key, column_name, stamp, project_id)
         VALUES (@table, @key, @column, @stamp, @projectId)
         ON CONFLICT(table_name, row_key, column_name)
         DO UPDATE SET stamp = excluded.stamp, project_id = excluded.project_id
         WHERE excluded.stamp > sync_field_stamps.stamp`
      )
      for (const [table, key, column, stamp] of snapshot.stamps) {
        if (!Object.prototype.hasOwnProperty.call(registry, table)) continue
        // A waiting row is stamped when it is applied; stamped now, it would count as already seen.
        if (waiting.has(`${table}\u0000${key}`)) continue
        stamps += writeStamp.run({ table, key, column, stamp, projectId }).changes
      }

      const recordApplied = db.prepare(
        `INSERT INTO sync_applied (share_id, device_id, last_sequence) VALUES (@shareId, @deviceId, @sequence)
         ON CONFLICT(share_id, device_id) DO UPDATE SET last_sequence = excluded.last_sequence
         WHERE excluded.last_sequence > sync_applied.last_sequence`
      )
      for (const [deviceId, sequence] of Object.entries(snapshot.applied)) {
        if (deviceId === share.device_id) continue
        recordApplied.run({ shareId: share.share_id, deviceId, sequence })
      }
      if (!personal) advanceTaskCounter(db, projectId)
    })()
  )
  observeRemoteStamp(snapshot.stamp)
  return { rows, stamps }
}

interface LoadedRow {
  /** The row as it was written (a personal row after `arrivingRow`). */
  row: Record<string, unknown>
  /** New here, rather than an update of a row this PC already had. */
  inserted: boolean
}

interface WrittenRow extends LoadedRow {
  table: string
  keyColumns: readonly string[]
}

/**
 * Takes out the rows just added whose parent row is missing and leaves each in `sync_pending`
 * as an upsert waiting for its parent, stamped with the row's newest stamp; `retryWaiting`
 * applies it once the parent arrives. Repeats while taking a row out leaves another without
 * its parent. Returns the table-and-key id of every row taken out.
 */
function parkOrphans(
  db: Database.Database,
  shareId: string,
  written: readonly WrittenRow[],
  incoming: Map<string, Map<string, string>>
): Set<string> {
  const waiting = new Set<string>()
  const tables = [...new Set(written.map((entry) => entry.table))]
  const park = db.prepare(
    `INSERT INTO sync_pending (share_id, table_name, row_key, op, columns, stamp, waiting_for, received_at, actor)
     VALUES (@shareId, @table, @key, 'upsert', @columns, @stamp, 'parent', @now, NULL)`
  )
  let parkedAny = true
  while (parkedAny) {
    parkedAny = false
    for (const table of tables) {
      const broken = new Set(
        (db.pragma(`foreign_key_check(${quote(table)})`) as { rowid: number | null }[]).map(
          (problem) => problem.rowid
        )
      )
      if (broken.size === 0) continue
      for (const entry of written) {
        // An update of a row already here is not taken out: that would lose this PC's copy.
        if (entry.table !== table || !entry.inserted) continue
        const key = JSON.stringify(entry.keyColumns.map((column) => entry.row[column]))
        const id = `${table}\u0000${key}`
        if (waiting.has(id)) continue
        const where = entry.keyColumns
          .map((column, index) => `${quote(column)} IS @k${index}`)
          .join(' AND ')
        const keyValues = Object.fromEntries(
          entry.keyColumns.map((column, index) => [`k${index}`, bindable(entry.row[column])])
        )
        const found = db
          .prepare(`SELECT rowid AS rid FROM ${quote(table)} WHERE ${where} LIMIT 1`)
          .get(keyValues) as { rid: number } | undefined
        if (!found || !broken.has(found.rid)) continue
        const stamps = [...(incoming.get(id)?.values() ?? [])]
        park.run({
          shareId,
          table,
          key,
          columns: JSON.stringify(entry.row),
          stamp: stamps.reduce((max, stamp) => (stamp > max ? stamp : max), ''),
          now: Date.now()
        })
        db.prepare(`DELETE FROM ${quote(table)} WHERE ${where}`).run(keyValues)
        waiting.add(id)
        parkedAny = true
      }
    }
  }
  return waiting
}

/** Inserts or updates one row; returns what was written, or null when nothing was. */
function loadRow(
  db: Database.Database,
  projectId: string,
  entry: SyncedTable | PersonalTable,
  shape: TableShape,
  keyColumns: readonly string[],
  incomingRow: Record<string, unknown>,
  incoming: Map<string, Map<string, string>>
): LoadedRow | null {
  if (typeof incomingRow !== 'object' || incomingRow === null) return null
  // A personal row arrives with this PC's own columns left out and its secrets sealed again.
  const row = 'project' in entry ? incomingRow : arrivingRow(entry, incomingRow)
  if (!keyColumns.every((column) => Object.prototype.hasOwnProperty.call(row, column))) {
    return null
  }
  if (!rowBelongs(db, projectId, entry, row)) return null

  const key = JSON.stringify(keyColumns.map((column) => row[column]))
  const theirs = incoming.get(`${shape.table}\u0000${key}`) ?? new Map<string, string>()
  const ours = new Map(
    (
      db
        .prepare(
          'SELECT column_name, stamp FROM sync_field_stamps WHERE table_name = @table AND row_key = @key'
        )
        .all({ table: shape.table, key }) as { column_name: string; stamp: string }[]
    ).map((stamp) => [stamp.column_name, stamp.stamp])
  )
  // Deleted here after everything the snapshot knows about the row: it stays deleted.
  const tombstone = ours.get('*')
  const newestTheirs = [...theirs.values()].reduce((max, stamp) => (stamp > max ? stamp : max), '')
  if (tombstone !== undefined && tombstone >= newestTheirs) return null

  // Columns this PC's table doesn't have are dropped, as in the merge.
  const columns = shape.columns.filter((column) =>
    Object.prototype.hasOwnProperty.call(row, column)
  )
  const where = keyColumns.map((column, index) => `${quote(column)} IS @k${index}`).join(' AND ')
  const keyValues = Object.fromEntries(
    keyColumns.map((column, index) => [`k${index}`, row[column]])
  )
  const exists = db
    .prepare(`SELECT 1 FROM ${quote(shape.table)} WHERE ${where} LIMIT 1`)
    .get(keyValues)

  const values = (names: readonly string[]) =>
    Object.fromEntries(names.map((column, index) => [`c${index}`, bindable(row[column])]))
  if (!exists) {
    db.prepare(
      `INSERT INTO ${quote(shape.table)} (${columns.map(quote).join(', ')})
       VALUES (${columns.map((_, index) => `@c${index}`).join(', ')})`
    ).run(values(columns))
    return {
      row: Object.fromEntries(columns.map((column) => [column, row[column]])),
      inserted: true
    }
  }

  const winners = columns.filter(
    (column) =>
      !keyColumns.includes(column) && (theirs.get(column) ?? '') > (ours.get(column) ?? '')
  )
  if (winners.length === 0) return null
  db.prepare(
    `UPDATE ${quote(shape.table)} SET ${winners.map((column, index) => `${quote(column)} = @c${index}`).join(', ')}
     WHERE ${where}`
  ).run({ ...values(winners), ...keyValues })
  return { row, inserted: false }
}

/** Whether a snapshot row is this project's: by its own column, or through its parent (already loaded). */
function rowBelongs(
  db: Database.Database,
  projectId: string,
  entry: SyncedTable | PersonalTable,
  row: Record<string, unknown>
): boolean {
  // A personal table's rows name no project: every row of the personal share is its own.
  if (!('project' in entry)) return true
  if ('column' in entry.project) return row[entry.project.column] === projectId
  const { column, table } = entry.project.via
  const parent = db
    .prepare(`SELECT project_id FROM ${quote(table)} WHERE id = @id`)
    .get({ id: bindable(row[column]) }) as { project_id: string } | undefined
  return parent?.project_id === projectId
}

/** JSON values better-sqlite3 can bind: objects and booleans are stored as JSON text and 0/1. */
function bindable(value: unknown): unknown {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  return value
}

/** The same project test as capture's triggers, on the alias `ROW`. */
function projectTest(entry: SyncedTable): string {
  const link =
    'column' in entry.project
      ? `ROW.${quote(entry.project.column)} = @projectId`
      : `(SELECT parent.project_id FROM ${quote(entry.project.via.table)} AS parent
          WHERE parent.id = ROW.${quote(entry.project.via.column)}) = @projectId`
  return entry.skipRow ? `${link} AND NOT (${entry.skipRow})` : link
}

/** The highest change-file sequence this device has written into the folder; 0 when none. */
async function highestPushed(transport: SyncTransport, deviceId: string): Promise<number> {
  let highest = 0
  for (const relativePath of await transport.list(`changes/${deviceId}`)) {
    const match = CHANGE_PATTERN.exec(relativePath.slice(relativePath.lastIndexOf('/') + 1))
    if (match && Number(match[1]) > highest) highest = Number(match[1])
  }
  return highest
}

function shareOf(db: Database.Database, projectId: string): ShareRow {
  const share = db
    .prepare(
      'SELECT share_id, member_id, device_id, kind FROM sync_shares WHERE project_id = @projectId'
    )
    .get({ projectId }) as ShareRow | undefined
  if (!share) throw new Error('Project is not shared')
  return share
}

/**
 * The rows of a personal table for a snapshot: the columns this PC keeps for itself are left
 * out, rows that do not travel are skipped, and sealed secrets are opened (the snapshot file
 * is sealed as a whole).
 */
function personalRows(
  db: Database.Database,
  table: string,
  entry: PersonalTable,
  shape: TableShape
): Record<string, unknown>[] {
  const omitted = new Set(entry.omitColumns ?? [])
  const sealed = new Set(entry.sealed ?? [])
  const sent = shape.columns.filter((column) => !omitted.has(column))
  const where = entry.skipRow ? `WHERE NOT (${entry.skipRow})` : ''
  const found = db
    .prepare(`SELECT ${sent.map(quote).join(', ')} FROM ${quote(table)} AS ROW ${where}`)
    .all() as Record<string, unknown>[]
  return found.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([column, value]) => [
        column,
        sealed.has(column) && typeof value === 'string' && value !== '' ? openSecret(value) : value
      ])
    )
  )
}

/** A personal snapshot row as this PC keeps it: own columns dropped, secrets sealed again. */
function arrivingRow(entry: PersonalTable, row: Record<string, unknown>): Record<string, unknown> {
  const omitted = new Set(entry.omitColumns ?? [])
  const sealed = new Set(entry.sealed ?? [])
  return Object.fromEntries(
    Object.entries(row)
      .filter(([column]) => !omitted.has(column))
      .map(([column, value]) => [
        column,
        sealed.has(column) && typeof value === 'string' && value !== '' ? sealSecret(value) : value
      ])
  )
}
