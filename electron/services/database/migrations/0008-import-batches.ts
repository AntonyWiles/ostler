import type { Migration } from './types'

/**
 * P6.1, import and export:
 *
 * - `import_batches`: one row per import (CSV, Trello or a project
 *   package), so an import can be undone in one step. `undone_at` is set
 *   when its tasks went to the recycle bin, and cleared if that was undone.
 * - `planning_work_items.import_batch_id`: the batch a task came in with, or
 *   null. Not a foreign key: a batch row outlives nothing, it goes with its
 *   project like every project-scoped row.
 */
export const importBatches: Migration = {
  version: 8,
  name: 'import-batches',
  up(db) {
    db.exec(`
      CREATE TABLE import_batches (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source TEXT NOT NULL,
        file_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        item_count INTEGER NOT NULL,
        undone_at INTEGER
      );
      CREATE INDEX idx_import_batches_project ON import_batches(project_id, created_at);
      ALTER TABLE planning_work_items ADD COLUMN import_batch_id TEXT;
      CREATE INDEX idx_planning_work_items_import_batch
        ON planning_work_items(import_batch_id) WHERE import_batch_id IS NOT NULL;
    `)
  }
}
