/**
 * Date words for DateField and cards. Dates are stored as `YYYY-MM-DD` in
 * local time; times and time zones never enter into it (`@shared/dates`).
 * The words and formats follow the active language (P11.1).
 */

import { formatDateTime, formatRelativeTime } from '@shared/format'

// The calendar-date helpers live in one module for main and the renderer.
export { addDays, daysFromToday, parseIsoDate, relativeDateText, toIsoDate } from '@shared/dates'

/**
 * When something happened, in words for the near term ("just now", "5
 * minutes ago", "yesterday", "3 days ago") and as a date beyond a week.
 */
export function relativeTimeText(at: number, now: number = Date.now()): string {
  return formatRelativeTime(at, now)
}

/** The exact moment, for a tooltip: "8 Oct 2026, 14:05". */
export function absoluteTimeText(at: number): string {
  return formatDateTime(at)
}
