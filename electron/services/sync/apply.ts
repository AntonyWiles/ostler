/*
 * Applies changes received from another PC to this PC's database
 * (docs/plans/integrations/shared-folder-sync.md, "Apply"). Each field keeps the
 * stamp of its last change, and a change to a field wins only when its stamp is
 * later than that field's stored stamp, so the later edit of each field wins and
 * edits to different fields of one row all survive. A delete writes the row's
 * tombstone (`'*'` in sync_field_stamps): an older change loses to it, and a
 * newer change re-creates the row. A change whose parent row has not arrived yet
 * waits in sync_pending and is retried after each batch.
 *
 * Two PCs can give two new tasks the same number. The task whose number was set
 * later takes the project's next free number, as a change of this PC's own that
 * goes out to the others (decision 1), and the task's activity says so. After
 * each batch the project's task counter moves past every number received.
 *
 * Only raw SQL runs here. Nothing applied is captured again (`withSyncApplying`),
 * recorded as undo (no change context), or runs rules or notifications: those
 * side effects stay on the PC that made the change. What a received change does
 * write here is its activity: a task's field edits, status and creation are
 * recorded the way PlanningService records them, naming the sender (D10), and a
 * change of assignee is reported so the assignee can be told (D11).
 */
import type Database from 'better-sqlite3'
import { compareStamps, parseStamp } from '@shared/sync/clock'
import { BRAND } from '@shared/brand'
import { mentionsIn } from '@shared/mentions'
import { quote, tableShape, type TableShape } from '../change-history/table-shape'
import { sealSecret } from './platform'
import { localStamp, observeRemoteStamp, withSyncApplying } from './capture'
import type { SyncChange } from './change-file'
import { advanceTaskCounter, takeTaskNumber } from './task-numbers'
import {
  PERSONAL_TABLES,
  SYNCED_TABLES,
  type PersonalTable,
  type SyncedTable
} from './synced-tables'

/** A task whose assignee a received change set: `from` and `to` are people ids, null for nobody. */
export interface AssignedTask {
  projectId: string
  taskId: string
  from: string | null
  to: string | null
  /** The person who made the change; null when the change carried none. */
  byPersonId: string | null
}

/** A comment that arrived (was inserted, not edited) and mentions people. */
export interface MentionedComment {
  projectId: string
  taskId: string
  commentId: string
  /** The person who wrote it; null when the change carried none. */
  byPersonId: string | null
  /** The people its body mentions, once each. */
  personIds: string[]
}

/** A task a received change touched (a field change, or a new comment on it). */
export interface ChangedTask {
  projectId: string
  taskId: string
  /** The person who made the change; null when the change carried none. */
  byPersonId: string | null
}

/** A sign-off request or answer a received change wrote (prompt 17): the row as it now stands. */
export interface ArrivedSignOff {
  projectId: string
  signOffId: string
  itemKind: 'task' | 'decision' | 'milestone'
  itemId: string
  approverPersonId: string
  requestedByPersonId: string | null
  state: 'waiting' | 'approved' | 'changes'
  /** The person who made the change; null when the change carried none. */
  byPersonId: string | null
}

export interface ApplyResult {
  /** Changes that wrote at least one field (or deleted a row). */
  applied: number
  /** Changes that lost to newer local stamps, or that were not for this project. */
  skipped: number
  /** Changes left waiting in sync_pending after this call. */
  pending: number
  /** Tasks whose assignee this call changed, in the order they were applied. */
  assigned: AssignedTask[]
  /** Comments this call inserted that mention someone, in the order they were applied. */
  mentioned: MentionedComment[]
  /** Tasks this call changed, or commented on, in the order they were applied. */
  changed: ChangedTask[]
  /** Sign-off rows this call wrote, in the order they were applied. */
  signOffs: ArrivedSignOff[]
  /**
   * Whether this call changed what the PC's agent dispatch reads: a blocker, or a task's
   * status. The PC evaluates dispatch again, as after the same change made in its own window.
   */
  dispatchInputs: boolean
}

/**
 * A change as it is applied. The actor is kept for the activity it writes; a
 * change read back from sync_pending from before its actor was kept has none.
 */
type Change = Omit<SyncChange, 'actor'> & { actor?: SyncChange['actor'] }

/** `applied` or `skipped`, or the `waiting_for` a change that could not be applied yet waits on. */
type Outcome = 'applied' | 'skipped' | 'parent' | 'conflict'

interface Context {
  db: Database.Database
  shareId: string
  projectId: string
  /** Whether the share is the personal share: its tables are the personal ones, with no project. */
  personal: boolean
  shapes: Map<string, TableShape | null>
  assigned: AssignedTask[]
  mentioned: MentionedComment[]
  changed: ChangedTask[]
  signOffs: ArrivedSignOff[]
  /** A blocker or a task's status was applied (`ApplyResult.dispatchInputs`). */
  dispatchInputs: boolean
  /** The sign-off row of the savepoint being applied; kept only if that savepoint commits. */
  inFlightSignOff: ArrivedSignOff | null
  /** The assignee change of the savepoint being applied; kept only if that savepoint commits. */
  inFlight: AssignedTask | null
  /** The mention of the savepoint being applied; kept only if that savepoint commits. */
  inFlightMention: MentionedComment | null
  /** The task change of the savepoint being applied; kept only if that savepoint commits. */
  inFlightChange: ChangedTask | null
}

/** The existing row for a change's key: its rowid, and the value of the column that links it to its project. */
interface Found {
  rid: number
  link: unknown
}

interface PendingRow {
  id: number
  table_name: string
  row_key: string
  op: 'upsert' | 'delete'
  columns: string
  stamp: string
  actor: string | null
}

export function applyChanges(
  db: Database.Database,
  shareId: string,
  changes: readonly SyncChange[]
): ApplyResult {
  const share = shareRow(db, shareId)
  if (!share) throw new Error('Unknown share')
  // Cannot change inside a transaction, so it is set before the one below opens.
  db.pragma('foreign_keys = ON')

  const ctx = newContext(db, shareId, share.project_id, share.kind === 'personal')
  const sorted = [...changes]
    .sort((a, b) => compareStamps(a.stamp, b.stamp))
    .map((change) => (ctx.personal ? arriving(change) : change))
  let applied = 0
  let skipped = 0

  withSyncApplying(() =>
    db.transaction(() => {
      for (const change of sorted) {
        observeRemoteStamp(change.stamp)
        let outcome = attempt(ctx, change)
        if (outcome === 'conflict') outcome = resolveNumberClash(ctx, change)
        if (outcome === 'applied') applied++
        else if (outcome === 'skipped') skipped++
        else toPending(ctx, change, outcome)
      }
      const retried = retryPending(ctx)
      applied += retried.applied
      skipped += retried.skipped
      if (!ctx.personal) advanceTaskCounter(ctx.db, ctx.projectId)
    })()
  )

  return {
    applied,
    skipped,
    pending: countPending(ctx),
    assigned: ctx.assigned,
    mentioned: ctx.mentioned,
    changed: ctx.changed,
    signOffs: ctx.signOffs,
    dispatchInputs: ctx.dispatchInputs
  }
}

function shareRow(
  db: Database.Database,
  shareId: string
): { project_id: string; kind: 'project' | 'personal' } | undefined {
  return db
    .prepare('SELECT project_id, kind FROM sync_shares WHERE share_id = @shareId')
    .get({ shareId }) as { project_id: string; kind: 'project' | 'personal' } | undefined
}

function newContext(
  db: Database.Database,
  shareId: string,
  projectId: string,
  personal: boolean
): Context {
  return {
    db,
    shareId,
    projectId,
    personal,
    shapes: new Map(),
    assigned: [],
    mentioned: [],
    changed: [],
    signOffs: [],
    dispatchInputs: false,
    inFlightSignOff: null,
    inFlight: null,
    inFlightMention: null,
    inFlightChange: null
  }
}

/**
 * A personal change as it arrives here: the columns this PC keeps for itself are dropped, and
 * a sealed secret (sent opened) is sealed again with this PC's own key (personal-tables, D14).
 * Done once, before the change is stored, so a waiting change is not sealed twice.
 */
function arriving(change: Change): Change {
  if (change.op === 'delete' || !hasOwn(PERSONAL_TABLES, change.table)) return change
  const entry = PERSONAL_TABLES[change.table]
  const omitted = new Set(entry.omitColumns ?? [])
  const sealed = new Set(entry.sealed ?? [])
  const columns: Record<string, unknown> = {}
  for (const [column, value] of Object.entries(change.columns)) {
    if (omitted.has(column)) continue
    columns[column] =
      sealed.has(column) && typeof value === 'string' && value !== '' ? sealSecret(value) : value
  }
  return { ...change, columns }
}

/** The registry a share's changes are checked against: a personal share carries only the personal tables. */
function entryOf(ctx: Context, table: string): SyncedTable | PersonalTable | null {
  const registry: Record<string, SyncedTable | PersonalTable> = ctx.personal
    ? PERSONAL_TABLES
    : SYNCED_TABLES
  return hasOwn(registry, table) ? registry[table] : null
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

/**
 * Retries the share's waiting changes now, outside a pull: after something they
 * may have waited for arrived another way (a person). Returns how many are left.
 */
export function retryWaiting(db: Database.Database, shareId: string): ApplyResult {
  const share = shareRow(db, shareId)
  if (!share) throw new Error('Unknown share')
  db.pragma('foreign_keys = ON')
  const ctx = newContext(db, shareId, share.project_id, share.kind === 'personal')
  const counts = withSyncApplying(() =>
    db.transaction(() => {
      const retried = retryPending(ctx)
      if (!ctx.personal) advanceTaskCounter(db, ctx.projectId)
      return retried
    })()
  )
  return {
    ...counts,
    pending: countPending(ctx),
    assigned: ctx.assigned,
    mentioned: ctx.mentioned,
    changed: ctx.changed,
    signOffs: ctx.signOffs,
    dispatchInputs: ctx.dispatchInputs
  }
}

/** Applies one change in its own savepoint. A constraint error leaves the change to wait instead of failing the batch. */
function attempt(ctx: Context, change: Change): Outcome {
  ctx.inFlight = null
  ctx.inFlightMention = null
  ctx.inFlightChange = null
  ctx.inFlightSignOff = null
  try {
    const outcome = ctx.db.transaction(() => applyOne(ctx, change))()
    if (outcome === 'applied' && ctx.inFlight) ctx.assigned.push(ctx.inFlight)
    if (outcome === 'applied' && ctx.inFlightMention) ctx.mentioned.push(ctx.inFlightMention)
    if (outcome === 'applied' && ctx.inFlightChange) ctx.changed.push(ctx.inFlightChange)
    if (outcome === 'applied' && ctx.inFlightSignOff) ctx.signOffs.push(ctx.inFlightSignOff)
    if (outcome === 'applied' && changesDispatchInputs(change)) ctx.dispatchInputs = true
    return outcome
  } catch (error) {
    const code = errorCode(error)
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY' || code === 'SQLITE_CONSTRAINT_NOTNULL') {
      return 'parent'
    }
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return 'conflict'
    }
    throw error
  }
}

/** A blocker, or a task's status (or the task itself going): what agent dispatch is gated on. */
function changesDispatchInputs(change: Change): boolean {
  if (change.table === 'planning_blockers') return true
  return (
    change.table === 'planning_work_items' && (change.op === 'delete' || 'status' in change.columns)
  )
}

function errorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : null
}

function applyOne(ctx: Context, change: Change): Outcome {
  const entry = entryOf(ctx, change.table)
  if (!entry) return 'skipped'
  const shape = shapeOf(ctx, change.table)
  if (!shape) return 'skipped'
  const keyColumns = entry.keyColumns ?? shape.keyColumns
  if (!isKeyOf(change.rowKey, keyColumns.length)) return 'skipped'

  // A personal row names no project, so it has no project link to check.
  const link = ctx.personal ? null : linkOf(entry as SyncedTable)
  if (link !== null && !shape.columns.includes(link)) return 'skipped'
  const found = findRow(ctx, shape.table, keyColumns, change.rowKey, link)

  // Nothing local to delete, so no project to check; the tombstone only blocks older upserts for this key.
  if (change.op === 'delete' && found === null) {
    return applyDelete(ctx, change, shape.table, null, storedStamps(ctx, change))
  }

  const owner = link === null ? 'ok' : belongs(ctx, entry as SyncedTable, link, change, found)
  if (owner === 'parent') return 'parent'
  if (owner === 'other') return 'skipped'

  const stamps = storedStamps(ctx, change)
  return change.op === 'delete'
    ? applyDelete(ctx, change, shape.table, found, stamps)
    : applyUpsert(ctx, change, shape, keyColumns, found, stamps)
}

function shapeOf(ctx: Context, table: string): TableShape | null {
  if (!ctx.shapes.has(table)) ctx.shapes.set(table, tableShape(ctx.db, table))
  return ctx.shapes.get(table) ?? null
}

function isKeyOf(rowKey: string, count: number): boolean {
  try {
    const key: unknown = JSON.parse(rowKey)
    return Array.isArray(key) && key.length === count
  } catch {
    return false
  }
}

/** The column that links a project row to its project (or to its parent row, for a `via` table). */
function linkOf(entry: SyncedTable): string {
  return 'column' in entry.project ? entry.project.column : entry.project.via.column
}

function findRow(
  ctx: Context,
  table: string,
  keyColumns: readonly string[],
  rowKey: string,
  link: string | null
): Found | null {
  const where = keyColumns
    .map((column, index) => `${quote(column)} IS json_extract(@key, '$[${index}]')`)
    .join(' AND ')
  const linked = link === null ? 'NULL' : quote(link)
  const row = ctx.db
    .prepare(`SELECT rowid AS rid, ${linked} AS link FROM ${quote(table)} WHERE ${where} LIMIT 1`)
    .get({ key: rowKey }) as Found | undefined
  return row ?? null
}

/**
 * Whether the change is for this project. `parent` means the row's parent (for a
 * `via` table) is not here yet, so the change waits.
 */
function belongs(
  ctx: Context,
  entry: SyncedTable,
  link: string,
  change: Change,
  found: Found | null
): 'ok' | 'other' | 'parent' {
  const value = Object.prototype.hasOwnProperty.call(change.columns, link)
    ? change.columns[link]
    : found?.link

  if ('column' in entry.project) return value === ctx.projectId ? 'ok' : 'other'

  if (typeof value !== 'string') return 'parent'
  const parent = ctx.db
    .prepare(`SELECT project_id FROM ${quote(entry.project.via.table)} WHERE id = @id`)
    .get({ id: value }) as { project_id: unknown } | undefined
  if (!parent) return 'parent'
  return parent.project_id === ctx.projectId ? 'ok' : 'other'
}

/** The stored stamps of one row's fields, keyed by column name; `'*'` is the tombstone. */
function storedStamps(ctx: Context, change: Change): Map<string, string> {
  const rows = ctx.db
    .prepare(
      `SELECT column_name, stamp FROM sync_field_stamps
       WHERE table_name = @table AND row_key = @key`
    )
    .all({ table: change.table, key: change.rowKey }) as {
    column_name: string
    stamp: string
  }[]
  return new Map(rows.map((row) => [row.column_name, row.stamp]))
}

function applyDelete(
  ctx: Context,
  change: Change,
  table: string,
  found: Found | null,
  stamps: Map<string, string>
): Outcome {
  const tombstone = stamps.get('*')
  if (tombstone !== undefined && compareStamps(tombstone, change.stamp) >= 0) return 'skipped'
  writeStamp(ctx, change, '*', change.stamp)

  if (found) {
    // A field edited later than this delete keeps the row.
    const newerEdit = Array.from(stamps).some(
      ([column, stamp]) => column !== '*' && compareStamps(stamp, change.stamp) > 0
    )
    if (!newerEdit) {
      ctx.db.prepare(`DELETE FROM ${quote(table)} WHERE rowid = @rid`).run({ rid: found.rid })
    }
  }
  return 'applied'
}

function applyUpsert(
  ctx: Context,
  change: Change,
  shape: TableShape,
  keyColumns: readonly string[],
  found: Found | null,
  stamps: Map<string, string>
): Outcome {
  const tombstone = stamps.get('*')
  // A field wins only when this change is later than its stored stamp and than the row's tombstone.
  const winners = Object.keys(change.columns).filter((column) => {
    if (!shape.columns.includes(column)) return false
    const stored = stamps.get(column)
    if (stored !== undefined && compareStamps(stored, change.stamp) >= 0) return false
    return tombstone === undefined || compareStamps(tombstone, change.stamp) < 0
  })
  if (winners.length === 0) return 'skipped'

  const table = quote(shape.table)
  const values = JSON.stringify(change.columns)
  const isTask = shape.table === WORK_ITEMS
  // The task's values before this change, for the activity it writes; a new row had none.
  const before = found && isTask ? currentValues(ctx, shape.table, found.rid, winners) : {}
  if (found) {
    if (isTask && winners.includes('description')) {
      keepReplacedDescription(ctx, found, change, stamps.get('description'))
    }
    const sets = winners.map(
      (column) => `${quote(column)} = json_extract(@values, '$.${quote(column)}')`
    )
    ctx.db
      .prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE rowid = @rid`)
      .run({ values, rid: found.rid })
  } else {
    // The key columns come from the row key; the other winners from the values.
    const columns = [
      ...keyColumns.map((column, index) => ({
        column,
        expr: `json_extract(@key, '$[${index}]')`
      })),
      ...winners
        .filter((column) => !keyColumns.includes(column))
        .map((column) => ({ column, expr: `json_extract(@values, '$.${quote(column)}')` }))
    ]
    ctx.db
      .prepare(
        `INSERT INTO ${table} (${columns.map((c) => quote(c.column)).join(', ')})
         VALUES (${columns.map((c) => c.expr).join(', ')})`
      )
      .run({ key: change.rowKey, values })
  }

  if (isTask) recordTaskChange(ctx, change, before, winners, !found)
  if (isTask && found) noteChange(ctx, workItemId(change), change)
  if (shape.table === COMMENTS && !found) {
    const taskId = change.columns.work_item_id
    if (typeof taskId === 'string') noteChange(ctx, taskId, change)
  }
  // Only a comment that is new here can mention anyone; an edit adding a mention later says nothing.
  if (shape.table === COMMENTS && !found) noteMentions(ctx, change)
  if (shape.table === SIGN_OFFS) noteSignOff(ctx, change)
  for (const column of winners) writeStamp(ctx, change, column, change.stamp)
  return 'applied'
}

/** Field names PlanningService records for each task column (planning-activity.ts, `recordUpdate`). Status has its own history. */
const ACTIVITY_FIELDS: Record<string, string> = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  assignee_id: 'assignee',
  start_date: 'startDate',
  target_date: 'dueDate',
  show_from: 'showFrom',
  someday: 'someday',
  estimate: 'estimate',
  impact: 'impact',
  effort: 'effort',
  milestone_id: 'milestone',
  iteration_id: 'iteration',
  type_id: 'type',
  labels: 'labels'
}

/** The stored values of some columns of one row, before a change is applied. */
function currentValues(
  ctx: Context,
  table: string,
  rid: number,
  columns: readonly string[]
): Record<string, unknown> {
  if (columns.length === 0) return {}
  const row = ctx.db
    .prepare(
      `SELECT ${columns.map((column) => quote(column)).join(', ')} FROM ${quote(table)} WHERE rowid = @rid`
    )
    .get({ rid }) as Record<string, unknown> | undefined
  return row ?? {}
}

/**
 * Writes the activity a received task change makes on this PC (D10): a
 * "created" line for a new task, otherwise one row per field that differs,
 * the status history for a status change, all naming the change's sender. It
 * also notes a change of assignee for `applyChanges` to report (D11).
 */
function recordTaskChange(
  ctx: Context,
  change: Change,
  before: Record<string, unknown>,
  winners: readonly string[],
  created: boolean
): void {
  const id = workItemId(change)
  const actor = change.actor ?? { kind: 'system' }
  const at = parseStamp(change.stamp).wall

  if (created) insertActivity(ctx, id, 'created', undefined, undefined, actor, at)
  for (const column of winners) {
    if (column === 'status') {
      if (!created && before.status !== change.columns.status) {
        ctx.db
          .prepare(
            `INSERT INTO planning_status_history
               (work_item_id, from_status, to_status, at, actor_kind, actor_person_id, rule_name)
             VALUES (@id, @from, @to, @at, @kind, @person, NULL)`
          )
          .run({
            id,
            from: before.status ?? null,
            to: change.columns.status,
            at,
            kind: actor.kind,
            person: actor.personId ?? null
          })
      }
      continue
    }
    if (created || !ACTIVITY_FIELDS[column]) continue
    const from = activityValue(column, before[column])
    const to = activityValue(column, change.columns[column])
    if (sameActivity(column, from, to)) continue
    // Like PlanningService, a description's text is not kept in the row, only that it changed.
    if (column === 'description')
      insertActivity(ctx, id, 'description', undefined, undefined, actor, at)
    else insertActivity(ctx, id, ACTIVITY_FIELDS[column], from, to, actor, at)
  }

  if (winners.includes('assignee_id')) {
    const from = (before.assignee_id ?? null) as string | null
    const to = (change.columns.assignee_id ?? null) as string | null
    if (from !== to) {
      ctx.inFlight = {
        projectId: ctx.projectId,
        taskId: id,
        from,
        to,
        byPersonId: actor.personId ?? null
      }
    }
  }
}

function insertActivity(
  ctx: Context,
  id: string,
  field: string,
  from: unknown,
  to: unknown,
  actor: NonNullable<Change['actor']>,
  at: number
): void {
  ctx.db
    .prepare(
      `INSERT INTO planning_field_changes (project_id, work_item_id, field, from_value, to_value, actor_kind, actor_person_id, metadata, at)
       VALUES (@projectId, @id, @field, @from, @to, @kind, @person, NULL, @at)`
    )
    .run({
      projectId: ctx.projectId,
      id,
      field,
      from: from === undefined ? null : JSON.stringify(from),
      to: to === undefined ? null : JSON.stringify(to),
      kind: actor.kind,
      person: actor.personId ?? null,
      at
    })
}

/** A stored column value as PlanningService holds it: labels as a list, someday as a flag. */
function activityValue(column: string, raw: unknown): unknown {
  if (column === 'labels') {
    if (Array.isArray(raw)) return raw
    try {
      const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : null
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  if (column === 'someday') return Boolean(raw)
  return raw ?? null
}

/** Whether two activity values are the same; labels are a set, as in PlanningService. */
function sameActivity(column: string, a: unknown, b: unknown): boolean {
  if (column === 'labels') {
    const sorted = (list: unknown) => JSON.stringify([...(list as string[])].sort())
    return sorted(a) === sorted(b)
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

function workItemId(change: Change): string {
  return (JSON.parse(change.rowKey) as unknown[])[0] as string
}

function writeStamp(ctx: Context, change: Change, column: string, stamp: string): void {
  ctx.db
    .prepare(
      `INSERT OR REPLACE INTO sync_field_stamps (table_name, row_key, column_name, stamp, project_id)
       VALUES (@table, @key, @column, @stamp, @project)`
    )
    .run({ table: change.table, key: change.rowKey, column, stamp, project: ctx.projectId })
}

const WORK_ITEMS = 'planning_work_items'
const COMMENTS = 'planning_comments'
const SIGN_OFFS = 'planning_sign_offs'

/** Notes a sign-off row a received change wrote, as it now stands, for `applyChanges` to report. */
function noteSignOff(ctx: Context, change: Change): void {
  const id = (JSON.parse(change.rowKey) as unknown[])[0]
  if (typeof id !== 'string') return
  const row = ctx.db
    .prepare(
      `SELECT item_kind, item_id, approver_person_id, requested_by_person_id, state
       FROM planning_sign_offs WHERE id = @id`
    )
    .get({ id }) as
    | {
        item_kind: ArrivedSignOff['itemKind']
        item_id: string
        approver_person_id: string
        requested_by_person_id: string | null
        state: ArrivedSignOff['state']
      }
    | undefined
  if (!row) return
  ctx.inFlightSignOff = {
    projectId: ctx.projectId,
    signOffId: id,
    itemKind: row.item_kind,
    itemId: row.item_id,
    approverPersonId: row.approver_person_id,
    requestedByPersonId: row.requested_by_person_id,
    state: row.state,
    byPersonId: change.actor?.personId ?? null
  }
}

/** Notes that a received change touched a task, for `applyChanges` to report (prompt 15). */
function noteChange(ctx: Context, taskId: string, change: Change): void {
  const author = change.columns.author_person_id
  ctx.inFlightChange = {
    projectId: ctx.projectId,
    taskId,
    byPersonId: change.actor?.personId ?? (typeof author === 'string' ? author : null)
  }
}

/** Notes the people a newly received comment mentions, for `applyChanges` to report. */
function noteMentions(ctx: Context, change: Change): void {
  const body = change.columns.body
  if (typeof body !== 'string') return
  const personIds = mentionsIn(body, BRAND.urlScheme)
  if (personIds.length === 0) return
  const taskId = change.columns.work_item_id
  if (typeof taskId !== 'string') return
  const author = change.columns.author_person_id
  ctx.inFlightMention = {
    projectId: ctx.projectId,
    taskId,
    commentId: (JSON.parse(change.rowKey) as unknown[])[0] as string,
    byPersonId: change.actor?.personId ?? (typeof author === 'string' ? author : null),
    personIds
  }
}

/**
 * Settles a task-number clash (decision 1): the task whose number was set later
 * takes the next free number, recorded as this PC's own change so every PC ends
 * with the same numbers. Anything else that clashes keeps waiting as `'conflict'`.
 */
function resolveNumberClash(ctx: Context, change: Change): Outcome {
  if (change.table !== WORK_ITEMS || change.op !== 'upsert') return 'conflict'
  const number = change.columns.number
  if (typeof number !== 'number' || !Number.isSafeInteger(number)) return 'conflict'
  let incomingId: unknown
  try {
    incomingId = (JSON.parse(change.rowKey) as unknown[])[0]
  } catch {
    return 'conflict'
  }
  const clash = ctx.db
    .prepare(
      `SELECT id, number FROM planning_work_items
       WHERE project_id = @projectId AND number = @number AND id IS NOT @incomingId`
    )
    .get({ projectId: ctx.projectId, number, incomingId }) as
    { id: string; number: number } | undefined
  if (!clash) return 'conflict'

  const clashKey = JSON.stringify([clash.id])
  const clashStamp =
    (
      ctx.db
        .prepare(
          `SELECT stamp FROM sync_field_stamps
           WHERE table_name = @table AND row_key = @key AND column_name = 'number'`
        )
        .get({ table: WORK_ITEMS, key: clashKey }) as { stamp: string } | undefined
    )?.stamp ?? ''
  const free = takeTaskNumber(ctx.db, ctx.projectId)
  const device = deviceOf(ctx)

  if (compareStamps(change.stamp, clashStamp) > 0) {
    // The incoming task is the later one: it arrives with the next free number.
    const outcome = attempt(ctx, { ...change, columns: { ...change.columns, number: free } })
    if (outcome !== 'applied') return outcome
    renumbered(ctx, device, change.rowKey, String(incomingId), number, free)
    return outcome
  }
  // The task here is the later one: it moves, and the incoming one keeps its number.
  ctx.db
    .prepare('UPDATE planning_work_items SET number = @free WHERE id = @id')
    .run({ free, id: clash.id })
  renumbered(ctx, device, clashKey, clash.id, number, free)
  return attempt(ctx, change)
}

/**
 * A description last written on this PC is about to be replaced by another PC's
 * edit (S10b). The text written here is kept as a version in the description's
 * history, and the task's activity says another PC's edit replaced it, so
 * neither edit is lost.
 */
function keepReplacedDescription(
  ctx: Context,
  found: Found,
  change: Change,
  storedStamp: string | undefined
): void {
  if (storedStamp === undefined) return
  try {
    if (parseStamp(storedStamp).device !== deviceOf(ctx)) return
  } catch {
    return
  }
  const row = ctx.db
    .prepare('SELECT id, description FROM planning_work_items WHERE rowid = @rid')
    .get({ rid: found.rid }) as { id: string; description: string | null } | undefined
  const incoming = change.columns.description
  if (!row || !row.description || row.description === incoming) return
  const now = Date.now()
  ctx.db
    .prepare(
      `INSERT INTO planning_description_versions
         (project_id, work_item_id, text, actor_kind, actor_person_id, rule_name, started_at, ended_at)
       VALUES (@projectId, @id, @text, 'human', NULL, NULL, @at, @at)`
    )
    .run({
      projectId: ctx.projectId,
      id: row.id,
      text: row.description,
      at: parseStamp(storedStamp).wall
    })
  ctx.db
    .prepare(
      `INSERT INTO planning_field_changes (project_id, work_item_id, field, from_value, to_value, actor_kind, actor_person_id, metadata, at)
       VALUES (@projectId, @id, 'descriptionReplaced', NULL, NULL, 'system', NULL, @metadata, @now)`
    )
    .run({
      projectId: ctx.projectId,
      id: row.id,
      metadata: JSON.stringify({ reason: 'sync-conflict' }),
      now
    })
}

/** Records a renumbered task: its stamp, an outbox change for the others, and an activity line. */
function renumbered(
  ctx: Context,
  device: string,
  rowKey: string,
  id: string,
  from: number,
  to: number
): void {
  const stamp = localStamp(device)
  writeStamp(ctx, { table: WORK_ITEMS, rowKey, op: 'upsert', columns: {}, stamp }, 'number', stamp)
  ctx.db
    .prepare(
      `INSERT INTO sync_outbox (project_id, table_name, row_key, op, columns, stamp, actor_kind, actor_person_id, created_at)
       VALUES (@projectId, @table, @key, 'upsert', @columns, @stamp, 'system', NULL, @now)`
    )
    .run({
      projectId: ctx.projectId,
      table: WORK_ITEMS,
      key: rowKey,
      columns: JSON.stringify({ number: to }),
      stamp,
      now: Date.now()
    })
  ctx.db
    .prepare(
      `INSERT INTO planning_field_changes (project_id, work_item_id, field, from_value, to_value, actor_kind, actor_person_id, metadata, at)
       VALUES (@projectId, @id, 'number', @from, @to, 'system', NULL, @metadata, @now)`
    )
    .run({
      projectId: ctx.projectId,
      id,
      from: JSON.stringify(from),
      to: JSON.stringify(to),
      metadata: JSON.stringify({ reason: 'sync-renumber' }),
      now: Date.now()
    })
}

function deviceOf(ctx: Context): string {
  return (
    ctx.db
      .prepare('SELECT device_id FROM sync_shares WHERE share_id = @shareId')
      .get({ shareId: ctx.shareId }) as { device_id: string }
  ).device_id
}

function toPending(ctx: Context, change: Change, waitingFor: 'parent' | 'conflict'): void {
  ctx.db
    .prepare(
      `INSERT INTO sync_pending (share_id, table_name, row_key, op, columns, stamp, waiting_for, received_at, actor)
       VALUES (@shareId, @table, @key, @op, @columns, @stamp, @waitingFor, @now, @actor)`
    )
    .run({
      shareId: ctx.shareId,
      table: change.table,
      key: change.rowKey,
      op: change.op,
      columns: JSON.stringify(change.columns),
      stamp: change.stamp,
      waitingFor,
      now: Date.now(),
      actor: change.actor ? JSON.stringify(change.actor) : null
    })
}

/**
 * Retries this share's pending changes that wait for a parent, in stamp order,
 * repeating while a pass applies or skips at least one of them.
 */
function retryPending(ctx: Context): { applied: number; skipped: number } {
  const counts = { applied: 0, skipped: 0 }
  let removed = true
  while (removed) {
    removed = false
    const rows = ctx.db
      .prepare(
        `SELECT id, table_name, row_key, op, columns, stamp, actor FROM sync_pending
         WHERE share_id = @shareId AND (waiting_for = 'parent' OR table_name = '${WORK_ITEMS}')
         ORDER BY stamp, id`
      )
      .all({ shareId: ctx.shareId }) as PendingRow[]
    for (const row of rows) {
      const change: Change = {
        table: row.table_name,
        rowKey: row.row_key,
        op: row.op,
        columns: JSON.parse(row.columns) as Record<string, unknown>,
        stamp: row.stamp,
        actor: row.actor ? (JSON.parse(row.actor) as SyncChange['actor']) : undefined
      }
      let outcome = attempt(ctx, change)
      if (outcome === 'conflict') outcome = resolveNumberClash(ctx, change)
      if (outcome === 'applied' || outcome === 'skipped') {
        ctx.db.prepare('DELETE FROM sync_pending WHERE id = @id').run({ id: row.id })
        counts[outcome]++
        removed = true
      }
    }
  }
  return counts
}

function countPending(ctx: Context): number {
  const row = ctx.db
    .prepare('SELECT COUNT(*) AS n FROM sync_pending WHERE share_id = @shareId')
    .get({ shareId: ctx.shareId }) as { n: number }
  return row.n
}
