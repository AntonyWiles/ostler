import type { Migration } from './types'

/**
 * N3.2, holidays and days off (N25): days nobody works (a bank holiday,
 * `person_id` null) and days one person is away (leave). A day off covers
 * `first_date` to `last_date`, both `YYYY-MM-DD` local calendar dates (a
 * single day has both the same). `source_file` names the calendar file it was
 * imported from, or is null when it was added by hand; loading the same file
 * again replaces the days that came from it. Days off are shared by every
 * project, as people are, so there is no `project_id`; archiving a person
 * keeps theirs.
 */
export const daysOff: Migration = {
  version: 30,
  name: 'days-off',
  up(db) {
    db.exec(`
      CREATE TABLE days_off (
        id TEXT PRIMARY KEY,
        person_id TEXT,
        first_date TEXT NOT NULL,
        last_date TEXT NOT NULL,
        name TEXT NOT NULL,
        source_file TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_days_off_dates ON days_off(first_date, last_date);
      CREATE INDEX idx_days_off_source ON days_off(source_file) WHERE source_file IS NOT NULL;
    `)
  }
}
