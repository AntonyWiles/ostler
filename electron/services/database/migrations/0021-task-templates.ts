import type { Migration } from './types'

/**
 * N2.1, task templates (N16): one task, with its subtasks, saved as a
 * pattern to make again.
 *
 * `project_id` is the project it belongs to, or NULL for every project.
 * `body` is the template as JSON, checked by `src/shared/task-templates.ts`.
 * Removing a project removes its templates through `project_id`; templates
 * for every project have none and stay.
 */
export const taskTemplates: Migration = {
  version: 21,
  name: 'task-templates',
  up(db) {
    db.exec(`
      CREATE TABLE planning_task_templates (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_planning_task_templates_project ON planning_task_templates(project_id, name);
    `)
  }
}
