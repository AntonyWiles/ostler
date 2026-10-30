import type { Migration } from './types'

/**
 * N3.6, progress and your year (N30): a milestone's completion time.
 * `completed_at` is when it last became `complete`, in milliseconds, and is
 * cleared when it leaves it. Triggers keep it, so every path that writes a
 * milestone's status (the app, the automation API, rounds, imports, undo)
 * follows the one rule without a service having to remember it. A move takes
 * the write's own `updated_at` when the write moved it, otherwise the time
 * now. `completed_approx` is 1 when the time is a guess: a milestone already
 * complete before this migration takes its last update time, and so does
 * one written as complete in one go (an import, an undo); Your year marks
 * the months those fall in as approximate.
 */
export const milestoneCompletedAt: Migration = {
  version: 48,
  name: 'milestone-completed-at',
  up(db) {
    db.exec(`
      ALTER TABLE planning_milestones ADD COLUMN completed_at INTEGER;
      ALTER TABLE planning_milestones ADD COLUMN completed_approx INTEGER NOT NULL DEFAULT 0;
      UPDATE planning_milestones SET completed_at = updated_at, completed_approx = 1
        WHERE status = 'complete';
      CREATE INDEX idx_planning_milestones_completed
        ON planning_milestones(project_id, completed_at) WHERE completed_at IS NOT NULL;

      CREATE TRIGGER planning_milestones_completed_insert
      AFTER INSERT ON planning_milestones
      WHEN NEW.status = 'complete' AND NEW.completed_at IS NULL
      BEGIN
        UPDATE planning_milestones SET completed_at = NEW.updated_at, completed_approx = 1
          WHERE id = NEW.id;
      END;

      CREATE TRIGGER planning_milestones_completed_became
      AFTER UPDATE OF status ON planning_milestones
      WHEN NEW.status = 'complete' AND OLD.status <> 'complete'
      BEGIN
        UPDATE planning_milestones
          SET completed_at = CASE WHEN NEW.updated_at > OLD.updated_at THEN NEW.updated_at
                ELSE CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) END,
              completed_approx = 0
          WHERE id = NEW.id;
      END;

      CREATE TRIGGER planning_milestones_completed_left
      AFTER UPDATE OF status ON planning_milestones
      WHEN NEW.status <> 'complete' AND OLD.status = 'complete'
      BEGIN
        UPDATE planning_milestones SET completed_at = NULL, completed_approx = 0
          WHERE id = NEW.id;
      END;
    `)
  }
}
