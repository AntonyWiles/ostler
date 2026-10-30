import type { Migration } from './types'

/**
 * N2.3, take turns (N18): a repeat may hand each new occurrence to the next
 * person in a list. `rotation` is a JSON array of person ids in order, or
 * null; `next_index` is whose turn is next. Both move with the repeat to
 * each new occurrence.
 */
export const takeTurns: Migration = {
  version: 28,
  name: 'take-turns',
  up(db) {
    db.exec(`
      ALTER TABLE planning_recurrences ADD COLUMN rotation TEXT;
      ALTER TABLE planning_recurrences ADD COLUMN next_index INTEGER NOT NULL DEFAULT 0;
    `)
  }
}
