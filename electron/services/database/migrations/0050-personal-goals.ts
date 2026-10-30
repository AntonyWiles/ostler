import type { Migration } from './types'

/**
 * N5.6b, goals across projects (N41): goals of one's own, outside any
 * project, with the same optional measure as a project goal (all six
 * `measure_*` columns null without one) and their own check-ins, one per
 * goal and day. `personal_goal_links` says which project goals count towards
 * one: a project goal counts towards at most one, and the link carries its
 * project's id, so removing a project removes its links. Neither table goes
 * in a project file.
 *
 * Pins gain the `personal-goal` kind. Its pins belong to no project and are
 * stored with an empty `project_id`; SQLite cannot change a CHECK, so the
 * table is built again with its rows, indexes and countdowns kept.
 */
export const personalGoals: Migration = {
  version: 50,
  name: 'personal-goals',
  up(db) {
    db.exec(`
      CREATE TABLE personal_goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        outcome TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'dropped')),
        measure_unit TEXT,
        measure_start_value REAL,
        measure_target_value REAL,
        measure_start_date TEXT,
        measure_target_date TEXT,
        measure_direction TEXT
          CHECK (measure_direction IS NULL OR measure_direction IN ('up', 'down')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE personal_goal_check_ins (
        personal_goal_id TEXT NOT NULL,
        date TEXT NOT NULL,
        value REAL NOT NULL,
        note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
        recorded_at INTEGER NOT NULL,
        recorded_by_kind TEXT NOT NULL CHECK (recorded_by_kind IN ('human', 'automation')),
        PRIMARY KEY (personal_goal_id, date)
      );
      CREATE TABLE personal_goal_links (
        goal_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        personal_goal_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_personal_goal_links_goal ON personal_goal_links(personal_goal_id);
      CREATE INDEX idx_personal_goal_links_project ON personal_goal_links(project_id);

      CREATE TABLE pins_next (
        id TEXT PRIMARY KEY,
        place TEXT NOT NULL CHECK (place IN ('sidebar', 'overview')),
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('task', 'milestone', 'decision', 'library', 'saved-view', 'project-view', 'personal-goal')),
        target_id TEXT NOT NULL,
        order_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        countdown INTEGER NOT NULL DEFAULT 0,
        UNIQUE (place, project_id, kind, target_id)
      );
      INSERT INTO pins_next (id, place, project_id, kind, target_id, order_key, created_at, countdown)
        SELECT id, place, project_id, kind, target_id, order_key, created_at, countdown FROM pins;
      DROP TABLE pins;
      ALTER TABLE pins_next RENAME TO pins;
      CREATE INDEX idx_pins_place ON pins(place, order_key);
      CREATE INDEX idx_pins_project ON pins(project_id, place);
      CREATE INDEX idx_pins_countdown ON pins(countdown) WHERE countdown = 1;
    `)
  }
}
