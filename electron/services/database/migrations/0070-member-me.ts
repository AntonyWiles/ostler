import type { Migration } from './types'

/**
 * Each member row remembers the person's Me card and, from before person keys,
 * which person it is (docs/plans/people-and-devices/overview.md, D5, section 2).
 *
 * `me` is the JSON `{ personId, name, initials, color }` the member's PC sent
 * with its member file, or NULL. A member from before this migration has no
 * person key yet: it is its own person, so its device key stands in for it
 * until a member file says otherwise.
 */
export const memberMe: Migration = {
  version: 70,
  name: 'member-me',
  up(db) {
    db.exec(`
      ALTER TABLE sync_members ADD COLUMN me TEXT;
      UPDATE sync_members SET person_public_key = public_key WHERE person_public_key IS NULL;
    `)
  }
}
