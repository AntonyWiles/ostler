import type { Migration } from './types'

/**
 * "Stop old invites" (team-leaders plan, D12). The key change that makes every earlier invite
 * useless removes no one, so the share records when it happened and which person made it, for
 * the Sharing panel and the membership history.
 */
export const invitesReset: Migration = {
  version: 87,
  name: 'invites-reset',
  up(db) {
    db.exec(`
      ALTER TABLE sync_shares ADD COLUMN invites_reset_at INTEGER;
      ALTER TABLE sync_shares ADD COLUMN invites_reset_by TEXT;
    `)
  }
}
