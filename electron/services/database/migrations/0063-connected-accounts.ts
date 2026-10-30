import type { Migration } from './types'

/**
 * Connected accounts (docs/plans/integrations/overview.md, "Connected accounts",
 * phase 0). One row per account a person connected: Google, Microsoft, a
 * CalDAV/CardDAV server, Dropbox.
 *
 * `secret` is the account's tokens or password as JSON, encrypted with
 * Windows' protection (`encryptApiKey`); it never leaves the main process.
 * `capabilities` is a JSON array of what the account was granted
 * (`calendar.read` and the like); `server` is a CalDAV account's address.
 * `failure` is a reason code shown in plain words, never raw error text.
 *
 * `account_apps` holds a person's own app registration (client ID, and a
 * sealed client secret for Google desktop apps) for a provider Ostler has no
 * registration for yet.
 */
export const connectedAccounts: Migration = {
  version: 63,
  name: 'connected-accounts',
  up(db) {
    db.exec(`
      CREATE TABLE connected_accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'caldav', 'dropbox')),
        label TEXT NOT NULL,
        server TEXT,
        capabilities TEXT NOT NULL DEFAULT '[]',
        secret TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'connected'
          CHECK (status IN ('connected', 'needs-reconnect', 'failed')),
        failure TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_used_at INTEGER
      );

      CREATE TABLE account_apps (
        provider TEXT PRIMARY KEY CHECK (provider IN ('google', 'microsoft', 'dropbox')),
        client_id TEXT NOT NULL,
        client_secret TEXT,
        updated_at INTEGER NOT NULL
      );
    `)
  }
}
