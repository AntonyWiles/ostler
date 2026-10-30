import type { Migration } from './types'

/**
 * This PC's own role in each shared project (docs/plans/people-and-devices/overview.md, D9).
 *
 * `sync_shares.my_role` is the role of this PC's own person in the share. It is
 * kept up to date by `roles.ts` (`recordMyRole`) whenever roles are read, so the
 * database guard on a Viewer's PC (capture.ts, read-only triggers) can refuse
 * writes to a shared project without reading `sync_roles` on every change.
 * Existing shares default to Owner until the next pull reads their roles.
 */
export const myRole: Migration = {
  version: 74,
  name: 'my-role',
  up(db) {
    db.exec(`
      ALTER TABLE sync_shares ADD COLUMN my_role TEXT NOT NULL DEFAULT 'owner'
        CHECK (my_role IN ('owner', 'editor', 'viewer'));
    `)
  }
}
