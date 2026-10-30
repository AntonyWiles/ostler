import type { Migration } from './types'

/**
 * P5.2, comments and activity: comments on
 * a task, one row per changed field, and who changed a task's status.
 */
export const commentsAndActivity: Migration = {
  version: 4,
  name: 'comments-and-activity',
  up(db) {
    db.exec(`
      -- Who moved the task. Rows written before P5.2 stay null ("unknown").
      -- Lead and cycle time read only from_status, to_status and at.
      ALTER TABLE planning_status_history ADD COLUMN actor_kind TEXT;
      ALTER TABLE planning_status_history ADD COLUMN actor_person_id TEXT;
      CREATE INDEX idx_planning_status_history_item ON planning_status_history(work_item_id, at);

      -- One row per changed field. Values are JSON text; a description edit
      -- stores neither text, only that it changed. metadata carries extras
      -- such as the AI draft an approved task came from.
      CREATE TABLE planning_field_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        field TEXT NOT NULL,
        from_value TEXT,
        to_value TEXT,
        actor_kind TEXT NOT NULL,
        actor_person_id TEXT,
        metadata TEXT,
        at INTEGER NOT NULL
      );
      CREATE INDEX idx_planning_field_changes_item ON planning_field_changes(work_item_id, at);
      CREATE INDEX idx_planning_field_changes_project ON planning_field_changes(project_id, at);

      -- Markdown notes on a task. Deleting one sets deleted_at (undo clears
      -- it); the row goes for good with its task.
      CREATE TABLE planning_comments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        author_person_id TEXT,
        author_kind TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX idx_planning_comments_item ON planning_comments(work_item_id, created_at);
      CREATE INDEX idx_planning_comments_project ON planning_comments(project_id, created_at);
    `)
  }
}
