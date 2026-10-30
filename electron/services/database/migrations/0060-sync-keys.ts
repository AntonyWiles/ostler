import type { Migration } from './types'

/**
 * Keys for sharing a project, and field stamps that know their project
 * (docs/plans/integrations/shared-folder-sync.md, S6d).
 *
 * `sync_shares.project_key` holds the project's 32-byte key, sealed with
 * `sealSecret`. `sync_identity` is this PC's one Ed25519 key pair; its private
 * key is sealed too. `sync_field_stamps.project_id` lets project removal clear a
 * project's stamps along with its other rows.
 */
export const syncKeys: Migration = {
  version: 60,
  name: 'sync-keys',
  up(db) {
    db.exec(`
      ALTER TABLE sync_shares ADD COLUMN project_key TEXT;

      CREATE TABLE sync_identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        public_key TEXT NOT NULL,
        private_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      ALTER TABLE sync_field_stamps ADD COLUMN project_id TEXT;
      CREATE INDEX idx_sync_field_stamps_project ON sync_field_stamps(project_id);
    `)
  }
}
