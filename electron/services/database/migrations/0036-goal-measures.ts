import type { Migration } from './types'

/**
 * N5.6a, goals with numbers (N41): a goal's optional measure lives on its
 * row (all six columns null without one), and its check-ins in their own
 * table, one per goal and day. `project_id` lets removing a project remove
 * its check-ins; who recorded one is activity's actor kind.
 */
export const goalMeasures: Migration = {
  version: 36,
  name: 'goal-measures',
  up(db) {
    db.exec(`
      ALTER TABLE planning_goals ADD COLUMN measure_unit TEXT;
      ALTER TABLE planning_goals ADD COLUMN measure_start_value REAL;
      ALTER TABLE planning_goals ADD COLUMN measure_target_value REAL;
      ALTER TABLE planning_goals ADD COLUMN measure_start_date TEXT;
      ALTER TABLE planning_goals ADD COLUMN measure_target_date TEXT;
      ALTER TABLE planning_goals ADD COLUMN measure_direction TEXT
        CHECK (measure_direction IS NULL OR measure_direction IN ('up', 'down'));
      CREATE TABLE goal_check_ins (
        goal_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        date TEXT NOT NULL,
        value REAL NOT NULL,
        note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 500),
        recorded_at INTEGER NOT NULL,
        recorded_by_kind TEXT NOT NULL CHECK (recorded_by_kind IN ('human', 'automation')),
        recorded_by_person_id TEXT,
        PRIMARY KEY (goal_id, date)
      );
      CREATE INDEX idx_goal_check_ins_project ON goal_check_ins(project_id, recorded_at);
    `)
  }
}
