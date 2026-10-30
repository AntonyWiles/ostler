import type { Migration } from './types'

/**
 * The sync server (docs/plans/integrations/overview.md, phase 7): where this PC
 * shares projects when not through a folder, and how it signs in there, with
 * an access key (sealed with Windows' protection) or a Microsoft work account
 * from Settings › Connections. One row at most. An organisation's policy can
 * set the address and the way of signing in; the key or account stays here.
 */
export const syncServer: Migration = {
  version: 68,
  name: 'sync-server',
  up(db) {
    db.exec(`
      CREATE TABLE sync_server (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        url TEXT,
        sign_in TEXT NOT NULL CHECK (sign_in IN ('key', 'microsoft')),
        access_key TEXT,
        account_id TEXT,
        scope TEXT,
        updated_at INTEGER NOT NULL
      );
    `)
  }
}
