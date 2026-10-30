import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import type { BackupManifest } from '@shared/ostler-api'
import type { Migration } from './types'
import { backupTimestamp } from '../backup-timestamp'
import { LATEST_SCHEMA_VERSION, MIGRATIONS } from './list'

export type { Migration } from './types'
export { backupTimestamp } from '../backup-timestamp'
export { LATEST_SCHEMA_VERSION, MIGRATIONS }

export interface MigrationResult {
  from: number
  to: number
  /** The pre-migration copy, or null when nothing was pending or the file was new. */
  backupPath: string | null
}

export interface MigrateOptions {
  backupDir: string
  appVersion: string
}

/** The file was written by a newer build; this one must not open it. */
export class DatabaseTooNewError extends Error {
  constructor(
    readonly fileVersion: number,
    readonly knownVersion: number
  ) {
    super(
      `ostler.db is at schema version ${fileVersion}, newer than this build knows (${knownVersion}).`
    )
    this.name = 'DatabaseTooNewError'
  }
}

/** The pre-migration backup could not be written, so nothing was migrated. */
export class MigrationBackupError extends Error {
  constructor(readonly cause: unknown) {
    super(
      `Could not back up ostler.db before updating it: ${cause instanceof Error ? cause.message : String(cause)}`
    )
    this.name = 'MigrationBackupError'
  }
}

export function readSchemaVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number
}

/**
 * Brings `ostler.db` up to `LATEST_SCHEMA_VERSION`. Runs at start-up before any
 * service opens the file.
 *
 * - A file newer than this build is refused with `DatabaseTooNewError`, and
 *   nothing is written to it.
 * - When migrations are pending and the file already held tables, a copy is
 *   written first to `<backupDir>/pre-migration-v<from>-v<to>-<timestamp>/`.
 *   If that fails, nothing is migrated.
 * - Each migration runs in its own transaction, which also sets
 *   `user_version`, so a failure leaves the version and data as they were.
 */
export async function migrateOstlerDatabase(
  dbPath: string,
  options: MigrateOptions,
  migrations: readonly Migration[] = MIGRATIONS
): Promise<MigrationResult> {
  const latest = migrations.length > 0 ? migrations[migrations.length - 1].version : 0

  if (fs.existsSync(dbPath)) {
    // Read-only first, so a too-new file is not touched at all (not even WAL mode).
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const version = readSchemaVersion(probe)
      if (version > latest) throw new DatabaseTooNewError(version, latest)
    } finally {
      probe.close()
    }
  }

  const db = new Database(dbPath)
  try {
    const from = readSchemaVersion(db)
    const pending = migrations.filter((migration) => migration.version > from)
    if (pending.length === 0) return { from, to: from, backupPath: null }

    let backupPath: string | null = null
    const heldData =
      (
        db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get() as {
          count: number
        }
      ).count > 0
    if (heldData) {
      try {
        backupPath = await writePreMigrationBackup(db, from, latest, options)
      } catch (error) {
        throw new MigrationBackupError(error)
      }
    }

    db.pragma('journal_mode = WAL')
    for (const migration of pending) {
      db.transaction(() => {
        migration.up(db)
        db.pragma(`user_version = ${migration.version}`)
      })()
    }
    return { from, to: latest, backupPath }
  } finally {
    db.close()
  }
}

async function writePreMigrationBackup(
  db: Database.Database,
  from: number,
  to: number,
  options: MigrateOptions
): Promise<string> {
  const createdAt = Date.now()
  const id = `pre-migration-v${from}-v${to}-${backupTimestamp(new Date(createdAt))}`
  const folder = path.join(options.backupDir, id)
  fs.mkdirSync(folder, { recursive: true })
  const target = path.join(folder, 'ostler.db')
  await db.backup(target)
  // The same manifest shape a full backup has, so Settings can list it.
  const manifest: BackupManifest = {
    format: 'ostler-backup',
    formatVersion: 1,
    appVersion: options.appVersion,
    schemaVersion: from,
    configVersion: null,
    reason: 'pre-migration',
    createdAt,
    bytes: { database: fs.statSync(target).size, config: 0, library: 0, ai: 0 },
    excludes: ['config.json', 'library/', 'ai/', 'harness/']
  }
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  return target
}
