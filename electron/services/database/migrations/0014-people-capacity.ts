import type { Migration } from './types'

/**
 * R3.2, workload (D36): each person's optional weekly capacity in hours
 * (NULL when not set) and working days, a bit mask with Monday as bit 0 to
 * Sunday as bit 6. 31 is Monday to Friday, the default.
 */
export const peopleCapacity: Migration = {
  version: 14,
  name: 'people-capacity',
  up(db) {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(people)').all() as { name: string }[]).map((c) => c.name)
    )
    if (!columns.has('weekly_capacity_hours')) {
      db.exec('ALTER TABLE people ADD COLUMN weekly_capacity_hours REAL')
    }
    if (!columns.has('working_days')) {
      db.exec('ALTER TABLE people ADD COLUMN working_days INTEGER NOT NULL DEFAULT 31')
    }
  }
}
