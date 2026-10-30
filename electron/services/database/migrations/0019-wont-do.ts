import type { Migration } from './types'

/**
 * N1.2, Won't do (N8): a task closed without being done.
 *
 * `resolution` is how a closed task ended: `'wont-do'` or null (more kinds
 * may come). `resolution_reason` is the person's optional reason, at most
 * 500 characters. A won't-do task is also archived (`archived_at`), keeps
 * its status, and counts nowhere in reports. Reopening clears both.
 */
export const wontDo: Migration = {
  version: 19,
  name: 'wont-do',
  up(db) {
    db.exec(`
      ALTER TABLE planning_work_items ADD COLUMN resolution TEXT;
      ALTER TABLE planning_work_items ADD COLUMN resolution_reason TEXT NOT NULL DEFAULT '';
    `)
  }
}
