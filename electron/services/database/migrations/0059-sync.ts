import type { Migration } from './types'

/**
 * Sharing a project through a synced folder (docs/plans/integrations/shared-folder-sync.md).
 *
 * `sync_shares` is one row per shared project: the share's id, the folder it
 * syncs through and this PC's member and device. `sync_members` lists who is
 * in each share, with the public key their changes are signed with.
 * `sync_outbox` holds changes made here and not yet written to the folder.
 * `sync_field_stamps` keeps the clock stamp of the last change to each field,
 * so a merge can tell which of two changes is later. `sync_applied` is how far
 * each other device's change files have been read, and `sync_pending` holds
 * received changes waiting for a row they need. Rows carry no foreign keys:
 * changes can arrive before what they refer to.
 */
export const sync: Migration = {
  version: 59,
  name: 'sync',
  up(db) {
    db.exec(`
      CREATE TABLE sync_shares (
        project_id TEXT PRIMARY KEY,
        share_id TEXT NOT NULL UNIQUE,
        folder TEXT NOT NULL,
        member_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        format_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_synced_at INTEGER
      );

      CREATE TABLE sync_members (
        share_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        person_id TEXT,
        name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (share_id, member_id)
      );

      CREATE TABLE sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        row_key TEXT NOT NULL,
        op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
        columns TEXT NOT NULL,
        stamp TEXT NOT NULL,
        actor_kind TEXT NOT NULL,
        actor_person_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_sync_outbox_project ON sync_outbox(project_id, id);

      CREATE TABLE sync_field_stamps (
        table_name TEXT NOT NULL,
        row_key TEXT NOT NULL,
        column_name TEXT NOT NULL,
        stamp TEXT NOT NULL,
        PRIMARY KEY (table_name, row_key, column_name)
      );

      CREATE TABLE sync_applied (
        share_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        last_sequence INTEGER NOT NULL,
        PRIMARY KEY (share_id, device_id)
      );

      CREATE TABLE sync_pending (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        share_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        row_key TEXT NOT NULL,
        op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
        columns TEXT NOT NULL,
        stamp TEXT NOT NULL,
        waiting_for TEXT NOT NULL,
        received_at INTEGER NOT NULL
      );
      CREATE INDEX idx_sync_pending_waiting ON sync_pending(share_id, waiting_for);
    `)
  }
}
