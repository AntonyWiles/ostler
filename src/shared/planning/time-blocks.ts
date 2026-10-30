import type { EstimateUnit, WorkingHours } from '../ostler-api'
import { wallToUtc } from '../calendar/ics-time'
import { parseIsoDate } from '../dates'

/*
 * Time blocks (N3.4a, decision N28): the pure rules every surface shares.
 * A block is a local date with a wall-clock start and length in minutes,
 * on a quarter-hour grid, never running past midnight.
 */

export const MINUTES_PER_DAY = 24 * 60
/** Blocks snap to quarter hours. */
export const BLOCK_STEP_MINUTES = 15
/** A block with no estimate to go by lasts an hour. */
export const DEFAULT_BLOCK_MINUTES = 60
/** The most blocks one task may hold. */
export const MAX_BLOCKS_PER_TASK = 200
/** The longest range one query may ask for, in days. */
export const MAX_BLOCK_RANGE_DAYS = 400

/** A minute of the day rounded to the nearest quarter hour, kept inside the day. */
export function snapMinute(minute: number): number {
  const snapped = Math.round(minute / BLOCK_STEP_MINUTES) * BLOCK_STEP_MINUTES
  return Math.min(MINUTES_PER_DAY - BLOCK_STEP_MINUTES, Math.max(0, snapped))
}

/** A length cut at midnight, at least a quarter hour. */
export function cutAtMidnight(startMinute: number, lengthMinutes: number): number {
  return Math.max(BLOCK_STEP_MINUTES, Math.min(lengthMinutes, MINUTES_PER_DAY - startMinute))
}

/**
 * A new block's length: the task's estimate in hours, rounded to a quarter
 * hour; an hour in a points project or with no estimate. Cut at midnight.
 */
export function defaultBlockLength(
  estimate: number | null | undefined,
  unit: EstimateUnit,
  startMinute: number
): number {
  const minutes =
    unit === 'hours' && typeof estimate === 'number' && estimate > 0
      ? Math.max(
          BLOCK_STEP_MINUTES,
          Math.round((estimate * 60) / BLOCK_STEP_MINUTES) * BLOCK_STEP_MINUTES
        )
      : DEFAULT_BLOCK_MINUTES
  return cutAtMidnight(startMinute, minutes)
}

/** Whether a start is a quarter hour inside the day. */
export function isBlockStart(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) < MINUTES_PER_DAY &&
    (value as number) % BLOCK_STEP_MINUTES === 0
  )
}

/** Whether a length is whole quarter hours that ends by midnight. */
export function isBlockLength(value: unknown, startMinute: number): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= BLOCK_STEP_MINUTES &&
    (value as number) % BLOCK_STEP_MINUTES === 0 &&
    startMinute + (value as number) <= MINUTES_PER_DAY
  )
}

/** Minutes after midnight as `HH:mm`; 1440 is `24:00`. */
export function clockTime(minute: number): string {
  const hours = Math.floor(minute / 60)
  const minutes = minute % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** `HH:mm` (or `H:mm`) as minutes after midnight, or null. */
export function parseClockTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * A block's start and end as instants, from its wall-clock time in `timeZone`
 * at the moment of asking (for the calendar file). A start that a clock
 * change skips moves forward with the change.
 */
export function blockInstants(
  date: string,
  startMinute: number,
  lengthMinutes: number,
  timeZone: string
): { start: number; end: number } {
  const day = parseIsoDate(date)
  if (!day) throw new Error(`Not a date: ${date}`)
  const midnight = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())
  const context = { zones: new Map(), local: timeZone }
  const start = wallToUtc(midnight + startMinute * 60_000, timeZone, context)
  const end = wallToUtc(midnight + (startMinute + lengthMinutes) * 60_000, timeZone, context)
  return { start, end }
}

export const DEFAULT_WORKING_HOURS: WorkingHours = { start: '09:00', end: '17:00' }

/** Working hours as minutes, falling back to the default when unreadable or empty. */
export function workingMinutes(hours: unknown): { start: number; end: number } {
  const value = normalizeWorkingHours(hours)
  return { start: parseClockTime(value.start)!, end: parseClockTime(value.end)! }
}

/**
 * Working hours as saved: two `HH:mm` times, the end after the start; else
 * the default, 09:00 to 17:00. Config migration 26 and every update use it.
 */
export function normalizeWorkingHours(value: unknown): WorkingHours {
  if (!value || typeof value !== 'object') return { ...DEFAULT_WORKING_HOURS }
  const raw = value as Record<string, unknown>
  const start = typeof raw.start === 'string' ? parseClockTime(raw.start) : null
  const end = typeof raw.end === 'string' ? parseClockTime(raw.end) : null
  if (start === null || end === null || end <= start) return { ...DEFAULT_WORKING_HOURS }
  return { start: clockTime(start), end: clockTime(end) }
}
