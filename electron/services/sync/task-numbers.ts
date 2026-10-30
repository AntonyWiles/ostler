/*
 * A project's task numbers (N9.8a): one counter per project in
 * `project_task_counters`, the only place a new task's number is taken. The
 * desktop (`PlanningService`), received sync changes (`apply.ts`) and the phone
 * (`mobile/src/data/edits.ts`) all call `takeTaskNumber`, so a task added
 * anywhere gets the number the others would give it.
 *
 * Node-free, and positional parameters only, so the phone's op-sqlite adapter
 * runs it as well as better-sqlite3.
 */

/** What the counter needs of a database; better-sqlite3 and the phone's adapter both fit. */
export interface TaskNumberDb {
  prepare(sql: string): {
    run(...args: unknown[]): unknown
    get(...args: unknown[]): unknown
  }
}

/** Moves the project's task counter past every number its tasks have, so a new task never clashes. */
export function advanceTaskCounter(db: TaskNumberDb, projectId: string): void {
  db.prepare(
    `INSERT INTO project_task_counters (project_id, next_number)
     VALUES (?, COALESCE((SELECT MAX(number) FROM planning_work_items WHERE project_id = ?), 0) + 1)
     ON CONFLICT (project_id) DO UPDATE SET next_number = MAX(
       next_number,
       COALESCE((SELECT MAX(number) FROM planning_work_items WHERE project_id = ?), 0) + 1
     )`
  ).run(projectId, projectId, projectId)
}

/**
 * Takes the project's next task number. The counter never goes back, so a
 * number is never reused, even after a task is deleted for good. `wanted` (a
 * project file's number) is kept when no task of the project has it; the
 * counter then continues after it. Call inside the transaction that inserts the task.
 */
export function takeTaskNumber(
  db: TaskNumberDb,
  projectId: string,
  wanted?: number | null
): number {
  advanceTaskCounter(db, projectId)
  const { next_number: next } = db
    .prepare('SELECT next_number FROM project_task_counters WHERE project_id = ?')
    .get(projectId) as { next_number: number }
  const keep =
    typeof wanted === 'number' &&
    Number.isSafeInteger(wanted) &&
    wanted >= 1 &&
    !db
      .prepare('SELECT 1 FROM planning_work_items WHERE project_id = ? AND number = ?')
      .get(projectId, wanted)
  const number = keep ? wanted : next
  db.prepare('UPDATE project_task_counters SET next_number = ? WHERE project_id = ?').run(
    Math.max(next, number + 1),
    projectId
  )
  return number
}
