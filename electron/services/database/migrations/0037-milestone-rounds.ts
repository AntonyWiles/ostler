import type { Migration } from './types'

/**
 * N5.7a, repeating rounds (N42): a milestone can be a round of work that
 * comes round again. Its schedule lives on its row (the rule as JSON, how
 * many days a round lasts, the next round's start, on or off), with the day
 * this round started, the round it was made from (null for the first), and
 * when the schedule made it (for the Inbox). Each task copied into a new
 * round keeps the task of the earlier round it came from, so a task can be
 * followed across rounds (N5.7b).
 */
export const milestoneRounds: Migration = {
  version: 37,
  name: 'milestone-rounds',
  up(db) {
    db.exec(`
      ALTER TABLE planning_milestones ADD COLUMN repeat_rule TEXT;
      ALTER TABLE planning_milestones ADD COLUMN repeat_length_days INTEGER;
      ALTER TABLE planning_milestones ADD COLUMN repeat_next_start TEXT;
      ALTER TABLE planning_milestones ADD COLUMN repeat_on INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE planning_milestones ADD COLUMN round_start TEXT;
      ALTER TABLE planning_milestones ADD COLUMN previous_round_id TEXT;
      ALTER TABLE planning_milestones ADD COLUMN round_started_by_schedule_at INTEGER;
      ALTER TABLE planning_work_items ADD COLUMN round_source_id TEXT;
      CREATE INDEX idx_planning_milestones_previous_round
        ON planning_milestones(previous_round_id);
    `)
  }
}
