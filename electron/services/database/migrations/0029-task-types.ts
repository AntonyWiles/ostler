import type { Migration } from './types'

/**
 * N2.7a, task types (N22): each project can name kinds of task, such as
 * Bug, Feature and Chore, each with a lucide icon name, a palette colour and
 * a place in the project's order. A task has at most one type, through
 * `planning_work_items.type_id` (null for none). The service keeps a project
 * to 20 types with unique names. Removing a project clears its types through
 * `project_id`.
 */
export const taskTypes: Migration = {
  version: 29,
  name: 'task-types',
  up(db) {
    db.exec(`
      CREATE TABLE planning_task_types (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        icon TEXT NOT NULL,
        color TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX idx_planning_task_types_name
        ON planning_task_types(project_id, name COLLATE NOCASE);
      ALTER TABLE planning_work_items ADD COLUMN type_id TEXT;
      CREATE INDEX idx_planning_work_items_type
        ON planning_work_items(type_id) WHERE type_id IS NOT NULL;
    `)
  }
}
