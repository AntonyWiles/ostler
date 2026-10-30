import type { Migration } from './types'

/**
 * A person's key pair, shared by all of their devices, and the device
 * certificates that tie each device to it (docs/plans/people-and-devices/overview.md,
 * D4, section 1).
 *
 * `sync_person` holds this PC's copy of the person key: one row at most, the
 * private key sealed with `sealSecret`. `source` says whether it was made on
 * this PC (`'made'`) or received from another device (`'paired'`). Each member
 * row in `sync_members` may name the person's public key and carry that
 * device's certificate, both filled in by the member-file step.
 */
export const personKeys: Migration = {
  version: 69,
  name: 'person-keys',
  up(db) {
    db.exec(`
      CREATE TABLE sync_person (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        public_key TEXT NOT NULL,
        private_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('made', 'paired'))
      );

      ALTER TABLE sync_members ADD COLUMN person_public_key TEXT;
      ALTER TABLE sync_members ADD COLUMN certificate TEXT;
    `)
  }
}
