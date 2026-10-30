import type { Migration } from './types'

/**
 * N9.7, scheduled agent tasks (N65): a repeat rule may go to agents when it
 * comes round (off for every existing rule), and moves with the rule to each
 * new occurrence. Each occurrence records once what its schedule did: queued
 * it, or why not ('agentsOff', 'noFolder', 'alreadyQueued', or 'refused' with
 * the reason), and when. Recorded in the database so a restart, or days
 * missed while Ostler was closed, never queue an occurrence twice.
 */
export const scheduledAgentTasks: Migration = {
  version: 56,
  name: 'scheduled-agent-tasks',
  up(db) {
    db.exec(`
      ALTER TABLE planning_recurrences ADD COLUMN go_to_agents INTEGER NOT NULL DEFAULT 0
        CHECK (go_to_agents IN (0, 1));
      ALTER TABLE planning_work_items ADD COLUMN scheduled_queue TEXT
        CHECK (scheduled_queue IS NULL OR scheduled_queue IN
          ('queued', 'agentsOff', 'noFolder', 'alreadyQueued', 'refused'));
      ALTER TABLE planning_work_items ADD COLUMN scheduled_queue_at INTEGER;
      ALTER TABLE planning_work_items ADD COLUMN scheduled_queue_note TEXT;
    `)
  }
}
