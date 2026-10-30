import type { Migration } from './types'

/**
 * The personal share (docs/plans/people-and-devices/overview.md, D13). One person's
 * devices keep their personal data in one share of kind `'personal'`, whose sentinel
 * project id in the sync tables is `'~personal'`. `sync_shares.kind` tells the engine
 * which tables a share carries: `'project'` shares refuse personal tables and the
 * personal share refuses project tables. A partial unique index allows at most one
 * personal share on a PC.
 */
export const personalShare: Migration = {
  version: 75,
  name: 'personal-share',
  up(db) {
    db.exec(`
      ALTER TABLE sync_shares ADD COLUMN kind TEXT NOT NULL DEFAULT 'project'
        CHECK (kind IN ('project', 'personal'));
      CREATE UNIQUE INDEX idx_sync_shares_one_personal ON sync_shares(kind)
        WHERE kind = 'personal';
    `)
  }
}
