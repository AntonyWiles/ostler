/**
 * The phone's edits to a task: its fields (title, description, status, priority, assignee, dates,
 * estimate, milestone, labels, checklist lines), a checklist tick, a comment and a new task. Each one writes the rows the desktop's `PlanningService` writes for the same edit
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
import { DEFAULT_DEPENDENCY_TYPE } from '@shared/planning/dependency-links'
import { continuesSitting } from '@shared/planning/sitting'
import { MAX_COMMENT_LENGTH } from '@shared/ostler-api/activity-types'
import { MAX_MY_DAY_TASKS } from '@shared/ostler-api/home-types'
import {
  MAX_DESCRIPTION_VERSIONS,
  MAX_RESOLUTION_REASON_LENGTH
} from '@shared/ostler-api/planning-types'
import { TASK_STATUSES } from '@shared/task-labels'
import type { PlanningPriority, PlanningWorkItemStatus } from '@shared/ostler-api'
import { MAX_ESTIMATE } from '@shared/ostler-api/people-types'
import { takeTaskNumber } from '../../../electron/services/sync/task-numbers'
import { ItemLinkIndex } from '../../../electron/services/item-link-index'
import { resolveBlockersOfDoneTask } from '../../../electron/services/planning-done-blockers'
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
  | 'description-too-long'
  | 'bad-priority'
  | 'bad-estimate'
  | 'bad-milestone'
  | 'bad-label'
  | 'bad-checklist-line'
  | 'too-deep' // subtasks nest three levels at most
  | 'bad-dependency' // not a task of the project, the task itself, or (for a subtask) not a sibling
  | 'dependency-loop'
  | 'bad-reminder-time' // in the past, or more than ten years ahead
  | 'task-closed' // a done, archived or binned task takes no new reminder
  | 'choice-required' // a blocker is resolved with one of its options, or "resolved"
  | 'choice-too-long'
  | 'note-too-long'
  | 'already-resolved' // the blocker was resolved elsewhere first
  | 'not-waiting' // the task is no longer in review or blocked
  | 'bad-recording' // a voice memo whose file is missing, empty or not a sound file

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

export interface TaskRow {
  id: string
  project_id: string
  title: string
  description: string
  status: PlanningWorkItemStatus
  priority: PlanningPriority
  labels: string
  estimate: number | null
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
  parent_work_item_id: string | null
  subtask_phase_number: number | null
}

const MAX_TITLE = 200

/** Runs an edit, turning the database's read-only refusal (a Viewer) into `EditRefused`. */
export function guarded<T>(run: () => T): T {
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

/**
 * Re-reads the item links in a task's, comment's or decision's text, as the PC does on each write,
 * so what links to an item shows on both devices.
 */
export function reindexLinks(db: EditDb, kind: 'task' | 'comment' | 'decision', id: string): void {
  new ItemLinkIndex(db as unknown as ConstructorParameters<typeof ItemLinkIndex>[0]).reindex(
    kind,
    id
  )
}

export function requireTask(db: EditDb, taskId: string): TaskRow {
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

/**
 * A title, description or checklist edited again within the same sitting by the same person is
 * one history row (`PlanningActivity.recordEdit`).
 */
function recordSitting(
  db: EditDb,
  task: TaskRow,
  field: 'title' | 'description' | 'checklist',
  from: unknown,
  to: unknown,
  personId: string | null,
  at: number
): void {
  const sitting = db
    .prepare(
      `SELECT id, at FROM planning_field_changes
       WHERE work_item_id = ? AND field = ? AND actor_kind = ? AND actor_person_id IS ?
       ORDER BY at DESC, id DESC LIMIT 1`
    )
    .get(task.id, field, 'human', personId) as { id: number; at: number } | undefined
  if (sitting && continuesSitting(sitting.at, at)) {
    db.prepare('UPDATE planning_field_changes SET to_value = ?, at = ? WHERE id = ?').run(
      to === undefined ? null : JSON.stringify(to),
      at,
      sitting.id
    )
    return
  }
  recordChange(db, task, field, from, to, personId, at)
}

/**
 * Keeps the description's text from before this sitting of changes
 * (`PlanningDescriptionVersions.keep`): a change in the same sitting as the newest version only
 * moves its end.
 */
function keepDescriptionVersion(
  db: EditDb,
  task: TaskRow,
  personId: string | null,
  at: number
): void {
  const last = db
    .prepare(
      `SELECT id, actor_kind, actor_person_id, rule_name, ended_at
       FROM planning_description_versions
       WHERE work_item_id = ? ORDER BY ended_at DESC, id DESC LIMIT 1`
    )
    .get(task.id) as
    | {
        id: number
        actor_kind: string
        actor_person_id: string | null
        rule_name: string | null
        ended_at: number
      }
    | undefined
  if (
    last &&
    last.actor_kind === 'human' &&
    last.actor_person_id === personId &&
    last.rule_name === null &&
    continuesSitting(last.ended_at, at)
  ) {
    db.prepare('UPDATE planning_description_versions SET ended_at = ? WHERE id = ?').run(
      at,
      last.id
    )
    return
  }
  db.prepare(
    `INSERT INTO planning_description_versions
       (project_id, work_item_id, text, actor_kind, actor_person_id, rule_name, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(task.project_id, task.id, task.description, 'human', personId, null, at, at)
  db.prepare(
    `DELETE FROM planning_description_versions
     WHERE work_item_id = ? AND id NOT IN (
       SELECT id FROM planning_description_versions
       WHERE work_item_id = ? ORDER BY ended_at DESC, id DESC LIMIT ?
     )`
  ).run(task.id, task.id, MAX_DESCRIPTION_VERSIONS)
}

/**
 * Moves the ticks and details of renamed checklist lines to their new text and drops those of
 * removed lines (`PlanningService.renameChecks`, `deleteChecksNotIn`, `PlanningChecklistDetails`).
 */
function carryChecklist(
  db: EditDb,
  taskId: string,
  checklist: string[],
  renamed: ReadonlyMap<string, string>
): void {
  const moves = [...renamed].filter(([from, to]) => from !== to && checklist.includes(to))
  const keep = new Set(checklist)
  // A placeholder no line can hold: lines are trimmed, never start with NUL.
  const hold = (index: number) => `\u0000rename:${index}`
  for (const table of ['planning_checklist_checks', 'planning_checklist_details']) {
    const move = db.prepare(
      `UPDATE OR IGNORE ${table} SET criterion_text = ? WHERE work_item_id = ? AND criterion_text = ?`
    )
    // Two passes through the placeholder, so a swap of two texts cannot collide.
    moves.forEach(([from], index) => move.run(hold(index), taskId, from))
    moves.forEach(([, to], index) => move.run(to, taskId, hold(index)))
    const rows = db
      .prepare(`SELECT criterion_text FROM ${table} WHERE work_item_id = ?`)
      .all(taskId) as { criterion_text: string }[]
    const remove = db.prepare(`DELETE FROM ${table} WHERE work_item_id = ? AND criterion_text = ?`)
    for (const row of rows) {
      if (!keep.has(row.criterion_text)) remove.run(taskId, row.criterion_text)
    }
  }
}

interface TaskChanges {
  title?: string
  description?: string
  status?: PlanningWorkItemStatus
  priority?: PlanningPriority
  assigneeId?: string | null
  startDate?: string | null
  targetDate?: string | null
  estimate?: number | null
  milestoneId?: string | null
  labels?: string[]
  checklist?: string[]
  dependencyIds?: string[]
}

interface DependencyRow {
  depends_on_id: string
  type: string
  lag_days: number
}

function dependenciesOf(db: EditDb, taskId: string): DependencyRow[] {
  return db
    .prepare(
      'SELECT depends_on_id, type, lag_days FROM planning_dependencies WHERE work_item_id = ? ORDER BY rowid'
    )
    .all(taskId) as DependencyRow[]
}

/**
 * The checks of `PlanningService.validateDependencies`: kept tasks of the same project, not the
 * task itself; a subtask waits only on siblings in its phase; and no loop of waiting.
 */
function validDependencies(db: EditDb, current: TaskRow, ids: string[]): string[] {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id)) {
    throw new EditRefused('bad-dependency')
  }
  const unique = [...new Set(ids)]
  if (unique.length > 50 || unique.includes(current.id)) throw new EditRefused('bad-dependency')
  if (unique.length === 0) return unique
  const kept = db
    .prepare(
      `SELECT id, parent_work_item_id, subtask_phase_number FROM planning_work_items
       WHERE project_id = ? AND deleted_at IS NULL`
    )
    .all(current.project_id) as {
    id: string
    parent_work_item_id: string | null
    subtask_phase_number: number | null
  }[]
  const byId = new Map(kept.map((item) => [item.id, item]))
  for (const id of unique) {
    const item = byId.get(id)
    if (!item) throw new EditRefused('bad-dependency')
    if (
      current.parent_work_item_id !== null &&
      (item.parent_work_item_id !== current.parent_work_item_id ||
        item.subtask_phase_number !== current.subtask_phase_number)
    ) {
      throw new EditRefused('bad-dependency')
    }
  }
  const rows = db
    .prepare(
      `SELECT dependency.work_item_id, dependency.depends_on_id
       FROM planning_dependencies dependency
       JOIN planning_work_items item ON item.id = dependency.work_item_id
       WHERE item.project_id = ? AND item.deleted_at IS NULL`
    )
    .all(current.project_id) as { work_item_id: string; depends_on_id: string }[]
  const graph = new Map<string, string[]>()
  for (const row of rows) {
    graph.set(row.work_item_id, [...(graph.get(row.work_item_id) ?? []), row.depends_on_id])
  }
  graph.set(current.id, unique)
  const reachesTask = (at: string, seen: Set<string>): boolean => {
    if (at === current.id) return true
    if (seen.has(at)) return false
    seen.add(at)
    return (graph.get(at) ?? []).some((next) => reachesTask(next, seen))
  }
  if (unique.some((id) => reachesTask(id, new Set()))) throw new EditRefused('dependency-loop')
  return unique
}

export const TASK_PRIORITIES: readonly PlanningPriority[] = ['low', 'medium', 'high', 'critical']
const MAX_DESCRIPTION = 8000
const MAX_LABELS = 20
const MAX_LABEL = 80
export const MAX_CHECKLIST_LINES = 30
const MAX_CHECKLIST_LINE = 500

function jsonList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function validDate(value: string | null): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !isIsoDate(value)) {
    throw new EditRefused('bad-date')
  }
  return value
}

/** Trimmed, non-empty and unique, as the PC's `textList` keeps a list of texts. */
function validList(
  values: string[],
  maximumItems: number,
  maximumLength: number,
  refusal: EditRefusal
): string[] {
  if (!Array.isArray(values)) throw new EditRefused(refusal)
  const list = values.map((value) => (typeof value === 'string' ? value.trim() : ''))
  if (list.some((value) => !value || value.length > maximumLength)) throw new EditRefused(refusal)
  const unique = [...new Set(list)]
  if (unique.length > maximumItems) throw new EditRefused(refusal)
  return unique
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item))
}

/** The part of `PlanningService.updateWorkItem` the phone does, for the fields it edits. */
function updateTask(
  db: EditDb,
  taskId: string,
  changes: TaskChanges,
  options: EditOptions,
  renamed: ReadonlyMap<string, string> = new Map()
): void {
  guarded(() => {
    const current = requireTask(db, taskId)
    const personId = options.personId ?? null
    const at = options.now ?? Date.now()

    const title = changes.title === undefined ? current.title : validTitle(changes.title)
    if (changes.description !== undefined && typeof changes.description !== 'string') {
      throw new EditRefused('description-too-long')
    }
    const description =
      changes.description === undefined ? current.description : changes.description.trim()
    if (description.length > MAX_DESCRIPTION) throw new EditRefused('description-too-long')
    const status = changes.status === undefined ? current.status : changes.status
    if (!TASK_STATUSES.includes(status)) throw new EditRefused('bad-status')
    const priority = changes.priority === undefined ? current.priority : changes.priority
    if (!TASK_PRIORITIES.includes(priority)) throw new EditRefused('bad-priority')
    const assigneeId = changes.assigneeId === undefined ? current.assignee_id : changes.assigneeId
    if (assigneeId !== null && assigneeId !== current.assignee_id) {
      const person = db
        .prepare('SELECT id, project_id FROM people WHERE id = ?')
        .get(assigneeId) as { id: string; project_id: string | null } | undefined
      if (!person || (person.project_id !== null && person.project_id !== current.project_id)) {
        throw new EditRefused('bad-person')
      }
    }
    const startDate =
      changes.startDate === undefined ? current.start_date : validDate(changes.startDate)
    const targetDate =
      changes.targetDate === undefined ? current.target_date : validDate(changes.targetDate)
    if (startDate && targetDate && compareIsoDates(startDate, targetDate) > 0) {
      throw new EditRefused('start-after-due')
    }
    const estimate = changes.estimate === undefined ? current.estimate : changes.estimate
    if (
      estimate !== null &&
      (typeof estimate !== 'number' ||
        !Number.isFinite(estimate) ||
        estimate < 0 ||
        estimate > MAX_ESTIMATE)
    ) {
      throw new EditRefused('bad-estimate')
    }
    const milestoneId =
      changes.milestoneId === undefined ? current.milestone_id : changes.milestoneId
    if (milestoneId !== null && milestoneId !== current.milestone_id) {
      const milestone = db
        .prepare('SELECT project_id FROM planning_milestones WHERE id = ?')
        .get(milestoneId) as { project_id: string } | undefined
      if (!milestone || milestone.project_id !== current.project_id) {
        throw new EditRefused('bad-milestone')
      }
    }
    const labelsBefore = jsonList(current.labels)
    const labels =
      changes.labels === undefined
        ? labelsBefore
        : validList(changes.labels, MAX_LABELS, MAX_LABEL, 'bad-label')
    const checklistBefore = jsonList(current.acceptance_criteria)
    const checklist =
      changes.checklist === undefined
        ? checklistBefore
        : validList(
            changes.checklist,
            MAX_CHECKLIST_LINES,
            MAX_CHECKLIST_LINE,
            'bad-checklist-line'
          )
    const dependenciesBefore = dependenciesOf(db, taskId)
    const dependencyIds =
      changes.dependencyIds === undefined
        ? dependenciesBefore.map((row) => row.depends_on_id)
        : validDependencies(db, current, changes.dependencyIds)
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
         SET title = ?, description = ?, status = ?, priority = ?, assignee_id = ?, start_date = ?,
             target_date = ?, estimate = ?, milestone_id = ?, labels = ?, acceptance_criteria = ?,
             column_id = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        title,
        description,
        status,
        priority,
        assigneeId,
        startDate,
        targetDate,
        estimate,
        milestoneId,
        JSON.stringify(labels),
        JSON.stringify(checklist),
        columnId,
        at,
        taskId
      )
      if (changes.checklist !== undefined) carryChecklist(db, taskId, checklist, renamed)
      if (title !== current.title || description !== current.description)
        reindexLinks(db, 'task', taskId)
      if (changes.dependencyIds !== undefined) {
        // A link kept keeps its type and lag; a new one is finish to start, 0 days
        // (`PlanningService.dependencyLinksInput`).
        const previous = new Map(dependenciesBefore.map((row) => [row.depends_on_id, row]))
        db.prepare('DELETE FROM planning_dependencies WHERE work_item_id = ?').run(taskId)
        const insert = db.prepare(
          'INSERT INTO planning_dependencies (work_item_id, depends_on_id, type, lag_days) VALUES (?, ?, ?, ?)'
        )
        for (const id of dependencyIds) {
          const kept = previous.get(id)
          insert.run(taskId, id, kept?.type ?? DEFAULT_DEPENDENCY_TYPE, kept?.lag_days ?? 0)
        }
      }

      // `PlanningActivity.recordUpdate`, for these fields, in its order.
      if (title !== current.title)
        recordSitting(db, current, 'title', current.title, title, personId, at)
      if (description !== current.description)
        recordSitting(db, current, 'description', undefined, undefined, personId, at)
      if (priority !== current.priority)
        recordChange(db, current, 'priority', current.priority, priority, personId, at)
      if (assigneeId !== current.assignee_id)
        recordChange(db, current, 'assignee', current.assignee_id, assigneeId, personId, at)
      if (startDate !== current.start_date)
        recordChange(db, current, 'startDate', current.start_date, startDate, personId, at)
      if (targetDate !== current.target_date) {
        recordChange(db, current, 'dueDate', current.target_date, targetDate, personId, at)
        // A due reminder planned for the old date no longer fits (`PlanningReminders.syncTask`);
        // the phone plans no new one, so a moved date has none until the PC next plans it.
        db.prepare(
          "DELETE FROM reminders WHERE work_item_id = ? AND kind = 'due' AND delivered_at IS NULL"
        ).run(taskId)
      }
      if (estimate !== current.estimate)
        recordChange(db, current, 'estimate', current.estimate, estimate, personId, at)
      if (milestoneId !== current.milestone_id)
        recordChange(db, current, 'milestone', current.milestone_id, milestoneId, personId, at)
      if (!sameSet(labelsBefore, labels))
        recordChange(db, current, 'labels', labelsBefore, labels, personId, at)
      const idsBefore = dependenciesBefore.map((row) => row.depends_on_id)
      if (!sameSet(idsBefore, dependencyIds))
        recordChange(db, current, 'dependencies', idsBefore, dependencyIds, personId, at)
      if (!sameSet(checklistBefore, checklist))
        recordSitting(db, current, 'checklist', checklistBefore, checklist, personId, at)
      if (description !== current.description) keepDescriptionVersion(db, current, personId, at)

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
        startMilestoneIfPlanned(db, milestoneId, status, at)
        // A task that is no longer open keeps no pending reminder (`PlanningReminders.syncTask`).
        if (status === 'done') {
          closeTaskReminders(db, taskId, at)
          // A task that is done is no longer blocked (`PlanningService.updateWorkItem`).
          resolveBlockersOfDoneTask(db, taskId, 'human', at)
        }
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

/** Sets or clears a task's start date, `YYYY-MM-DD` (`updateWorkItem`, `startDate`). */
export function setTaskStartDate(
  db: EditDb,
  taskId: string,
  date: string | null,
  options: EditOptions = {}
): void {
  updateTask(db, taskId, { startDate: date }, options)
}

/** Replaces a task's description, Markdown text (`updateWorkItem`, `description`). */
export function setTaskDescription(
  db: EditDb,
  taskId: string,
  description: string,
  options: EditOptions = {}
): void {
  updateTask(db, taskId, { description }, options)
}

/** Sets a task's priority (`updateWorkItem`, `priority`). */
export function setTaskPriority(
  db: EditDb,
  taskId: string,
  priority: PlanningPriority,
  options: EditOptions = {}
): void {
  updateTask(db, taskId, { priority }, options)
}

/** Sets or clears a task's estimate, in the project's estimate unit (`updateWorkItem`, `estimate`). */
export function setTaskEstimate(
  db: EditDb,
  taskId: string,
  estimate: number | null,
  options: EditOptions = {}
): void {
  updateTask(db, taskId, { estimate }, options)
}

/** Puts a task in one of its project's milestones, or in none (`updateWorkItem`, `milestoneId`). */
export function setTaskMilestone(
  db: EditDb,
  taskId: string,
  milestoneId: string | null,
  options: EditOptions = {}
): void {
  updateTask(db, taskId, { milestoneId }, options)
}

/** Replaces the tasks a task waits on (`updateWorkItem`, `dependencyIds`). */
export function setTaskDependencies(
  db: EditDb,
  taskId: string,
  dependencyIds: string[],
  options: EditOptions = {}
): void {
  updateTask(db, taskId, { dependencyIds }, options)
}

/** Replaces a task's labels (`updateWorkItem`, `labels`). */
export function setTaskLabels(
  db: EditDb,
  taskId: string,
  labels: string[],
  options: EditOptions = {}
): void {
  updateTask(db, taskId, { labels }, options)
}

/**
 * Replaces a task's checklist lines (`updateWorkItem`, `acceptanceCriteria`). `renamed` maps a
 * line's old text to its new one so its tick and details move with it; a removed line's go.
 */
export function setTaskChecklist(
  db: EditDb,
  taskId: string,
  lines: string[],
  renamed: ReadonlyMap<string, string> = new Map(),
  options: EditOptions = {}
): void {
  updateTask(db, taskId, { checklist: lines }, options, renamed)
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
      reindexLinks(db, 'comment', id)
    })()
    return id
  })
}

const MAX_REMINDER_AHEAD_MS = 10 * 366 * 24 * 60 * 60 * 1000

/**
 * Adds a one-off reminder to a task (`PlanningService.addReminder`, without keep reminding). The
 * PC that holds the project shows it when it is due.
 */
export function addTaskReminder(
  db: EditDb,
  taskId: string,
  remindAt: number,
  options: EditOptions = {}
): string {
  return guarded(() => {
    const current = requireTask(db, taskId)
    const now = options.now ?? Date.now()
    if (!Number.isInteger(remindAt) || remindAt <= now || remindAt > now + MAX_REMINDER_AHEAD_MS) {
      throw new EditRefused('bad-reminder-time')
    }
    if (current.status === 'done' || current.archived_at !== null) {
      throw new EditRefused('task-closed')
    }
    const id = uuidv4()
    db.prepare(
      `INSERT INTO reminders (id, project_id, work_item_id, remind_at, kind, delivered_at,
         dismissed_at, keep_reminding, interval_minutes)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
    ).run(id, current.project_id, taskId, remindAt, 'custom', 0, null)
    return id
  })
}

/** Removes one of a task's reminders (`PlanningService.deleteReminder`). */
export function deleteTaskReminder(db: EditDb, taskId: string, reminderId: string): void {
  guarded(() => {
    requireTask(db, taskId)
    const row = db.prepare('SELECT work_item_id FROM reminders WHERE id = ?').get(reminderId) as
      { work_item_id: string } | undefined
    if (!row || row.work_item_id !== taskId) throw new EditRefused('not-found')
    db.prepare('DELETE FROM reminders WHERE id = ?').run(reminderId)
  })
}

/**
 * Brings a task back from the recycle bin (`PlanningService.restoreWorkItem`). Its due reminder
 * is planned again by the PC, as after any change the phone makes to a due date.
 */
export function restoreTaskFromBin(db: EditDb, taskId: string, options: EditOptions = {}): void {
  guarded(() => {
    const current = db.prepare('SELECT * FROM planning_work_items WHERE id = ?').get(taskId) as
      TaskRow | undefined
    if (!current) throw new EditRefused('not-found')
    if (current.deleted_at === null) return
    const at = options.now ?? Date.now()
    db.transaction(() => {
      db.prepare('UPDATE planning_work_items SET deleted_at = NULL WHERE id = ?').run(taskId)
      recordChange(db, current, 'restored', undefined, undefined, options.personId ?? null, at)
    })()
  })
}

interface CommentRow {
  id: string
  work_item_id: string
  author_kind: string
  author_person_id: string | null
  body: string
  created_at: number
  deleted_at: number | null
  pinned_at: number | null
}

function requireComment(db: EditDb, commentId: string): CommentRow {
  const row = db.prepare('SELECT * FROM planning_comments WHERE id = ?').get(commentId) as
    CommentRow | undefined
  if (!row) throw new EditRefused('not-found')
  return row
}

/** Changes a comment's text (`PlanningActivity.updateComment`). */
export function editTaskComment(
  db: EditDb,
  commentId: string,
  body: string,
  options: EditOptions = {}
): void {
  guarded(() => {
    const current = requireComment(db, commentId)
    if (current.deleted_at !== null) throw new EditRefused('not-found')
    if (typeof body !== 'string' || !body.trim()) throw new EditRefused('comment-required')
    if (body.trim().length > MAX_COMMENT_LENGTH) throw new EditRefused('comment-too-long')
    const text = body.trim()
    if (text === current.body) return
    const at = Math.max(options.now ?? Date.now(), current.created_at + 1)
    db.transaction(() => {
      db.prepare('UPDATE planning_comments SET body = ?, updated_at = ? WHERE id = ?').run(
        text,
        at,
        commentId
      )
      reindexLinks(db, 'comment', commentId)
    })()
  })
}

/** Deletes a comment, softly (`PlanningActivity.deleteComment`); `restoreTaskComment` undoes it. */
export function deleteTaskComment(db: EditDb, commentId: string, options: EditOptions = {}): void {
  guarded(() => {
    const current = requireComment(db, commentId)
    if (current.deleted_at !== null) return
    db.prepare('UPDATE planning_comments SET deleted_at = ? WHERE id = ?').run(
      options.now ?? Date.now(),
      commentId
    )
  })
}

/** Brings a deleted comment back (`PlanningActivity.restoreComment`). */
export function restoreTaskComment(db: EditDb, commentId: string): void {
  guarded(() => {
    requireComment(db, commentId)
    db.prepare('UPDATE planning_comments SET deleted_at = NULL WHERE id = ?').run(commentId)
  })
}

/** Pins a comment to the top of its task's comments, or takes the pin off (`pinComment`). */
export function pinTaskComment(
  db: EditDb,
  commentId: string,
  pinned: boolean,
  options: EditOptions = {}
): void {
  guarded(() => {
    const current = requireComment(db, commentId)
    if (current.deleted_at !== null) throw new EditRefused('not-found')
    const pinnedAt = pinned ? (current.pinned_at ?? options.now ?? Date.now()) : null
    db.prepare('UPDATE planning_comments SET pinned_at = ? WHERE id = ?').run(pinnedAt, commentId)
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

/**
 * Accepts a task waiting in To triage (`acceptFromTriage`): it joins the Board in the status it
 * has, as the PC's Accept does with no fields changed.
 */
export function acceptTaskFromTriage(db: EditDb, taskId: string, options: EditOptions = {}): void {
  guarded(() => {
    const current = requireTask(db, taskId)
    if (!current.in_triage) return
    const at = options.now ?? Date.now()
    db.transaction(() => {
      db.prepare('UPDATE planning_work_items SET in_triage = 0, updated_at = ? WHERE id = ?').run(
        at,
        taskId
      )
      recordChange(db, current, 'triage', true, false, options.personId ?? null, at)
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

/** How deep a task sits: 1 for a top-level task, one more per parent (`PlanningService.depthOf`). */
function depthOf(db: EditDb, taskId: string | null): number {
  let depth = 0
  let currentId = taskId
  const seen = new Set<string>()
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    depth++
    const row = db
      .prepare('SELECT parent_work_item_id FROM planning_work_items WHERE id = ?')
      .get(currentId) as { parent_work_item_id: string | null } | undefined
    currentId = row?.parent_work_item_id ?? null
  }
  return depth
}

/**
 * Where a new subtask goes under its parent (`PlanningService.validateSubtaskPlacement` with no
 * phase given): phase 1, named as its phase-1 siblings are, in the parent's workstream.
 */
function subtaskPlacement(
  db: EditDb,
  projectId: string,
  parentId: string | null
): {
  parentId: string | null
  phaseNumber: number | null
  phaseName: string
  subprojectId: string | null
} {
  if (parentId === null) {
    return { parentId: null, phaseNumber: null, phaseName: '', subprojectId: null }
  }
  const parent = db
    .prepare('SELECT project_id, subproject_id, deleted_at FROM planning_work_items WHERE id = ?')
    .get(parentId) as
    { project_id: string; subproject_id: string | null; deleted_at: number | null } | undefined
  if (!parent || parent.deleted_at !== null || parent.project_id !== projectId) {
    throw new EditRefused('not-found')
  }
  if (depthOf(db, parentId) >= 3) throw new EditRefused('too-deep')
  const sibling = db
    .prepare(
      `SELECT subtask_phase_name FROM planning_work_items
       WHERE parent_work_item_id = ? AND subtask_phase_number = 1 LIMIT 1`
    )
    .get(parentId) as { subtask_phase_name: string } | undefined
  return {
    parentId,
    phaseNumber: 1,
    phaseName: sibling?.subtask_phase_name ?? '',
    subprojectId: parent.subproject_id
  }
}

/**
 * Adds a task to a project, in Backlog, medium priority, at the end of the project's order
 * (`PlanningService.createWorkItem` with only a title, or a title and `parentWorkItemId`).
 * Returns the new task's id.
 */
export function addTask(
  db: EditDb,
  projectId: string,
  title: string,
  options: EditOptions & {
    parentId?: string
    /** A quick capture from the phone: it waits in To triage until accepted on either device. */
    triage?: boolean
  } = {}
): string {
  return guarded(() => {
    const text = validTitle(title)
    const triage = options.triage === true && !options.parentId
    const personId = options.personId ?? null
    const at = options.now ?? Date.now()
    const id = uuidv4()
    const placement = subtaskPlacement(db, projectId, options.parentId ?? null)
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
        placement.parentId,
        '',
        '',
        '',
        placement.phaseNumber,
        placement.phaseName,
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
        triage ? 1 : 0,
        triage ? 'quick-add' : null,
        null,
        placement.subprojectId
      )
      insertStatusHistory(db, id, null, 'backlog', { kind: 'human', personId }, null, at)
      recordChange(db, { id, project_id: projectId }, 'created', undefined, undefined, personId, at)
    })()
    return id
  })
}
