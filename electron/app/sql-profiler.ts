import Database from 'better-sqlite3'
import * as fs from 'fs'
import { join } from 'path'

/**
 * Development-only SQL profiler, for finding the slow queries (P9.1).
 *
 * Off unless the main process starts with `OSTLER_PROFILE_SQL=1`. When on,
 * every statement any service prepares is timed, and `writeSqlProfile` (on
 * quit) writes the statements by total time to `<dataDir>/logs/sql-profile.json`.
 * `docs/performance.md` says how the slow ones were checked with
 * `EXPLAIN QUERY PLAN`. It never runs in a normal launch.
 */
const enabled = process.env.OSTLER_PROFILE_SQL === '1'

interface Timing {
  count: number
  totalMs: number
  maxMs: number
}

const timings = new Map<string, Timing>()

function time<T>(sql: string, run: () => T): T {
  const started = performance.now()
  try {
    return run()
  } finally {
    const elapsed = performance.now() - started
    const entry = timings.get(sql) ?? { count: 0, totalMs: 0, maxMs: 0 }
    entry.count += 1
    entry.totalMs += elapsed
    entry.maxMs = Math.max(entry.maxMs, elapsed)
    timings.set(sql, entry)
  }
}

export function installSqlProfiler(): void {
  if (!enabled) return
  const prototype = Database.prototype as unknown as {
    prepare(this: Database.Database, sql: string): Database.Statement
  }
  const prepare = prototype.prepare
  prototype.prepare = function (this: Database.Database, sql: string) {
    const statement = prepare.call(this, sql)
    const text = sql.replace(/\s+/g, ' ').trim()
    for (const method of ['all', 'get', 'run'] as const) {
      const original = statement[method] as (...args: unknown[]) => unknown
      ;(statement as unknown as Record<string, unknown>)[method] = (...args: unknown[]) =>
        time(text, () => original.apply(statement, args))
    }
    return statement
  }
}

export function writeSqlProfile(dataDir: string): void {
  if (!enabled) return
  const rows = [...timings.entries()]
    .map(([sql, timing]) => ({ sql, ...timing, avgMs: timing.totalMs / timing.count }))
    .sort((left, right) => right.totalMs - left.totalMs)
  fs.mkdirSync(join(dataDir, 'logs'), { recursive: true })
  fs.writeFileSync(join(dataDir, 'logs', 'sql-profile.json'), `${JSON.stringify(rows, null, 2)}\n`)
}
