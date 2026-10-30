import type Database from 'better-sqlite3'

/**
 * One numbered schema change to `ostler.db`. `up` runs inside a transaction the
 * runner opens, which also records `version` in `PRAGMA user_version`, so a
 * migration that throws leaves the file exactly as it found it.
 *
 * Forward only: a migration that has shipped is never edited. Fix it with a
 * new one.
 */
export interface Migration {
  version: number
  name: string
  up(db: Database.Database): void
}
