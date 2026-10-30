import { isoDaysBetween, shiftIsoDate } from './dates'

/**
 * A demo project's history (time entries, billings, status updates, check-ins,
 * a baseline) is dated around a fixed day, its anchor, because those dates
 * have no relative form. Opened on another day, every calendar date and
 * timestamp in it moves by the same number of days, so the demo always reads
 * as if its anchor were today. Relative dates (`+3d`) are left alone: they
 * already count from today.
 */

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

function shift(value: unknown, days: number): unknown {
  if (typeof value === 'string') {
    if (CALENDAR_DAY.test(value)) return shiftIsoDate(value, days)
    if (TIMESTAMP.test(value)) return new Date(Date.parse(value) + days * 86_400_000).toISOString()
    return value
  }
  if (Array.isArray(value)) return value.map((entry) => shift(entry, days))
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        shift(entry, days)
      ])
    )
  return value
}

/** `pkg` with every absolute date moved from `anchor` to `today`. */
export function shiftDemoDates<T>(pkg: T, anchor: string, today: string): T {
  const days = isoDaysBetween(anchor, today)
  return days === 0 ? pkg : (shift(pkg, days) as T)
}
