import type { Migration } from './types'

/**
 * N7.2a, dependency types and lag (N50): a waits-on link reads its two tasks'
 * dates as finish to start, start to start or finish to finish, with a lag in
 * calendar days from -365 to 365. Every link made before is finish to start
 * with no lag, the only kind there was.
 */
export const dependencyTypes: Migration = {
  version: 52,
  name: 'dependency-types',
  up(db) {
    db.exec(`
      ALTER TABLE planning_dependencies ADD COLUMN type TEXT NOT NULL DEFAULT 'finish-to-start'
        CHECK (type IN ('finish-to-start', 'start-to-start', 'finish-to-finish'));
      ALTER TABLE planning_dependencies ADD COLUMN lag_days INTEGER NOT NULL DEFAULT 0
        CHECK (lag_days BETWEEN -365 AND 365);
    `)
  }
}
