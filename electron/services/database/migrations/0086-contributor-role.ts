import type { Migration } from './types'

/**
 * The Contributor role (team-leaders plan, D5). `sync_roles.role` and `sync_shares.my_role` each
 * carry a CHECK listing the roles, and SQLite cannot alter a CHECK, so both tables are rebuilt
 * with `'contributor'` added and every row copied across unchanged.
 */
export const contributorRole: Migration = {
  version: 86,
  name: 'contributor-role',
  up(db) {
    db.exec(`
      CREATE TABLE sync_roles_new (
        share_id TEXT NOT NULL,
        person_public_key TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'contributor', 'viewer')),
        since_stamp TEXT NOT NULL,
        granted_by TEXT,
        cutoffs TEXT,
        PRIMARY KEY (share_id, person_public_key)
      );
      INSERT INTO sync_roles_new (share_id, person_public_key, role, since_stamp, granted_by, cutoffs)
        SELECT share_id, person_public_key, role, since_stamp, granted_by, cutoffs FROM sync_roles;
      DROP TABLE sync_roles;
      ALTER TABLE sync_roles_new RENAME TO sync_roles;

      CREATE TABLE sync_shares_new (
        project_id TEXT PRIMARY KEY,
        share_id TEXT NOT NULL UNIQUE,
        folder TEXT NOT NULL,
        member_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        format_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_synced_at INTEGER,
        project_key TEXT,
        key_generation INTEGER NOT NULL DEFAULT 0,
        rotations_read INTEGER NOT NULL DEFAULT 0,
        my_role TEXT NOT NULL DEFAULT 'owner'
          CHECK (my_role IN ('owner', 'editor', 'contributor', 'viewer')),
        kind TEXT NOT NULL DEFAULT 'project' CHECK (kind IN ('project', 'personal')),
        joined_invite TEXT
      );
      INSERT INTO sync_shares_new (
        project_id, share_id, folder, member_id, device_id, format_version, created_at,
        last_synced_at, project_key, key_generation, rotations_read, my_role, kind, joined_invite
      )
        SELECT project_id, share_id, folder, member_id, device_id, format_version, created_at,
          last_synced_at, project_key, key_generation, rotations_read, my_role, kind, joined_invite
        FROM sync_shares;
      DROP TABLE sync_shares;
      ALTER TABLE sync_shares_new RENAME TO sync_shares;
      CREATE UNIQUE INDEX idx_sync_shares_one_personal ON sync_shares(kind)
        WHERE kind = 'personal';
    `)
  }
}
