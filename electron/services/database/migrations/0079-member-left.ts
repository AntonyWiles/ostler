import type { Migration } from './types'

/**
 * A member who left a shared project on their own (`left_at`), as their PC said in the shared
 * folder before it stopped syncing. Unlike `removed_at` (an Owner removed them), they stay in the
 * member list, shown as left, and what they wrote is still taken: it was theirs to write.
 */
export const memberLeft: Migration = {
  version: 79,
  name: 'member-left',
  up(db) {
    db.exec(`ALTER TABLE sync_members ADD COLUMN left_at INTEGER;`)
  }
}
