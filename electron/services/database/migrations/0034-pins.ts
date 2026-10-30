import type { Migration } from './types'

/**
 * N5.2a, pins and shortcuts (N37): pointers to the things a person opens all
 * day. A pin shows in the sidebar's Pinned section (`sidebar`) or on its
 * project's Overview (`overview`), and points at a task, milestone, decision,
 * Library item, saved view or project view by id. It stores no title: the
 * target's current title is read when the pins are listed, and a target that
 * is gone shows as gone. One pin per place and target. `project_id` is the
 * target's project, so removing a project removes its pins.
 */
export const pins: Migration = {
  version: 34,
  name: 'pins',
  up(db) {
    db.exec(`
      CREATE TABLE pins (
        id TEXT PRIMARY KEY,
        place TEXT NOT NULL CHECK (place IN ('sidebar', 'overview')),
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('task', 'milestone', 'decision', 'library', 'saved-view', 'project-view')),
        target_id TEXT NOT NULL,
        order_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (place, project_id, kind, target_id)
      );
      CREATE INDEX idx_pins_place ON pins(place, order_key);
      CREATE INDEX idx_pins_project ON pins(project_id, place);
    `)
  }
}
