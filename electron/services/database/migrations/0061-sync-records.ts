import type { Migration } from './types'

/**
 * What a shared project sends besides its rows (docs/plans/integrations/shared-folder-sync.md, S10c):
 * the people its tasks name, and the project's own settings (name, colour,
 * notes, tags, task prefix; never its folder). Each is written as a file of its
 * own when it changes. `sync_records` keeps, per share, the stamp of the newest
 * file seen for each record and a hash of what it held, so an unchanged record
 * is not written again and an older file never wins.
 */
export const syncRecords: Migration = {
  version: 61,
  name: 'sync-records',
  up(db) {
    db.exec(`
      CREATE TABLE sync_records (
        share_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('person', 'project')),
        record_id TEXT NOT NULL,
        stamp TEXT NOT NULL,
        hash TEXT NOT NULL,
        PRIMARY KEY (share_id, kind, record_id)
      );
    `)
  }
}
