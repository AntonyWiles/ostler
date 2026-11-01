import type { Migration } from './types'

/**
 * Why a blocked task is blocked (`blocked_reason`, empty when it says
 * nothing or is not blocked) and whether a task is for its owner alone
 * (`owner_only`): agents never queue, claim or work on such a task.
 */
export const blockedReasonOwnerOnly: Migration = {
  version: 92,
  name: 'blocked-reason-owner-only',
  up(db) {
    db.exec(`
      ALTER TABLE planning_work_items ADD COLUMN blocked_reason TEXT NOT NULL DEFAULT '';
      ALTER TABLE planning_work_items
        ADD COLUMN owner_only INTEGER NOT NULL DEFAULT 0 CHECK (owner_only IN (0, 1));
    `)
  }
}
