import type { Migration } from './types'

/**
 * Writing back (docs/plans/integrations/overview.md, phase 6): time blocks
 * copied as events into one calendar of a connected account.
 * `calendar_write_target` is that calendar (one row at most);
 * `time_block_events` maps each copied block to its event there, with the
 * hash of what was written so only changed blocks are written again. A block
 * that is gone has its event deleted, then its row.
 */
export const timeBlockEvents: Migration = {
  version: 66,
  name: 'time-block-events',
  up(db) {
    db.exec(`
      CREATE TABLE calendar_write_target (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        account_id TEXT NOT NULL,
        remote_calendar TEXT NOT NULL,
        name TEXT NOT NULL,
        synced_at INTEGER,
        failed_at INTEGER,
        failure TEXT
      );
      CREATE TABLE time_block_events (
        block_id TEXT PRIMARY KEY,
        remote_id TEXT NOT NULL,
        etag TEXT,
        hash TEXT NOT NULL,
        synced_at INTEGER NOT NULL
      );
    `)
  }
}
