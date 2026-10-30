import type { Migration } from './types'

/**
 * Settings follow the person (docs/plans/people-and-devices/overview.md, D3, D18). `sync_settings`
 * keeps, per personal share, the stamp and hash of each top-level setting last sent or received,
 * so a setting is sent only when it changes and the newest stamp wins per key. The two mirror
 * targets gain `device_id`: the device that turned the write-back on. Only that device runs the
 * mirror; the other devices see the target and skip it. Rows from before this migration have no
 * device; the first device to run the mirror claims them.
 */
export const settingsFollowYou: Migration = {
  version: 76,
  name: 'settings-follow-you',
  up(db) {
    db.exec(`
      CREATE TABLE sync_settings (
        share_id TEXT NOT NULL,
        setting TEXT NOT NULL,
        stamp TEXT NOT NULL,
        hash TEXT NOT NULL,
        PRIMARY KEY (share_id, setting)
      );
      ALTER TABLE calendar_write_target ADD COLUMN device_id TEXT;
      ALTER TABLE task_list_target ADD COLUMN device_id TEXT;
    `)
  }
}
