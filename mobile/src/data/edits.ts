/**
 * The phone's edits to a task: status, title, assignee, due date, a checklist tick, a comment and
 * a new task. Each one writes the rows the desktop's `PlanningService` writes for the same edit
 * (the task row, `planning_field_changes`, `planning_status_history`, `planning_comments`,
 * `planning_checklist_checks`, `project_task_counters`, the order key), in one transaction, so a
 * task edited on the phone and the same task edited on the PC end up the same on both.
 *
 * Plain functions over anything shaped like a database (the phone's op-sqlite adapter, or
 * better-sqlite3 in the desktop tests), so this file imports no React Native code. After a
 * successful call the screen calls `PhoneSync.noteLocalWrite()` so the change is pushed.
 *
 * Not done on the phone, because each needs state the phone does not have: automation rules
 * (D45), the next occurrence of a repeating task, the search index and the planning of new due
 * reminders (a changed due date only drops the old one). A repeating task therefore cannot be marked Done here (`EditRefused('recurring')`).
 */
import { v4 as uuidv4 } from 'uuid'
import { compareIsoDates, isIsoDate } from '@shared/dates'
import { MAX_ORDER_KEY_LENGTH, orderKeyBetween, spacedOrderKeys } from '@shared/planning/order-key'
import { continuesSitting } from '@shared/planning/sitting'
import { MAX_COMMENT_LENGTH } from '@shared/ostler-api/activity-types'
import { MAX_MY_DAY_TASKS } from '@shared/ostler-api/home-types'
import { MAX_RESOLUTION_REASON_LENGTH } from '@shared/ostler-api/planning-types'
import { TASK_STATUSES } from '@shared/task-labels'
import type { PlanningWorkItemStatus } from '@shared/ostler-api'
import { takeTaskNumber } from '../../../electron/services/sync/task-numbers'
import {
  closeTaskReminders,
  insertComment,
  insertFieldChange,
  insertStatusHistory,
  startMilestoneIfPlanned,
  writeChecklistCheck
} from '@shared/planning/task-writes'

/** What the edits need of a database; `OstlerDatabase` and better-sqlite3 both fit. */
export interface EditDb {
  prepare(sql: string): {
    run(...args: unknown[]): unknown
    get(...args: unknown[]): unknown
    all(...args: unknown[]): unknown[]
  }
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R
}

export type EditRefusal =
  | 'read-only' // a Viewer of the project: the database refused the write
  | 'not-found' // the task, person or project is not on the phone
  | 'title-required'
  | 'title-too-long'
  | 'comment-required'
  | 'comment-too-long'
  | 'bad-date'
  | 'start-after-due'
  | 'bad-status'
  | 'bad-person'
  | 'bad-checklist-item'
  | 'recurring'
  | 'recurring-wont-do' // closing a repeating task makes its next one, which only the PC does
  | 'archived' // an archived task cannot join My day or move to Someday
  | 'agent-linked' // linked agent work cannot go to the recycle bin
  | 'not-open' // only an open task can be closed as won't do
  | 'reason-too-long'
  | 'in-triage'
  | 'my-day-full'

/** An edit that was refused; nothing was written. `reason` is what the screen shows. */
export class EditRefused extends Error {
  constructor(readonly reason: EditRefusal) {
    super(`Edit refused: ${reason}`)
    this.name = 'EditRefused'
  }
}

/** The phone is not signed in as a person of the project: the person is only a name on a row. */
export interface EditOptions {
  /** The person who is making the edit, when the phone knows one (the PC's Me never syncs). */
  personId?: string | null
  now?: number
}

interface TaskRow {
  id: string
  project_id: string
  title: string
  status: PlanningWorkItemStatus
  assignee_id: string | null
  target_date: string | null
  start_date: string | null
  milestone_id: string | null
  column_id: string | null
  archived_at: number | null
  deleted_at: number | null
  acceptance_criteria: string
  resolution: string | null
  someday: number
  show_from: string | null
  in_triage: number
  linked_harness_task_id: string | null
}

const MAX_TITLE = 200

/** Runs an edit, turning the database's read-only refusal (a Viewer) into `EditRefused`. */
function guarded<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof EditRefused) throw error
    if (error instanceof Error && error.message.includes('ostler:read-only')) {
      throw new EditRefused('read-only')
    }
    throw error
  }
}

function requireTask(db: EditDb, taskId: string): TaskRow {
  const row = db.prepare('SELECT * FROM planning_work_items WHERE id = ?').get(taskId) as
    TaskRow | undefined
  if (!row || row.deleted_at !== null) throw new EditRefused('not-found')
  return row
}

function recordChange(
  db: EditDb,
  task: Pick<TaskRow, 'id' | 'project_id'>,
  field: string,
  from: unknown,
  to: unknown,
  personId: string | null,
  at: number
): void {
  insertFieldChange(
    db,
    { id: task.id, projectId: task.project_id },
    field,
    from,
    to,
    { kind: 'human', personId },
    null,
    at
  )
}

/** A title edited again within the same sitting by the same person is one history row. */
function recordTitle(
  db: EditDb,
  task: TaskRow,
  to: string,
  personId: string | null,
  at: number
): void {
  const sitting = db
    .prepare(
      `SELECT id, at FROM planning_field_changes
       WHERE work_item_id = ? AND field = ? AND actor_kind = ? AND actor_person_id IS ?
       ORDER BY at DESC, id DESC LIMIT 1`
    )
    .get(task.id, 'title', 'human', personId) as { id: number; at: number } | undefined
  if (sitting && continuesSitting(sitting.at, at)) {
    db.prepare('UPDATE planning_field_changes SET to_value = ?, at = ? WHERE id = ?').run(
      JSON.stringify(to),
      at,
      sitting.id
    )
    return
  }
  recordChange(db, task, 'title', task.title, to, personId, at)
}

interface TaskChanges {
  title?: string
  status?: PlanningWorkItemStatus
  assigneeId?: string | null
  targetDate?: string | null
}

/** The part of `PlanningService.updateWorkItem` the phone does, for the four fields it edits. */
function updateTask(db: EditDb, taskId: string, changes: TaskChanges, options: EditOptions): void {
  guarded(() => {
    const current = requireTask(db, taskId)
    const personId = options.personId ?? null
    const at = options.now ?? Date.now()

    const title = changes.title === undefined ? current.title : validTitle(changes.title)
    const status = changes.status === undefined ? current.status : changes.status
    if (!TASK_STATUSES.includes(status)) throw new EditRefused('bad-status')
    const assigneeId = changes.assigneeId === undefined ? current.assignee_id : changes.assigneeId
    if (assigneeId !== null && assigneeId !== current.assignee_id) {
      const person = db
        .prepare('SELECT id, project_id FROM people WHERE id = ?')
        .get(assigneeId) as { id: string; project_id: string | null } | undefined
      if (!person || (person.project_id !== null && person.project_id !== current.project_id)) {
        throw new EditRefused('bad-person')
      }
    }
    const targetDate = changes.targetDate === undefined ? current.target_date : changes.targetDate
    if (targetDate !== null) {
      if (typeof targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        throw new EditRefused('bad-date')
      }
      if (!isIsoDate(targetDate)) throw new EditRefused('bad-date')
    }
    if (current.start_date && targetDate && compareIsoDates(current.start_date, targetDate) > 0) {
      throw new EditRefused('start-after-due')
    }
    const statusChanged = status !== current.status
    if (
      statusChanged &&
      status === 'done' &&
      db.prepare('SELECT 1 FROM planning_recurrences WHERE work_item_id = ?').get(taskId)
    ) {
      throw new EditRefused('recurring')
    }

    db.transaction(() => {
      // A new status without a column is that status's own column.
      const columnId = statusChanged ? null : current.column_id
      db.prepare(
        `UPDATE planning_work_items
         SET title = ?, status = ?, assignee_id = ?, target_date = ?, column_id = ?, updated_at = ?
         WHERE id = ?`
      ).run(title, status, assigneeId, targetDate, columnId, at, taskId)

      // `PlanningActivity.recordUpdate`, for these fields, in its order.
      if (title !== current.title) recordTitle(db, current, title, personId, at)
      if (assigneeId !== current.assignee_id)
        recordChange(db, current, 'assignee', current.assignee_id, assigneeId, personId, at)
      if (targetDate !== current.target_date) {
        recordChange(db, current, 'dueDate', current.target_date, targetDate, personId, at)
        // A due reminder planned for the old date no longer fits (`PlanningReminders.syncTask`);
        // the phone plans no new one, so a moved date has none until the PC next plans it.
        db.prepare(
          "DELETE FROM reminders WHERE work_item_id = ? AND kind = 'due' AND delivered_at IS NULL"
        ).run(taskId)
      }

      if (statusChanged) {
        insertStatusHistory(
          db,
          taskId,
          current.status,
          status,
          { kind: 'human', personId },
          null,
          at
        )
        startMilestoneIfPlanned(db, current.milestone_id, status, at)
        // A task that is no longer open keeps no pending reminder (`PlanningReminders.syncTask`).
        if (status === 'done') closeTaskReminders(db, taskId, at)
      }
    })()
  })
}

function validTitle(value: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new EditRefused('title-required')
  if (value.trim().length > MAX_TITLE) throw new EditRefused('title-too-long')
  return value.trim()
}

/** Moves a task to another status (`PlanningService.updateWorkItem`, `status`). */
export function setTaskStatus(
  db: EditDb,
  taskId: string,
  status: PlanningWorkItemStatus,
  options: EditOptions = {}
): void {
  updateTask(db, taskId, { status }, options)
}

/** Renames a task (`updateWorkItem`, `title`). */
export function renameTask(
  db: EditDb,
  taskId: string,
  title: string,
  options: EditOptions = {}
): void {
  updateTask(db, taskId, { title }, options)
}

/** Gives a task to a person of the project, or to nobody (`updateWorkItem`, `assigneeId`). */
export function setTaskAssignee(
  db: EditDb,
  taskId: string,
  personId: string | null,
  options: EditOptions = {}
): void {
  updateTask(db, taskId, { assigneeId: personId }, options)
}

/** Sets or clears a task's due date, `YYYY-MM-DD` (`updateWorkItem`, `targetDate`). */
export function setTaskDueDate(
  db: EditDb,
  taskId: string,
  date: string | null,
  options: EditOptions = {}
): void {
  updateTask(db, taskId, { targetDate: date }, options)
}

/** Ticks or unticks a checklist item (`PlanningService.setChecklistItemChecked`). */
export function setChecklistTick(
  db: EditDb,
  taskId: string,
  text: string,
  checked: boolean,
  options: EditOptions = {}
): void {
  guarded(() => {
    const current = requireTask(db, taskId)
    let criteria: unknown
    try {
      criteria = JSON.parse(current.acceptance_criteria)
    } catch {
      criteria = []
    }
    if (!Array.isArray(criteria) || !criteria.includes(text)) {
      throw new EditRefused('bad-checklist-item')
    }
    const isChecked = Boolean(
      db
        .prepare(
          'SELECT 1 FROM planning_checklist_checks WHERE work_item_id = ? AND criterion_text = ?'
        )
        .get(taskId, text)
    )
    if (isChecked === checked) return
    const at = options.now ?? Date.now()
    db.transaction(() => {
      writeChecklistCheck(db, { id: taskId, projectId: current.project_id }, text, checked, at)
      recordChange(
        db,
        current,
        'checklistTick',
        undefined,
        { text, checked },
        options.personId ?? null,
        at
      )
    })()
  })
}

/** Adds a comment to a task (`PlanningService.addComment`). Returns the new comment's id. */
export function addTaskComment(
  db: EditDb,
  taskId: string,
  body: string,
  options: EditOptions = {}
): string {
  return guarded(() => {
    const current = requireTask(db, taskId)
    if (typeof body !== 'string' || !body.trim()) throw new EditRefused('comment-required')
    if (body.trim().length > MAX_COMMENT_LENGTH) throw new EditRefused('comment-too-long')
    const at = options.now ?? Date.now()
    const id = uuidv4()
    db.transaction(() => {
      insertComment(db, {
        id,
        projectId: current.project_id,
        workItemId: taskId,
        authorPersonId: options.personId ?? mePersonId(db),
        authorKind: 'human',
        body: body.trim(),
        createdAt: at,
        updatedAt: at,
        ruleName: null
      })
    })()
    return id
  })
}

/**
 * Puts a task in its project's archive (`PlanningService.archiveWorkItem`). `updated_at` is left
 * alone so a restored task keeps its place, as on the PC.
 */
export function archiveTask(db: EditDb, taskId: string, options: EditOptions = {}): void {
  guarded(() => {
    const current = requireTask(db, taskId)
    if (current.archived_at !== null) return
    const at = options.now ?? Date.now()
    db.transaction(() => {
      db.prepare('UPDATE planning_work_items SET archived_at = ? WHERE id = ?').run(at, taskId)
      recordChange(db, current, 'archived', undefined, undefined, options.personId ?? null, at)
      closeTaskReminders(db, taskId, at)
    })()
  })
}

/**
 * Brings an archived task back to the Board (`PlanningService.unarchiveWorkItem`). A won't-do task
 * is reopened: its resolution and reason are cleared.
 */
export function unarchiveTask(db: EditDb, taskId: string, options: EditOptions = {}): void {
  guarded(() => {
    const current = requireTask(db, taskId)
    if (current.archived_at === null && current.resolution === null) return
    const at = options.now ?? Date.now()
    const personId = options.personId ?? null
    db.transaction(() => {
      db.prepare(
        "UPDATE planning_work_items SET archived_at = NULL, resolution = NULL, resolution_reason = '' WHERE id = ?"
      ).run(taskId)
      if (current.resolution !== null)
        recordChange(db, current, 'reopened', current.resolution, undefined, personId, at)
      else recordChange(db, current, 'unarchived', undefined, undefined, personId, at)
    })()
  })
}

/**
 * Moves a task to the recycle bin (`PlanningService.moveWorkItemToBin`); the PC keeps it there for
 * 30 days. Linked agent work is refused, as on the PC.
 */
export function moveTaskToBin(db: EditDb, taskId: string, options: EditOptions = {}): void {
  guarded(() => {
    const current = requireTask(db, taskId)
    if (current.linked_harness_task_id !== null) throw new EditRefused('agent-linked')
    const at = options.now ?? Date.now()
    db.transaction(() => {
      db.prepare('UPDATE planning_work_items SET deleted_at = ? WHERE id = ?').run(at, taskId)
      recordChange(db, current, 'deleted', undefined, undefined, options.personId ?? null, at)
      closeTaskReminders(db, taskId, at)
    })()
  })
}

/**
 * Closes an open task as won't do (`PlanningService.closeWorkItemsAsWontDo`, one task, without its
 * subtasks): it keeps its status, gets the resolution and reason, and is archived. A repeating
 * task is refused: closing it makes its next occurrence, which only the PC does.
 */
export function closeTaskAsWontDo(
  db: EditDb,
  taskId: string,
  reason: string,
  options: EditOptions = {}
): void {
  guarded(() => {
    const current = requireTask(db, taskId)
    if (current.status === 'done' || current.archived_at !== null || current.resolution !== null)
      throw new EditRefused('not-open')
    const text = typeof reason === 'string' ? reason.trim() : ''
    if (text.length > MAX_RESOLUTION_REASON_LENGTH) throw new EditRefused('reason-too-long')
    if (db.prepare('SELECT 1 FROM planning_recurrences WHERE work_item_id = ?').get(taskId))
      throw new EditRefused('recurring-wont-do')
    const at = options.now ?? Date.now()
    const personId = options.personId ?? null
    db.transaction(() => {
      db.prepare(
        "UPDATE planning_work_items SET resolution = 'wont-do', resolution_reason = ?, archived_at = ?, in_triage = 0 WHERE id = ?"
      ).run(text, at, taskId)
      if (current.in_triage) recordChange(db, current, 'triage', true, false, personId, at)
      recordChange(db, current, 'wontDo', undefined, text, personId, at)
      closeTaskReminders(db, taskId, at)
    })()
  })
}

/**
 * Moves a task to Someday, or brings it back (`updateWorkItem`, `someday`). Going to Someday also
 * takes it out of To triage, as on the PC.
 */
export function setTaskSomeday(
  db: EditDb,
  taskId: string,
  someday: boolean,
  options: EditOptions = {}
): void {
  guarded(() => {
    const current = requireTask(db, taskId)
    if (current.archived_at !== null) throw new EditRefused('archived')
    if (Boolean(current.someday) === someday) return
    const at = options.now ?? Date.now()
    db.transaction(() => {
      writeSomeday(db, current, someday, options.personId ?? null, at)
    })()
  })
}

function writeSomeday(
  db: EditDb,
  current: TaskRow,
  someday: boolean,
  personId: string | null,
  at: number
): void {
  db.prepare(
    `UPDATE planning_work_items SET someday = ?, in_triage = ${someday ? 0 : 'in_triage'}, updated_at = ?
     WHERE id = ?`
  ).run(someday ? 1 : 0, at, current.id)
  recordChange(db, current, 'someday', !someday, someday, personId, at)
}

/** Whether a task is on a day's My day list. */
export function inMyDay(db: EditDb, taskId: string, day: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM my_day_entries WHERE day = ? AND work_item_id = ?').get(day, taskId)
  )
}

/**
 * Adds a task to the end of a day's My day (`MyDayService.add`). A task hidden in Someday or shown
 * from a later day is brought back first, as on the PC.
 */
export function addTaskToMyDay(
  db: EditDb,
  taskId: string,
  day: string,
  options: EditOptions = {}
): void {
  guarded(() => {
    const current = requireTask(db, taskId)
    if (current.archived_at !== null) throw new EditRefused('archived')
    if (current.in_triage) throw new EditRefused('in-triage')
    if (inMyDay(db, taskId, day)) return
    const count = db.prepare('SELECT COUNT(*) AS n FROM my_day_entries WHERE day = ?').get(day) as {
      n: number
    }
    if (count.n >= MAX_MY_DAY_TASKS) throw new EditRefused('my-day-full')
    const at = options.now ?? Date.now()
    const personId = options.personId ?? null
    db.transaction(() => {
      if (current.someday) writeSomeday(db, current, false, personId, at)
      if (current.show_from !== null && current.show_from > day) {
        db.prepare(
          'UPDATE planning_work_items SET show_from = NULL, updated_at = ? WHERE id = ?'
        ).run(at, taskId)
        recordChange(db, current, 'showFrom', current.show_from, null, personId, at)
      }
      db.prepare(
        `INSERT INTO my_day_entries (day, work_item_id, project_id, order_key, added_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(day, taskId, current.project_id, nextMyDayKey(db, day), at)
    })()
  })
}

/** Takes a task off a day's My day (`MyDayService.remove`). */
export function removeTaskFromMyDay(db: EditDb, taskId: string, day: string): void {
  guarded(() => {
    db.prepare('DELETE FROM my_day_entries WHERE day = ? AND work_item_id = ?').run(day, taskId)
  })
}

/** The key after every entry of the day (`MyDayService.placeKey` with no neighbour). */
function nextMyDayKey(db: EditDb, day: string): string {
  const last = () =>
    (
      db.prepare('SELECT MAX(order_key) AS key FROM my_day_entries WHERE day = ?').get(day) as {
        key: string | null
      }
    ).key || null
  const key = orderKeyBetween(last(), null)
  if (key.length <= MAX_ORDER_KEY_LENGTH) return key
  const rows = db
    .prepare('SELECT work_item_id FROM my_day_entries WHERE day = ? ORDER BY order_key, added_at')
    .all(day) as { work_item_id: string }[]
  const keys = spacedOrderKeys(rows.length)
  const write = db.prepare(
    'UPDATE my_day_entries SET order_key = ? WHERE day = ? AND work_item_id = ?'
  )
  rows.forEach((row, index) => write.run(keys[index], day, row.work_item_id))
  return orderKeyBetween(last(), null)
}

/** This phone's Me, which pairing adopts from the PC, so comments say who wrote them. */
function mePersonId(db: EditDb): string | null {
  const row = db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
    { id: string } | undefined
  return row?.id ?? null
}

function lastOrderKey(db: EditDb, projectId: string): string | null {
  const row = db
    .prepare('SELECT MAX(order_key) AS key FROM planning_work_items WHERE project_id = ?')
    .get(projectId) as { key: string | null }
  return row.key || null
}

/** The key of a task made now: after every other task of the project (`PlanningOrder.nextKey`). */
function nextOrderKey(db: EditDb, projectId: string): string {
  const key = orderKeyBetween(lastOrderKey(db, projectId), null)
  if (key.length <= MAX_ORDER_KEY_LENGTH) return key
  const rows = db
    .prepare('SELECT id FROM planning_work_items WHERE project_id = ? ORDER BY order_key, id')
    .all(projectId) as { id: string }[]
  const keys = spacedOrderKeys(rows.length)
  const write = db.prepare('UPDATE planning_work_items SET order_key = ? WHERE id = ?')
  rows.forEach((row, index) => write.run(keys[index], row.id))
  return orderKeyBetween(lastOrderKey(db, projectId), null)
}

/**
 * Adds a task to a project, in Backlog, medium priority, at the end of the project's order
 * (`PlanningService.createWorkItem` with only a title). Returns the new task's id.
 */
export function addTask(
  db: EditDb,
  projectId: string,
  title: string,
  options: EditOptions = {}
): string {
  return guarded(() => {
    const text = validTitle(title)
    const personId = options.personId ?? null
    const at = options.now ?? Date.now()
    const id = uuidv4()
    db.transaction(() => {
      const orderKey = nextOrderKey(db, projectId)
      const number = takeTaskNumber(db, projectId)
      db.prepare(
        `INSERT INTO planning_work_items
          (id, project_id, milestone_id, title, description, status, priority, labels,
           acceptance_criteria, target_date, start_date, assignee_id, estimate, origin,
           linked_harness_task_id, auto_queue, rating, rating_note,
           parent_work_item_id, task_code, phase_code, phase_name, subtask_phase_number, subtask_phase_name,
           verification_status, verified_by, verified_at, verification_notes, created_at, updated_at,
           import_batch_id, order_key, iteration_id, show_from, someday, type_id, plan_first, number,
           impact, effort, in_triage, captured_by, column_id, subproject_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        projectId,
        null,
        text,
        '',
        'backlog',
        'medium',
        '[]',
        '[]',
        null,
        null,
        null,
        null,
        'human',
        null,
        0,
        0,
        '',
        null,
        '',
        '',
        '',
        null,
        '',
        'unverified',
        null,
        null,
        '',
        at,
        at,
        null,
        orderKey,
        null,
        null,
        0,
        null,
        'default',
        number,
        null,
        null,
        0,
        null,
        null,
        null
      )
      insertStatusHistory(db, id, null, 'backlog', { kind: 'human', personId }, null, at)
      recordChange(db, { id, project_id: projectId }, 'created', undefined, undefined, personId, at)
    })()
    return id
  })
}
