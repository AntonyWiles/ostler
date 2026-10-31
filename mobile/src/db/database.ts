/**
 * A synchronous, better-sqlite3-shaped adapter over op-sqlite, with just the calls that the
 * migrations and the sync engine's core files make (`prepare().run/get/all`, `exec`,
 * `transaction`, `pragma`). Plus `migrate`, which runs the desktop's own migrations.
 *
 * The phone never defines tables of its own in ostler.db: the schema is whatever
 * `MIGRATIONS` says.
 */
import { open, type DB } from '@op-engineering/op-sqlite'
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS
} from '../../../electron/services/database/migrations/list'
import {
  pragmaSql,
  simplePragmaValue,
  toPositional,
  transactionSql,
  type BindArgs
} from './sql-helpers'

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

export interface Statement {
  run(...args: BindArgs): RunResult
  get(...args: BindArgs): unknown
  all(...args: BindArgs): unknown[]
}

export interface OstlerDatabase {
  prepare(sql: string): Statement
  exec(sql: string): void
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R
  pragma(text: string, options?: { simple?: boolean }): unknown
  /** Registering SQL functions needs the native module; the engine's capture step (prompt 09) will. */
  function(name: string, ...rest: unknown[]): never
  close(): void
}

/** The file name the phone's database is stored under (the same name as on the desktop). */
export const DATABASE_NAME = 'ostler.db'

export function wrapDatabase(raw: DB): OstlerDatabase {
  let depth = 0

  const database: OstlerDatabase = {
    prepare(sql) {
      return {
        run(...args) {
          const query = toPositional(sql, args)
          const result = raw.executeSync(query.sql, query.params)
          return { changes: result.rowsAffected, lastInsertRowid: result.insertId ?? 0 }
        },
        get(...args) {
          const query = toPositional(sql, args)
          return raw.executeSync(query.sql, query.params).rows[0]
        },
        all(...args) {
          const query = toPositional(sql, args)
          return raw.executeSync(query.sql, query.params).rows
        }
      }
    },
    exec(sql) {
      // op-sqlite runs every statement of a multi-statement string.
      raw.executeSync(sql)
    },
    transaction(fn) {
      return (...args) => {
        const statements = transactionSql(depth)
        raw.executeSync(statements.begin)
        depth += 1
        try {
          const result = fn(...args)
          // COMMIT can throw too (a deferred foreign key check fails there). The transaction is
          // still open then, so it goes through the same rollback as a failure inside fn.
          raw.executeSync(statements.commit)
          return result
        } catch (error) {
          try {
            raw.executeSync(statements.rollback)
          } catch {
            // Nothing left to roll back; the original error is the one worth reporting.
          }
          throw error
        } finally {
          depth -= 1
        }
      }
    },
    pragma(text, options) {
      const call = pragmaSql(text)
      const rows = raw.executeSync(call.sql).rows
      return options?.simple ? simplePragmaValue(rows) : rows
    },
    function() {
      throw new Error('User-defined SQL functions are not available on the phone yet.')
    },
    close() {
      raw.close()
    }
  }
  return database
}

/** Opens (creating if needed) the phone's database file. */
export function openDatabase(name: string = DATABASE_NAME): OstlerDatabase {
  return wrapDatabase(open({ name }))
}

export function readSchemaVersion(db: OstlerDatabase): number {
  return db.pragma('user_version', { simple: true }) as number
}

/** The desktop `Migration.up` takes a better-sqlite3 database; the adapter has the calls it uses. */
type MigrationTarget = Parameters<(typeof MIGRATIONS)[number]['up']>[0]

/**
 * Brings the file up to `LATEST_SCHEMA_VERSION` with the desktop's own migrations: each newer
 * one runs in its own transaction that also sets `user_version`, like the desktop runner.
 * A file newer than this build is refused untouched.
 */
export function migrate(db: OstlerDatabase): { from: number; to: number } {
  const from = readSchemaVersion(db)
  if (from > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `ostler.db is at schema version ${from}, newer than this build knows (${LATEST_SCHEMA_VERSION}).`
    )
  }
  const pending = MIGRATIONS.filter((migration) => migration.version > from)
  if (pending.length === 0) return { from, to: from }
  db.pragma('journal_mode = WAL')
  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db as unknown as MigrationTarget)
      db.pragma(`user_version = ${migration.version}`)
    })()
  }
  return { from, to: LATEST_SCHEMA_VERSION }
}

export { LATEST_SCHEMA_VERSION }
