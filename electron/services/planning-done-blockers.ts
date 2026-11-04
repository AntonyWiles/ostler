/**
 * A task that is done is no longer blocked: reaching Done resolves its open blockers. Shared by
 * `PlanningService.updateWorkItem` and the phone's task edits, so both write the same rows.
 */

interface BlockerDb {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
    run(...params: unknown[]): unknown
  }
}

/** The resolution recorded on a blocker that its task's move to Done closed. */
export const DONE_RESOLUTION_CHOICE = 'Task done'

/** Resolves every open blocker on the task; returns the ids it resolved. */
export function resolveBlockersOfDoneTask(
  db: BlockerDb,
  taskId: string,
  resolvedBy: string,
  at: number
): string[] {
  const ids = (
    db
      .prepare("SELECT id FROM planning_blockers WHERE work_item_id = ? AND status = 'open'")
      .all(taskId) as { id: string }[]
  ).map((row) => row.id)
  if (ids.length === 0) return ids
  db.prepare(
    `UPDATE planning_blockers
     SET status = 'resolved', resolution_choice = ?, resolution_note = '', resolved_at = ?,
         resolved_by = ?
     WHERE work_item_id = ? AND status = 'open'`
  ).run(DONE_RESOLUTION_CHOICE, at, resolvedBy.slice(0, 200), taskId)
  return ids
}
