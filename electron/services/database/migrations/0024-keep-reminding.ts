import type { Migration } from './types'

/**
 * N1.7, Reminders that don't give up (N15): a custom reminder can keep
 * reminding after it is delivered.
 *
 * `keep_reminding` is 1 for such a reminder and `interval_minutes` how often
 * it comes back (5, 15, 30 or 60). `last_nudged_at` is when its notification
 * was last shown (its delivery counts), and `stopped_at` when it stopped: the
 * person pressed Stop reminding, the task was finished, or local midnight on
 * the day it was delivered came (then the Inbox says it was missed).
 * Existing reminders do not keep reminding.
 */
export const keepReminding: Migration = {
  version: 24,
  name: 'keep-reminding',
  up(db) {
    db.exec(`
      ALTER TABLE reminders ADD COLUMN keep_reminding INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE reminders ADD COLUMN interval_minutes INTEGER;
      ALTER TABLE reminders ADD COLUMN last_nudged_at INTEGER;
      ALTER TABLE reminders ADD COLUMN stopped_at INTEGER;
    `)
  }
}
