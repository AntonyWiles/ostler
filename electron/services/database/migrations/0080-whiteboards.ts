import type { Migration } from './types'

/**
 * Whiteboards (plan `docs/plans/whiteboards/`, D5): a whiteboard is a Library item of kind
 * `whiteboard`, and each object on it is one row here. Objects go with their whiteboard by
 * cascade; `project_id` lets sync, the Viewer guard and project removal find them.
 */
export const whiteboards: Migration = {
  version: 80,
  name: 'whiteboards',
  up(db) {
    db.exec(`
      CREATE TABLE whiteboard_objects (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        whiteboard_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        z REAL NOT NULL DEFAULT 0,
        colour TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        link TEXT,
        group_id TEXT,
        data_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_whiteboard_objects_whiteboard ON whiteboard_objects(whiteboard_id);
      CREATE INDEX idx_whiteboard_objects_project ON whiteboard_objects(project_id);
    `)
  }
}
