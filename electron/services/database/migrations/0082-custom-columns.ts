import type { Migration } from './types'

/**
 * Columns of a project's own (MOP-26). Each is a row of
 * `planning_column_settings` whose status is `custom:<id>`, with its name,
 * whether it is hidden, the status it counts as (`counts_as`) and its place
 * among the columns counting as that status (`position`), so sync, undo, the
 * project files and project removal carry them as they do the six. A task in
 * one keeps that status and names the column in `column_id`.
 */
export const customColumns: Migration = {
  version: 82,
  name: 'custom-columns',
  up(db) {
    db.exec(`
      ALTER TABLE planning_column_settings ADD COLUMN counts_as TEXT;
      ALTER TABLE planning_column_settings ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE planning_work_items ADD COLUMN column_id TEXT;
    `)
  }
}
