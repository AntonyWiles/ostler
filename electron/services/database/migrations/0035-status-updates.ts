import type { Migration } from './types'

/**
 * N5.5, status updates (N40): the person's judgement of how a project is
 * going (on-track, at-risk or off-track) with a Markdown note, posted by a
 * person or the automation API (activity's actor kinds). Deleting one sets
 * `deleted_at`, so Undo brings it back; `project_id` lets removing a project
 * remove its updates.
 */
export const statusUpdates: Migration = {
  version: 35,
  name: 'status-updates',
  up(db) {
    db.exec(`
      CREATE TABLE status_updates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        health TEXT NOT NULL CHECK (health IN ('on-track', 'at-risk', 'off-track')),
        note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
        author_kind TEXT NOT NULL CHECK (author_kind IN ('human', 'automation')),
        author_person_id TEXT,
        posted_at INTEGER NOT NULL,
        edited_at INTEGER,
        deleted_at INTEGER
      );
      CREATE INDEX idx_status_updates_project ON status_updates(project_id, posted_at);
    `)
  }
}
