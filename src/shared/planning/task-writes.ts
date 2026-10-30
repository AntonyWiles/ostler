/**
 * The rows a task edit writes, for every writer: the desktop's `PlanningService`
 * (and its `PlanningActivity` and `PlanningReminders`) and the phone's edits.
 * Plain SQL over anything shaped like a database, with no Node code, so the
 * phone and the PC cannot drift apart on what one edit leaves behind.
 * `tests/unit/mobile-edits.test.ts` holds them to the same rows.
 */
import type { PlanningWorkItemStatus } from '../ostler-api'

/** What these writers need of a database; better-sqlite3 and the phone's adapter both fit. */
export interface WriteDb {
  prepare(sql: string): {
    run(...args: unknown[]): unknown
    get(...args: unknown[]): unknown
    all(...args: unknown[]): unknown[]
  }
}

/** Who made a change, as the history rows store it. */
export interface WriteActor {
  kind: string
  personId: string | null
}

/** One row of a task's field history. `undefined` from or to is stored as null. */
export function insertFieldChange(
  db: WriteDb,
  task: { id: string; projectId: string },
  field: string,
  from: unknown,
  to: unknown,
  actor: WriteActor,
  metadata: string | null,
  at: number
): void {
  db.prepare(
    `INSERT INTO planning_field_changes
       (project_id, work_item_id, field, from_value, to_value, actor_kind, actor_person_id, metadata, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    task.projectId,
    task.id,
    field,
    from === undefined ? null : JSON.stringify(from),
    to === undefined ? null : JSON.stringify(to),
    actor.kind,
    actor.personId,
    metadata,
    at
  )
}

/** One row of a task's status history; `from` is null for a new task. */
export function insertStatusHistory(
  db: WriteDb,
  workItemId: string,
  from: PlanningWorkItemStatus | null,
  to: PlanningWorkItemStatus,
  actor: WriteActor,
  ruleName: string | null,
  at: number
): void {
  db.prepare(
    `INSERT INTO planning_status_history
       (work_item_id, from_status, to_status, at, actor_kind, actor_person_id, rule_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(workItemId, from, to, at, actor.kind, actor.personId, ruleName)
}

/**
 * A milestone is under way once any of its work is: moves it off `planned`,
 * only ever forward. Completing a milestone stays a person's decision.
 */
export function startMilestoneIfPlanned(
  db: WriteDb,
  milestoneId: string | null,
  status: PlanningWorkItemStatus,
  at: number
): void {
  if (!milestoneId || !['active', 'review', 'done'].includes(status)) return
  db.prepare(
    "UPDATE planning_milestones SET status = 'active', updated_at = ? WHERE id = ? AND status = 'planned'"
  ).run(at, milestoneId)
}

/**
 * A task that is no longer open keeps no pending reminder, and stops one
 * that keeps reminding (N1.7).
 */
export function closeTaskReminders(db: WriteDb, workItemId: string, at: number): void {
  db.prepare('DELETE FROM reminders WHERE work_item_id = ? AND delivered_at IS NULL').run(
    workItemId
  )
  db.prepare(
    `UPDATE reminders SET stopped_at = ? WHERE work_item_id = ? AND keep_reminding = 1
       AND delivered_at IS NOT NULL AND stopped_at IS NULL`
  ).run(at, workItemId)
}

/** Ticks or unticks one checklist item; the caller records the change. */
export function writeChecklistCheck(
  db: WriteDb,
  task: { id: string; projectId: string },
  text: string,
  checked: boolean,
  at: number
): void {
  if (checked) {
    db.prepare(
      `INSERT OR IGNORE INTO planning_checklist_checks
         (work_item_id, project_id, criterion_text, checked_at) VALUES (?, ?, ?, ?)`
    ).run(task.id, task.projectId, text, at)
  } else {
    db.prepare(
      'DELETE FROM planning_checklist_checks WHERE work_item_id = ? AND criterion_text = ?'
    ).run(task.id, text)
  }
}

/** A new comment row, written as it is given. */
export function insertComment(
  db: WriteDb,
  comment: {
    id: string
    projectId: string
    workItemId: string
    authorPersonId: string | null
    authorKind: string
    body: string
    createdAt: number
    updatedAt: number
    ruleName: string | null
  }
): void {
  db.prepare(
    `INSERT INTO planning_comments
       (id, project_id, work_item_id, author_person_id, author_kind, body, created_at, updated_at, deleted_at, rule_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  ).run(
    comment.id,
    comment.projectId,
    comment.workItemId,
    comment.authorPersonId,
    comment.authorKind,
    comment.body,
    comment.createdAt,
    comment.updatedAt,
    comment.ruleName
  )
}
