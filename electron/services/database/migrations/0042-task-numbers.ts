import type { Migration } from './types'

/**
 * N9.8a, task IDs (N66): each task gets a number, unique within its project,
 * and each project a counter of the next number, which never goes down, so a
 * number is never reused even after a task is deleted for good. The prefix
 * that makes a number an ID (SHOP-12) is a project setting in `config.json`
 * (config migration 33), where the project's name is.
 *
 * Existing tasks are numbered in the order they were made, oldest first, in
 * one statement per table, which stays fast for 10,000 tasks.
 */
export const taskNumbers: Migration = {
  version: 42,
  name: 'task-numbers',
  up(db) {
    db.exec(`
      ALTER TABLE planning_work_items ADD COLUMN number INTEGER;
      CREATE TABLE project_task_counters (
        project_id TEXT PRIMARY KEY,
        next_number INTEGER NOT NULL CHECK (next_number >= 1)
      );
      UPDATE planning_work_items
        SET number = numbered.n
        FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY project_id ORDER BY created_at, rowid
          ) AS n
          FROM planning_work_items
        ) AS numbered
        WHERE planning_work_items.id = numbered.id;
      INSERT INTO project_task_counters (project_id, next_number)
        SELECT project_id, MAX(number) + 1 FROM planning_work_items GROUP BY project_id;
      CREATE UNIQUE INDEX idx_planning_work_items_number
        ON planning_work_items(project_id, number);
    `)
  }
}
