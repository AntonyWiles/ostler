import type { Migration } from './types'

/**
 * N3.3b, subscribed calendars (N27, A): an outside calendar may be of kind
 * 'link', a private calendar address Ostler fetches on a schedule.
 * `link_secret` is the address encrypted with safeStorage (`encryptApiKey`),
 * never plain text; it is null for a file calendar. `link_shown` is the
 * shortened form Settings shows (its host and last path part,
 * "outlook.office365.com/…/calendar.ics"), which leaves out the secret
 * middle of the address, so the list never needs to decrypt. `etag` and
 * `last_modified` come from the last fetch, for conditional requests.
 * `fetched_at` is when a fetch last succeeded (a 304 counts), `failed_at`
 * and `failure` when and why the last try failed (a reason code the app
 * shows in plain words; never the address, never raw error text), cleared
 * by the next success.
 */
export const calendarLinks: Migration = {
  version: 47,
  name: 'calendar-links',
  up(db) {
    db.exec(`
      ALTER TABLE outside_calendars ADD COLUMN link_secret TEXT;
      ALTER TABLE outside_calendars ADD COLUMN link_shown TEXT;
      ALTER TABLE outside_calendars ADD COLUMN etag TEXT;
      ALTER TABLE outside_calendars ADD COLUMN last_modified TEXT;
      ALTER TABLE outside_calendars ADD COLUMN fetched_at INTEGER;
      ALTER TABLE outside_calendars ADD COLUMN failed_at INTEGER;
      ALTER TABLE outside_calendars ADD COLUMN failure TEXT;
    `)
  }
}
