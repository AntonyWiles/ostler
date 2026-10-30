import type { Migration } from './types'

/**
 * R2.4, columns that fit the project (D34): a project's own column names and
 * hidden columns, one row per project and status, beside the WIP limits. A
 * status with neither a name nor hidden has no row. The project removal
 * service clears them with the project.
 */
export const boardColumns: Migration = {
  version: 13,
  name: 'board-columns',
  up(db) {
    db.exec(`
      CREATE TABLE planning_column_settings (
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        hidden INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, status)
      );
    `)
  }
}
