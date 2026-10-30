import type { Migration } from './types'

/**
 * The newer sharing features each member's PC says it understands (capabilities/*.ostlercaps),
 * keeping the highest version read per member. Shown as `ShareState.sharedCapabilities`.
 */
export const memberCapabilities: Migration = {
  version: 85,
  name: 'member-capabilities',
  up(db) {
    db.exec(`
      CREATE TABLE sync_member_capabilities (
        share_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        capabilities TEXT NOT NULL,
        PRIMARY KEY (share_id, member_id)
      );
    `)
  }
}
