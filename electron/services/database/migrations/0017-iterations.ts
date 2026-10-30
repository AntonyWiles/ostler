import type { Migration } from './types'

/**
 * R6.1, iterations (D44): sprints and cycles, optional per project.
 *
 * An iteration has a name, a start and an end date (local days, the end
 * included), an optional goal sentence and a status: planned, active or
 * finished. The service keeps a project's iterations from overlapping and
 * lets one at a time be active. A finished iteration keeps its summary
 * (tasks and estimate done and carried over) as JSON. A task is in at most
 * one iteration, through `planning_work_items.iteration_id`. Removing a
 * project clears its iterations through `project_id`.
 */
export const iterations: Migration = {
  version: 17,
  name: 'iterations',
  up(db) {
    db.exec(`
      CREATE TABLE planning_iterations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        goal TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'planned',
        summary TEXT,
        finished_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_planning_iterations_project
        ON planning_iterations(project_id, start_date);
      ALTER TABLE planning_work_items ADD COLUMN iteration_id TEXT;
      CREATE INDEX idx_planning_work_items_iteration
        ON planning_work_items(iteration_id) WHERE iteration_id IS NOT NULL;
    `)
  }
}
