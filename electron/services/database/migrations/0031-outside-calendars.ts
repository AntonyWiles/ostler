import type { Migration } from './types'

/**
 * N3.3a, calendar files beside tasks (N26): outside calendars, read from an
 * `.ics` file the person chose (`kind` is 'file'; N3.3b may add links), and
 * their events as the file gives them. Repeats are kept as their rule and
 * expanded when read. `time_zones` holds the file's own VTIMEZONEs as JSON,
 * for Windows zone names. `removed_at` marks a calendar removed with undo;
 * removed calendars are cleared for good at the next start.
 *
 * An event's `start_at` and `end_at` are wall times in `time_zone`
 * (`YYYY-MM-DDTHH:mm:ss`), or dates for an all-day event. `first_date` and
 * `last_date` bound the days it can touch (a day either side for time zones;
 * `last_date` null for a repeat with no end), so a range is one query.
 * Calendars are shared by every project, as people and days off are, so
 * there is no `project_id`; events never enter search or the project file.
 */
export const outsideCalendars: Migration = {
  version: 31,
  name: 'outside-calendars',
  up(db) {
    db.exec(`
      CREATE TABLE outside_calendars (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'file',
        path TEXT,
        hidden INTEGER NOT NULL DEFAULT 0,
        loaded_at INTEGER NOT NULL,
        read_count INTEGER NOT NULL DEFAULT 0,
        skipped_count INTEGER NOT NULL DEFAULT 0,
        shown_once_count INTEGER NOT NULL DEFAULT 0,
        time_zones TEXT NOT NULL DEFAULT '[]',
        removed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE outside_calendar_events (
        id TEXT PRIMARY KEY,
        calendar_id TEXT NOT NULL REFERENCES outside_calendars(id) ON DELETE CASCADE,
        uid TEXT,
        recurrence_id TEXT,
        title TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        all_day INTEGER NOT NULL DEFAULT 0,
        time_zone TEXT,
        rrule TEXT,
        exdates TEXT NOT NULL DEFAULT '[]',
        cancelled INTEGER NOT NULL DEFAULT 0,
        first_date TEXT NOT NULL,
        last_date TEXT
      );
      CREATE INDEX idx_outside_calendar_events_range
        ON outside_calendar_events(calendar_id, first_date, last_date);
      CREATE INDEX idx_outside_calendar_events_overrides
        ON outside_calendar_events(calendar_id) WHERE recurrence_id IS NOT NULL;
    `)
  }
}
