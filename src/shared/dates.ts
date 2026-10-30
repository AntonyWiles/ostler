/**
 * Calendar dates (`YYYY-MM-DD`): a due date is a day, not an instant. The one
 * place they are parsed and compared, in
 * main and the renderer alike. A date string never goes through
 * `new Date(value)`, which reads it as UTC midnight and shifts the day east
 * or west of Greenwich; it is built from its parts in local time instead, or
 * compared as text.
 */

import { dateTimeFormat, formatShortDate } from './format'
import { t } from './i18n'

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `YYYY-MM-DD` for a local date. */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Parses `YYYY-MM-DD` as a local date, or null when it is not a real day. */
export function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return toIsoDate(date) === value ? date : null
}

/** Whether `value` is a real calendar day written as `YYYY-MM-DD`. */
export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && parseIsoDate(value) !== null
}

/**
 * Orders two calendar dates: negative when `a` is earlier. `YYYY-MM-DD`
 * sorts as text, so no time zone can move either day.
 */
export function compareIsoDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The local date `days` after `from`. */
export function addDays(from: Date, days: number): Date {
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  next.setDate(next.getDate() + days)
  return next
}

/** Whole days from `today` to `value` (negative when it has passed). */
export function daysFromToday(value: string, today: Date = new Date()): number | null {
  const date = parseIsoDate(value)
  if (!date) return null
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((date.getTime() - start.getTime()) / 86_400_000)
}

/**
 * Day arithmetic on `YYYY-MM-DD` strings, independent of the local time zone:
 * the day is read as a UTC calendar day, moved, and written back, so no
 * daylight-saving change or offset can add or lose a day (the calendar's
 * moves, P5.4). Null when `value` is not a real day.
 */
function utcDay(value: string): number | null {
  if (!isIsoDate(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function fromUtcDay(time: number): string {
  const date = new Date(time)
  const y = String(date.getUTCFullYear()).padStart(4, '0')
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** The day `days` after `value` (before it when negative). Throws on a bad date. */
export function shiftIsoDate(value: string, days: number): string {
  const time = utcDay(value)
  if (time === null) throw new Error(`Not a calendar date: ${value}`)
  return fromUtcDay(time + days * 86_400_000)
}

/** Whole days from `from` to `to`: positive when `to` is later. */
export function isoDaysBetween(from: string, to: string): number {
  const a = utcDay(from)
  const b = utcDay(to)
  if (a === null || b === null) throw new Error(`Not a calendar date: ${a === null ? from : to}`)
  return Math.round((b - a) / 86_400_000)
}

/** The weekday of a day: 0 for Sunday to 6 for Saturday. */
export function isoWeekday(value: string): number {
  const time = utcDay(value)
  if (time === null) throw new Error(`Not a calendar date: ${value}`)
  return new Date(time).getUTCDay()
}

/** Today's date where the user is, as `YYYY-MM-DD`. */
export function todayIsoDate(now: Date = new Date()): string {
  return toIsoDate(now)
}

/**
 * A calendar date in the active locale (P11.1): "8 Oct 2026" by default. The
 * day is built from its parts in local time, so it never shifts. Returns
 * `value` unchanged when it is not a real day.
 */
export function formatIsoDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
): string {
  const date = parseIsoDate(value)
  return date ? dateTimeFormat(options).format(date) : value
}

/** A calendar date without the year when it is this year: "8 Oct", or "8 Oct 2025". */
export function formatIsoDateShort(value: string, today: Date = new Date()): string {
  const date = parseIsoDate(value)
  if (!date) return value
  return formatShortDate(date, today)
}

/**
 * A date relative to today in words: "Today", "Tomorrow", "In 3 days",
 * "Overdue by 2 days" (for due dates) or "2 days ago". Empty beyond a week
 * ahead, where the date itself says enough.
 */
export function relativeDateText(
  value: string,
  { today = new Date(), due = true }: { today?: Date; due?: boolean } = {}
): string {
  const days = daysFromToday(value, today)
  if (days === null) return ''
  if (days === 0) return t('common:date.today')
  if (days === 1) return t('common:date.tomorrow')
  if (days === -1 && !due) return t('common:date.yesterday')
  if (days < 0) return t(due ? 'common:date.overdueBy' : 'common:date.daysAgo', { count: -days })
  if (days <= 7) return t('common:date.inDays', { count: days })
  return ''
}
