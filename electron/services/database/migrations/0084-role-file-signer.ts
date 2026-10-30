import type { Migration } from './types'

/**
 * Who signed an applied role file (`signed_by`, the signer's person public key) and when this PC
 * applied it (`applied_at`), for the membership history in the Sharing panel. Files read before
 * this have neither; their time is read from the file's stamp instead.
 */
export const roleFileSigner: Migration = {
  version: 84,
  name: 'role-file-signer',
  up(db) {
    db.exec(`
      ALTER TABLE sync_role_files ADD COLUMN signed_by TEXT;
      ALTER TABLE sync_role_files ADD COLUMN applied_at INTEGER;
    `)
  }
}
