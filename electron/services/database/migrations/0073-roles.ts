import type { Migration } from './types'

/**
 * Roles in a shared project (docs/plans/people-and-devices/overview.md, D1, D6, D7, D8).
 *
 * `sync_roles` is each person's current role in a share (`owner`, `editor` or
 * `viewer`), keyed by the person's public key. `sync_role_files` lists the role
 * change files this PC has read, in stamp order: who each names, the role it
 * gave and the role before it, the cutoffs (how far each device's change files
 * had been applied when it was written), and whether it was applied or refused.
 * A file with `applied = 0` is kept so it is not read again.
 *
 * Shares from before roles have no role files, so every existing person becomes
 * Owner (D6): the rows below are made for them here, not on each PC.
 */
export const roles: Migration = {
  version: 73,
  name: 'roles',
  up(db) {
    db.exec(`
      CREATE TABLE sync_roles (
        share_id TEXT NOT NULL,
        person_public_key TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
        since_stamp TEXT NOT NULL,
        granted_by TEXT,
        cutoffs TEXT,
        PRIMARY KEY (share_id, person_public_key)
      );

      CREATE TABLE sync_role_files (
        share_id TEXT NOT NULL,
        path TEXT NOT NULL,
        stamp TEXT NOT NULL,
        person_public_key TEXT,
        role TEXT,
        previous_role TEXT,
        cutoffs TEXT,
        applied INTEGER NOT NULL CHECK (applied IN (0, 1)),
        PRIMARY KEY (share_id, path)
      );

      INSERT INTO sync_roles (share_id, person_public_key, role, since_stamp, granted_by, cutoffs)
      SELECT share_id, COALESCE(person_public_key, public_key), 'owner', '0', NULL, NULL
      FROM sync_members
      WHERE removed_at IS NULL
      GROUP BY share_id, COALESCE(person_public_key, public_key);
    `)
  }
}
