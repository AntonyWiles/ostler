import type { Migration } from './types'

/**
 * Calendars from connected accounts (docs/plans/integrations/overview.md,
 * phase 1): an outside calendar may be of kind 'account', read from a
 * connected account on the same schedule as a link. `account_id` is the
 * `connected_accounts` row; `account_calendar` is the provider's id for the
 * calendar (a CalDAV calendar's address), main only. Removing the account
 * leaves the calendar with its last events, marked to sign in again.
 */
export const accountCalendars: Migration = {
  version: 64,
  name: 'account-calendars',
  up(db) {
    db.exec(`
      ALTER TABLE outside_calendars ADD COLUMN account_id TEXT;
      ALTER TABLE outside_calendars ADD COLUMN account_calendar TEXT;
    `)
  }
}
