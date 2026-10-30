import type { Migration } from './types'

/**
 * N4.3a, triage (N33): `in_triage` marks a quick capture waiting in its
 * project's To triage view (0 or 1, default 0), and `captured_by` says how it
 * was captured (`quick-add`, `snip`, `text` or `api`), or null. A task in
 * triage counts nowhere until it is accepted.
 */
export const triage: Migration = {
  version: 45,
  name: 'triage',
  up(db) {
    db.exec(`
      ALTER TABLE planning_work_items ADD COLUMN in_triage INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE planning_work_items ADD COLUMN captured_by TEXT;
    `)
  }
}
