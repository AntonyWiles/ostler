/*
 * Captures every write to a shared project into `sync_outbox`, so the changes
 * can be written to the shared folder (docs/plans/integrations/shared-folder-sync.md,
 * "Capture"). It records any writer, not only the person's steps: the person,
 * the automation API, agents, rules and imports all go through the same
 * triggers. Changes applied from another PC are not captured again: they run
 * inside `withSyncApplying`, which turns the capture off. Each captured change
 * also records its columns' stamps in `sync_field_stamps` (`'*'` for a delete),
 * which the merge compares against. A person's own change names them as its
 * actor: the person who is Me on this PC.
 *
 * Like undo history (change-history/recorder.ts) the triggers are TEMP and made
 * again on each connection that attaches, so they are never part of the schema.
 * A project with no `sync_shares` row records nothing. The personal tables
 * (`PERSONAL_TABLES`, people-and-devices D13) are captured only while a
 * `sync_shares` row of kind `'personal'` exists, under the project id `'~personal'`.
 */
import type Database from 'better-sqlite3'
import { formatStamp, HybridClock, parseStamp, type ClockStamp } from '@shared/sync/clock'
import { openChangeContext } from './platform'
import { NOW_MS, quote, rowKey, tableShape, type TableShape } from '../change-history/table-shape'
import {
  PERSONAL_PROJECT_ID,
  PERSONAL_TABLES,
  SYNCED_TABLES,
  type PersonalTable,
  type ProjectLink,
  type SyncedTable
} from './synced-tables'

/** Nesting depth of `withSyncApplying`; capture is off while it is above zero. */
let applying = 0

const attached = new WeakSet<Database.Database>()

/** One clock per device id, shared by every connection in this process. */
const clocks = new Map<string, HybridClock>()

/** Runs `fn` while applying changes from another PC: nothing it writes is captured. Nests. */
export function withSyncApplying<T>(fn: () => T): T {
  applying += 1
  publishApplying()
  try {
    return fn()
  } finally {
    applying -= 1
    publishApplying()
  }
}

/** A stamp read from another PC's change: moves every local clock past it, so later local changes sort after it. */
export function observeRemoteStamp(stamp: ClockStamp): void {
  for (const clock of clocks.values()) clock.receive(stamp)
  for (const db of tableConnections) {
    const devices = db
      .prepare('SELECT device FROM ostler_sync_clock UNION SELECT device_id FROM sync_shares')
      .all() as { device: string }[]
    for (const { device } of devices) {
      const clock = new HybridClock(device, Date.now, readTableClock(db, device))
      clock.receive(stamp)
      writeTableClock(db, clock.last as ClockStamp)
    }
  }
}

/**
 * How the triggers learn three things: whether changes are being applied, who the actor is, and the
 * stamp for a change. On the desktop these are SQL functions registered on the connection. The phone's
 * database cannot register functions (op-sqlite has no such call), so there the same three answers
 * are read from two TEMP tables, `ostler_sync_state` and `ostler_sync_clock`, which this module keeps
 * up to date; the triggers advance the clock rows themselves (`tick`).
 */
interface CaptureSql {
  /** An expression: 1 while applying changes from another PC. */
  applying: string
  /** An expression: 'human' or 'system'. */
  actor: string
  /** An expression for the stamp of the change being captured, after `tick` ran. */
  stamp(deviceSql: string): string
  /** Statements run before the outbox insert to advance the device's clock; empty when `stamp` does it. */
  tick(deviceSql: string): string
}

const FUNCTION_SQL: CaptureSql = {
  applying: 'ostler_sync_applying()',
  actor: 'ostler_sync_actor()',
  stamp: (device) => `ostler_sync_stamp(${device})`,
  tick: () => ''
}

/** The same clock as `HybridClock.tick`, in SQL: the wall time is the later of the stored one and now; the counter counts stamps within one wall time. */
const TABLE_SQL: CaptureSql = {
  applying: '(SELECT applying > 0 FROM ostler_sync_state)',
  actor: '(SELECT actor FROM ostler_sync_state)',
  stamp: (device) =>
    `(SELECT printf('%015d-%06d-%s', wall, counter, device) FROM ostler_sync_clock WHERE device = ${device})`,
  tick: (device) =>
    `INSERT INTO ostler_sync_clock (device, wall, counter) VALUES (${device}, ${NOW_MS}, 0)
     ON CONFLICT (device) DO UPDATE SET counter = CASE WHEN excluded.wall > wall THEN 0 ELSE counter + 1 END, wall = MAX(wall, excluded.wall);`
}

/** Connections that keep their answers in tables: `withSyncApplying` and the clock helpers write them. */
const tableConnections = new Set<Database.Database>()

/** Stops keeping a table-mode connection's capture state up to date (call before closing it). */
export function releaseSyncCapture(db: Database.Database): void {
  tableConnections.delete(db)
}

function publishApplying(): void {
  for (const db of tableConnections) {
    try {
      db.prepare('UPDATE ostler_sync_state SET applying = ?').run(applying)
    } catch {
      tableConnections.delete(db)
    }
  }
}

function readTableClock(db: Database.Database, device: string): ClockStamp | null {
  const row = db
    .prepare('SELECT wall, counter FROM ostler_sync_clock WHERE device = ?')
    .get(device) as { wall: number; counter: number } | undefined
  return row ? formatStamp({ wall: row.wall, counter: row.counter, device }) : null
}

function writeTableClock(db: Database.Database, stamp: ClockStamp): void {
  const { wall, counter, device } = parseStamp(stamp)
  db.prepare(
    'INSERT OR REPLACE INTO ostler_sync_clock (device, wall, counter) VALUES (?, ?, ?)'
  ).run(device, wall, counter)
}

/**
 * Attaches the sync capture triggers to this connection (once; a no-op without `sync_shares`).
 * `answers: 'tables'` is for a connection that cannot register SQL functions (the phone).
 */
export function attachSyncCapture(
  db: Database.Database,
  options: { answers?: 'functions' | 'tables' } = {}
): void {
  if (attached.has(db)) return
  const hasShares = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_shares'")
    .get()
  if (!hasShares) return
  attached.add(db)
  const tables = options.answers === 'tables'
  const sql = tables ? TABLE_SQL : FUNCTION_SQL

  const devices = db.prepare('SELECT DISTINCT device_id FROM sync_shares').all() as {
    device_id: string
  }[]
  if (tables) {
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS ostler_sync_state (applying INTEGER NOT NULL, actor TEXT NOT NULL);
      CREATE TEMP TABLE IF NOT EXISTS ostler_sync_clock (device TEXT PRIMARY KEY, wall INTEGER NOT NULL, counter INTEGER NOT NULL);
      DELETE FROM ostler_sync_state;
      INSERT INTO ostler_sync_state (applying, actor) VALUES (${applying > 0 ? 1 : 0}, 'human');`)
    for (const { device_id } of devices) {
      const last = lastStampOf(db, device_id)
      if (last !== null && readTableClock(db, device_id) === null) writeTableClock(db, last)
    }
    tableConnections.add(db)
  } else {
    for (const { device_id } of devices) seedClock(db, device_id)
    db.function('ostler_sync_applying', { deterministic: false }, () => (applying > 0 ? 1 : 0))
    db.function('ostler_sync_actor', { deterministic: false }, () =>
      openChangeContext() ? 'human' : 'system'
    )
    db.function('ostler_sync_stamp', { deterministic: false }, (device: unknown) => {
      if (typeof device !== 'string') return null
      return clockFor(device).tick()
    })
  }
  for (const table of Object.keys(SYNCED_TABLES)) {
    const shape = tableShape(db, table)
    if (!shape) continue
    db.exec(triggersFor(shape, projectCapture(SYNCED_TABLES[table]), sql))
    db.exec(guardTriggersFor(shape, SYNCED_TABLES[table], sql))
  }
  for (const table of Object.keys(PERSONAL_TABLES)) {
    const shape = tableShape(db, table)
    if (!shape) continue
    db.exec(triggersFor(shape, personalCapture(shape, PERSONAL_TABLES[table]), sql))
  }
}

/** The latest stamp already stored for `device`, from the outbox and the field stamps; null when none. */
function lastStampOf(db: Database.Database, device: string): ClockStamp | null {
  const pattern = `%-${device}`
  const outbox = db
    .prepare('SELECT MAX(stamp) AS stamp FROM sync_outbox WHERE stamp LIKE ?')
    .get(pattern) as { stamp: string | null }
  const fields = db
    .prepare('SELECT MAX(stamp) AS stamp FROM sync_field_stamps WHERE stamp LIKE ?')
    .get(pattern) as { stamp: string | null }
  return [outbox.stamp, fields.stamp].reduce<string | null>(
    (largest, stamp) => (stamp !== null && (largest === null || stamp > largest) ? stamp : largest),
    null
  )
}

/**
 * Seeds this device's clock from the latest stamp already stored for it, when no clock exists yet.
 * Runs at attach time, never inside a trigger: a user function must not query the connection running it.
 */
function seedClock(db: Database.Database, device: string): void {
  if (clocks.has(device)) return
  clocks.set(device, new HybridClock(device, Date.now, lastStampOf(db, device)))
}

/** A new stamp from this device's clock, for a change sync itself makes here (a renumbered task). */
export function localStamp(device: string): ClockStamp {
  // The connection that keeps this device's clock in tables, if any (a process may hold both kinds).
  const db = [...tableConnections].find((candidate) =>
    candidate.prepare('SELECT 1 FROM sync_shares WHERE device_id = ?').get(device)
  )
  if (db) {
    const stamp = new HybridClock(device, Date.now, readTableClock(db, device)).tick()
    writeTableClock(db, stamp)
    return stamp
  }
  return clockFor(device).tick()
}

/** The stored clock for this device; creates a fresh one (no query) when none was seeded. */
function clockFor(device: string): HybridClock {
  let clock = clocks.get(device)
  if (!clock) {
    clock = new HybridClock(device, Date.now, null)
    clocks.set(device, clock)
  }
  return clock
}

/** The project a row belongs to, read from the row itself (or from its parent row), as SQL. */
function projectScope(link: ProjectLink, prefix: 'OLD.' | 'NEW.'): string {
  return 'column' in link
    ? `${prefix}${quote(link.column)}`
    : `(SELECT project_id FROM ${quote(link.via.table)} WHERE id = ${prefix}${quote(link.via.column)})`
}

/**
 * What one table's triggers capture: the outbox project a row is written under, the test
 * that its change is shared, the device it is stamped with, and the columns and values sent.
 */
interface Capture {
  key?: readonly string[]
  skipRow?: string
  scope(prefix: 'OLD.' | 'NEW.'): string
  shared(prefix: 'OLD.' | 'NEW.'): string
  device(prefix: 'OLD.' | 'NEW.'): string
  /** The columns sent; empty means every column of the table. */
  columns: readonly string[]
  /** The SQL value of one sent column of a row, as stored (a sealed column stays sealed). */
  value(column: string, prefix: 'OLD.' | 'NEW.'): string
}

function projectCapture(entry: SyncedTable): Capture {
  const scope = (prefix: 'OLD.' | 'NEW.') => projectScope(entry.project, prefix)
  return {
    key: entry.keyColumns,
    skipRow: entry.skipRow,
    scope,
    shared: (prefix) =>
      `${scope(prefix)} IN (SELECT project_id FROM sync_shares WHERE kind = 'project')`,
    device: (prefix) =>
      `(SELECT device_id FROM sync_shares WHERE kind = 'project' AND project_id = ${scope(prefix)})`,
    columns: [],
    value: (column, prefix) => `${prefix}${quote(column)}`
  }
}

function personalCapture(shape: TableShape, entry: PersonalTable): Capture {
  const omitted = new Set(entry.omitColumns ?? [])
  const shared = "EXISTS (SELECT 1 FROM sync_shares WHERE kind = 'personal')"
  return {
    key: entry.keyColumns,
    skipRow: entry.skipRow,
    scope: () => `'${PERSONAL_PROJECT_ID}'`,
    shared: () => shared,
    device: () => "(SELECT device_id FROM sync_shares WHERE kind = 'personal')",
    columns: shape.columns.filter((column) => !omitted.has(column)),
    // A sealed column stays sealed in the outbox; push opens it into the encrypted file (sync-runner.ts).
    value: (column, prefix) => `${prefix}${quote(column)}`
  }
}

/**
 * On a PC whose own person is a Viewer of a share, the database refuses any write
 * to that project's shared rows (D9, overview.md), so no screen has to hide its
 * controls. A Viewer may still write their own comments. Received changes run
 * inside `withSyncApplying`, which these triggers let through.
 */
function guardTriggersFor(shape: TableShape, entry: SyncedTable, sql: CaptureSql): string {
  const { table } = shape
  const link = entry.project
  const viewer = (prefix: 'OLD.' | 'NEW.') =>
    `EXISTS (SELECT 1 FROM sync_shares WHERE project_id = ${projectScope(link, prefix)} AND my_role = 'viewer')`
  const own = (prefix: 'OLD.' | 'NEW.') =>
    table === 'planning_comments'
      ? `${prefix}${quote('author_person_id')} IS (SELECT id FROM people WHERE is_me = 1)`
      : table === 'shared_away'
        ? `${prefix}${quote('person_id')} IS (SELECT id FROM people WHERE is_me = 1)`
        : '0'
  const refuse = (
    suffix: string,
    when: string,
    timing: string,
    op: string,
    message = 'ostler:read-only'
  ) =>
    `CREATE TEMP TRIGGER IF NOT EXISTS ${quote(`ostler_sync_guard_${table}_${suffix}`)} ${timing} ${op} ON main.${quote(table)}
    WHEN NOT ${sql.applying} AND ${when} BEGIN SELECT RAISE(ABORT, '${message}'); END;`
  // A Contributor (D5) writes only their own comments and work on tasks assigned to them.
  const contributor = (prefix: 'OLD.' | 'NEW.') =>
    `EXISTS (SELECT 1 FROM sync_shares WHERE project_id = ${projectScope(link, prefix)} AND my_role = 'contributor')`
  const me = '(SELECT id FROM people WHERE is_me = 1)'
  const mine = (prefix: 'OLD.' | 'NEW.') =>
    `${prefix}${quote('work_item_id')} IN (SELECT id FROM planning_work_items WHERE assignee_id = ${me})`
  /** Whether a Contributor may make this write besides writing their own comment. */
  const allowedForContributor = (op: 'insert' | 'update' | 'delete'): string => {
    const both = (test: (prefix: 'OLD.' | 'NEW.') => string) =>
      op === 'insert'
        ? test('NEW.')
        : op === 'delete'
          ? test('OLD.')
          : `(${test('OLD.')} AND ${test('NEW.')})`
    if (table === 'planning_work_items') {
      return op === 'update'
        ? `(OLD.${quote('assignee_id')} = ${me} AND NEW.${quote('assignee_id')} = ${me})`
        : '0'
    }
    if (
      table === 'planning_checklist_checks' ||
      table === 'planning_time_blocks' ||
      table === 'planning_blockers'
    ) {
      return both(mine)
    }
    if (table === 'planning_time_entries')
      return both((prefix) => `${prefix}${quote('person_id')} = ${me}`)
    return '0'
  }
  // Sign-offs (D9): a Viewer or Contributor answers only a sign-off addressed to them, changing
  // nothing but the answer; a Contributor may also ask for one on a task assigned to them, and
  // take their own waiting request back. Everything else is refused.
  if (table === 'planning_sign_offs') {
    const answerOnly = `OLD.approver_person_id IS ${me}
      AND NEW.id IS OLD.id AND NEW.project_id IS OLD.project_id
      AND NEW.item_kind IS OLD.item_kind AND NEW.item_id IS OLD.item_id
      AND NEW.approver_person_id IS OLD.approver_person_id
      AND NEW.requested_by_person_id IS OLD.requested_by_person_id
      AND NEW.requested_at IS OLD.requested_at`
    const ownTaskRequest = `NEW.state = 'waiting' AND NEW.item_kind = 'task'
      AND NEW.requested_by_person_id IS ${me}
      AND NEW.item_id IN (SELECT id FROM planning_work_items WHERE assignee_id = ${me})`
    const ownWaiting = `OLD.requested_by_person_id IS ${me} AND OLD.state = 'waiting'`
    const either = (test: (prefix: 'OLD.' | 'NEW.') => string) =>
      `(${test('OLD.')} OR ${test('NEW.')})`
    return [
      refuse('insert', viewer('NEW.'), 'BEFORE', 'INSERT'),
      refuse('update', `${either(viewer)} AND NOT (${answerOnly})`, 'BEFORE', 'UPDATE'),
      refuse('delete', viewer('OLD.'), 'BEFORE', 'DELETE'),
      refuse(
        'contributor_insert',
        `${contributor('NEW.')} AND NOT (${ownTaskRequest})`,
        'BEFORE',
        'INSERT',
        'ostler:contributor-only'
      ),
      refuse(
        'contributor_update',
        `${either(contributor)} AND NOT (${answerOnly})`,
        'BEFORE',
        'UPDATE',
        'ostler:contributor-only'
      ),
      refuse(
        'contributor_delete',
        `${contributor('OLD.')} AND NOT (${ownWaiting})`,
        'BEFORE',
        'DELETE',
        'ostler:contributor-only'
      )
    ].join('\n')
  }
  const refuseContributor = (op: 'insert' | 'update' | 'delete') => {
    const when =
      op === 'insert'
        ? `${contributor('NEW.')} AND NOT (${own('NEW.')} OR ${allowedForContributor(op)})`
        : op === 'delete'
          ? `${contributor('OLD.')} AND NOT (${own('OLD.')} OR ${allowedForContributor(op)})`
          : `(${contributor('OLD.')} OR ${contributor('NEW.')}) AND NOT ((${own('OLD.')} AND ${own('NEW.')}) OR ${allowedForContributor(op)})`
    return refuse(`contributor_${op}`, when, 'BEFORE', op.toUpperCase(), 'ostler:contributor-only')
  }
  return [
    refuse('insert', `${viewer('NEW.')} AND NOT (${own('NEW.')})`, 'BEFORE', 'INSERT'),
    refuse(
      'update',
      `(${viewer('OLD.')} OR ${viewer('NEW.')}) AND NOT (${own('OLD.')} AND ${own('NEW.')})`,
      'BEFORE',
      'UPDATE'
    ),
    refuse('delete', `${viewer('OLD.')} AND NOT (${own('OLD.')})`, 'BEFORE', 'DELETE'),
    refuseContributor('insert'),
    refuseContributor('update'),
    refuseContributor('delete')
  ].join('\n')
}

function triggersFor(shape: TableShape, capture: Capture, sql: CaptureSql): string {
  const { table } = shape
  const columns = capture.columns.length > 0 ? capture.columns : shape.columns
  const key = capture.key ?? shape.keyColumns
  const { scope, shared, device } = capture
  const keep = (prefix: 'OLD.' | 'NEW.') =>
    capture.skipRow ? ` AND NOT (${capture.skipRow.replace(/\bROW\./g, prefix)})` : ''
  // The outbox row, then its field stamps (read back by id, so the stamp is not made twice).
  const outbox = (prefix: 'OLD.' | 'NEW.', op: 'upsert' | 'delete', columnsSql: string) => {
    const insert = `${sql.tick(device(prefix))}
     INSERT INTO sync_outbox (project_id, table_name, row_key, op, columns, stamp, actor_kind, actor_person_id, created_at)
     VALUES (${scope(prefix)}, '${table}', ${rowKey(key, prefix)}, '${op}', ${columnsSql},
       ${sql.stamp(device(prefix))}, ${sql.actor},
       CASE ${sql.actor} WHEN 'human' THEN (SELECT id FROM people WHERE is_me = 1) END, ${NOW_MS});`
    const stamps =
      op === 'upsert'
        ? `INSERT OR REPLACE INTO sync_field_stamps (table_name, row_key, column_name, stamp, project_id)
     SELECT o.table_name, o.row_key, je.key, o.stamp, o.project_id FROM sync_outbox AS o, json_each(o.columns) AS je
     WHERE o.id = last_insert_rowid();`
        : `INSERT OR REPLACE INTO sync_field_stamps (table_name, row_key, column_name, stamp, project_id)
     SELECT o.table_name, o.row_key, '*', o.stamp, o.project_id FROM sync_outbox AS o WHERE o.id = last_insert_rowid();`
    return `${insert} ${stamps}`
  }
  // A row's image: every sent column with its value.
  const image = (prefix: 'OLD.' | 'NEW.') =>
    `json_object(${columns.map((column) => `'${column}', ${capture.value(column, prefix)}`).join(', ')})`
  // The columns that changed, as a JSON object of their new values.
  const changed = `(SELECT json_group_object(k, v) FROM (${columns
    .map(
      (column) =>
        `SELECT '${column}' AS k, ${capture.value(column, 'NEW.')} AS v WHERE OLD.${quote(column)} IS NOT NEW.${quote(column)}`
    )
    .join(' UNION ALL ')}))`
  const anyChange = `(${columns.map((column) => `OLD.${quote(column)} IS NOT NEW.${quote(column)}`).join(' OR ')})`
  const name = (suffix: string) => quote(`ostler_sync_${table}_${suffix}`)
  return `
    CREATE TEMP TRIGGER IF NOT EXISTS ${name('insert')} AFTER INSERT ON main.${quote(table)}
    WHEN NOT ${sql.applying} AND ${shared('NEW.')}${keep('NEW.')} BEGIN ${outbox('NEW.', 'upsert', image('NEW.'))} END;
    CREATE TEMP TRIGGER IF NOT EXISTS ${name('update')} AFTER UPDATE ON main.${quote(table)}
    WHEN NOT ${sql.applying} AND ${shared('NEW.')} AND ${rowKey(key, 'OLD.')} IS ${rowKey(key, 'NEW.')}
      AND ${anyChange}${keep('NEW.')} BEGIN ${outbox('NEW.', 'upsert', changed)} END;
    CREATE TEMP TRIGGER IF NOT EXISTS ${name('rekey')} AFTER UPDATE ON main.${quote(table)}
    WHEN NOT ${sql.applying} AND ${shared('NEW.')} AND ${rowKey(key, 'OLD.')} IS NOT ${rowKey(key, 'NEW.')}${keep('NEW.')}
      BEGIN ${outbox('OLD.', 'delete', "'{}'")} ${outbox('NEW.', 'upsert', image('NEW.'))} END;
    CREATE TEMP TRIGGER IF NOT EXISTS ${name('delete')} AFTER DELETE ON main.${quote(table)}
    WHEN NOT ${sql.applying} AND ${shared('OLD.')}${keep('OLD.')} BEGIN ${outbox('OLD.', 'delete', "'{}'")} END;
  `
}
