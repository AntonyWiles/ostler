import type { Migration } from './types'

/**
 * Removing someone from a shared project (docs/plans/integrations/shared-folder-sync.md,
 * decision 4, S7d): they keep what they have, and later changes use a new key
 * they never get.
 *
 * Each PC gains an X25519 key pair (`sync_identity.box_*`, private key sealed)
 * that a new project key can be encrypted to; each member's public one is in
 * `sync_members.box_public_key`. `sync_keys` keeps every generation of a
 * share's project key (sealed), since older files name the one they used;
 * `sync_shares.key_generation` is the one new files use, `rotations_read` the
 * newest key change this PC has read. `removed_at` marks a
 * removed member; `removed_cutoffs` (JSON, device id to sequence) is how far
 * their change files are still taken, as the PC that removed them had applied.
 */
export const syncKeyRotation: Migration = {
  version: 62,
  name: 'sync-key-rotation',
  up(db) {
    db.exec(`
      ALTER TABLE sync_identity ADD COLUMN box_public_key TEXT;
      ALTER TABLE sync_identity ADD COLUMN box_private_key TEXT;
      ALTER TABLE sync_members ADD COLUMN box_public_key TEXT;
      ALTER TABLE sync_members ADD COLUMN removed_at INTEGER;
      ALTER TABLE sync_members ADD COLUMN removed_cutoffs TEXT;
      ALTER TABLE sync_shares ADD COLUMN key_generation INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sync_shares ADD COLUMN rotations_read INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE sync_keys (
        share_id TEXT NOT NULL,
        generation INTEGER NOT NULL CHECK (generation >= 0),
        project_key TEXT NOT NULL,
        PRIMARY KEY (share_id, generation)
      );
    `)
  }
}
