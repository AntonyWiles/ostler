import type { Migration } from './types'

/**
 * N1.1a, Show-from dates and Someday (N9).
 *
 * `show_from` is the first day a task may be acted on, `YYYY-MM-DD` or null:
 * until then it leaves Today, Upcoming, My work, the Board and the List.
 * `someday` (0 or 1) parks a task for one day, maybe; it is a flag, not a
 * status. Neither changes reminders.
 */
export const showFromAndSomeday: Migration = {
  version: 20,
  name: 'show-from-and-someday',
  up(db) {
    db.exec(`
      ALTER TABLE planning_work_items ADD COLUMN show_from TEXT;
      ALTER TABLE planning_work_items ADD COLUMN someday INTEGER NOT NULL DEFAULT 0;
    `)
  }
}
