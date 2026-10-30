import { compareIsoDates, isIsoDate, isoDaysBetween } from './dates'
import { formatNumber } from './format'
import { t } from './i18n'

/**
 * Goals with numbers (N5.6a, N41): a goal's optional measure (a unit, a
 * start and a target, each with a date, and whether higher or lower is
 * better) and its check-ins, one per day. The one parser and the one
 * progress rule: the panel, Home, the Overview, the project file and the
 * automation API all read a goal's numbers through here.
 */

export type GoalMeasureDirection = 'up' | 'down'

export interface GoalMeasure {
  /** Free text, at most 20 characters: "members", "£", "km". May be empty. */
  unit: string
  startValue: number
  targetValue: number
  /** `YYYY-MM-DD`; before `targetDate`. */
  startDate: string
  targetDate: string
  /** `up` when higher is better, `down` when lower is (a backlog to cut). */
  direction: GoalMeasureDirection
}

/** One reading of a goal's number. A goal has at most one a day. */
export interface GoalCheckIn {
  goalId: string
  projectId: string
  /** `YYYY-MM-DD` */
  date: string
  value: number
  note: string
  /** When it was recorded, in ms. */
  recordedAt: number
}

/** What a person or the automation API sends to check in. */
export interface GoalCheckInInput {
  date: string
  value: number
  note?: string
}

export const MAX_MEASURE_UNIT_LENGTH = 20
export const MAX_CHECK_IN_NOTE_LENGTH = 500
/** The largest number a measure or check-in takes, either way. */
export const MAX_MEASURE_VALUE = 1e12
/** Within this share of the way from start to target counts as on pace. */
export const ON_PACE_BAND = 0.05

const DIRECTIONS: GoalMeasureDirection[] = ['up', 'down']

function fail(message: string): never {
  throw new Error(message)
}

function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_MEASURE_VALUE)
    fail(`${name} must be a number`)
  return value
}

function isoDate(value: unknown, name: string): string {
  if (!isIsoDate(value)) fail(`${name} must be a date (YYYY-MM-DD)`)
  return value
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`)
  return value as Record<string, unknown>
}

/**
 * A measure as sent, checked: the dates in order and the target on the
 * better side of the start. `direction` defaults to the way the target lies.
 * Throws an English message (the API's words) when anything is wrong.
 */
export function parseGoalMeasure(input: unknown): GoalMeasure {
  const value = object(input, 'measure')
  const unit = typeof value.unit === 'string' ? value.unit.trim() : ''
  if (value.unit !== undefined && typeof value.unit !== 'string') fail('measure.unit must be text')
  if (unit.length > MAX_MEASURE_UNIT_LENGTH)
    fail(`measure.unit must be at most ${MAX_MEASURE_UNIT_LENGTH} characters`)
  const startValue = finite(value.startValue, 'measure.startValue')
  const targetValue = finite(value.targetValue, 'measure.targetValue')
  if (startValue === targetValue) fail('measure.targetValue must differ from measure.startValue')
  const startDate = isoDate(value.startDate, 'measure.startDate')
  const targetDate = isoDate(value.targetDate, 'measure.targetDate')
  if (compareIsoDates(startDate, targetDate) >= 0)
    fail('measure.targetDate must be after measure.startDate')
  const natural: GoalMeasureDirection = targetValue > startValue ? 'up' : 'down'
  const direction = value.direction === undefined ? natural : value.direction
  if (!DIRECTIONS.includes(direction as GoalMeasureDirection))
    fail('measure.direction must be "up" or "down"')
  if (direction !== natural)
    fail(
      direction === 'up'
        ? 'measure.targetValue must be above measure.startValue when higher is better'
        : 'measure.targetValue must be below measure.startValue when lower is better'
    )
  return { unit, startValue, targetValue, startDate, targetDate, direction: natural }
}

/** A check-in as sent, checked. The note is trimmed. */
export function parseGoalCheckInInput(input: unknown): Required<GoalCheckInInput> {
  const value = object(input, 'check-in')
  const date = isoDate(value.date, 'date')
  const reading = finite(value.value, 'value')
  if (value.note !== undefined && value.note !== null && typeof value.note !== 'string')
    fail('note must be text')
  const note = typeof value.note === 'string' ? value.note.trim() : ''
  if (note.length > MAX_CHECK_IN_NOTE_LENGTH)
    fail(`note must be at most ${MAX_CHECK_IN_NOTE_LENGTH} characters`)
  return { date, value: reading, note }
}

export type GoalPace = 'ahead' | 'on-pace' | 'behind' | 'reached'

export interface GoalProgress {
  /** The latest check-in's value, or the start value without one. */
  latest: number
  /** The latest check-in's date, or null without one. */
  latestDate: string | null
  /** The share of the way from start to target, 0 to 1 (clamped). */
  share: number
  /** Where the straight line from start to target says the value should be today. */
  expected: number
  /**
   * How far the latest value is past the line, in the measure's units, on the
   * better side: positive is ahead, negative behind.
   */
  gap: number
  pace: GoalPace
}

/** Check-ins oldest first; one a day already, so the date alone orders them. */
export function sortCheckIns<T extends { date: string }>(checkIns: readonly T[]): T[] {
  return [...checkIns].sort((left, right) => compareIsoDates(left.date, right.date))
}

/** Where the straight line from start to target stands on `day`. */
export function expectedValue(measure: GoalMeasure, day: string): number {
  if (compareIsoDates(day, measure.startDate) <= 0) return measure.startValue
  if (compareIsoDates(day, measure.targetDate) >= 0) return measure.targetValue
  const span = isoDaysBetween(measure.startDate, measure.targetDate)
  const done = isoDaysBetween(measure.startDate, day)
  return measure.startValue + ((measure.targetValue - measure.startValue) * done) / span
}

/**
 * A goal's progress on `today`. Reaching the target says so, and nothing
 * more: the goal's status stays the person's to change.
 */
export function goalProgress(
  measure: GoalMeasure,
  checkIns: readonly Pick<GoalCheckIn, 'date' | 'value'>[],
  today: string
): GoalProgress {
  const last = sortCheckIns(checkIns).at(-1)
  const latest = last?.value ?? measure.startValue
  const distance = measure.targetValue - measure.startValue
  const share = Math.min(1, Math.max(0, (latest - measure.startValue) / distance))
  const expected = expectedValue(measure, today)
  const better = measure.direction === 'up' ? 1 : -1
  const gap = (latest - expected) * better
  const reached = (latest - measure.targetValue) * better >= 0
  const pace: GoalPace = reached
    ? 'reached'
    : Math.abs(gap) <= Math.abs(distance) * ON_PACE_BAND
      ? 'on-pace'
      : gap > 0
        ? 'ahead'
        : 'behind'
  return { latest, latestDate: last?.date ?? null, share, expected, gap, pace }
}

/**
 * Goals across projects (N5.6b): one goal's readings that count towards
 * another's, a project goal's towards a goal of one's own.
 */
export interface LinkedReadings {
  measure: GoalMeasure
  checkIns: readonly Pick<GoalCheckIn, 'date' | 'value'>[]
}

/** Why one goal's number cannot count towards another's. */
export type LinkMismatch = 'no-measure' | 'no-target-measure' | 'unit' | 'direction'

/** Units match when they read the same, case and spaces aside ("£" and "£", "km" and "KM"). */
export function sameUnit(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase()
}

/**
 * Whether `source`'s number can count towards `target`'s: both need a
 * measure, with the same unit and the same direction. Null when it can.
 */
export function linkMismatch(
  target: GoalMeasure | null | undefined,
  source: GoalMeasure | null | undefined
): LinkMismatch | null {
  if (!target) return 'no-target-measure'
  if (!source) return 'no-measure'
  if (!sameUnit(target.unit, source.unit)) return 'unit'
  if (target.direction !== source.direction) return 'direction'
  return null
}

/**
 * The readings of goals that count towards one, summed (N5.6b): on each day
 * any of them was checked in, the sum of each one's latest value by then (its
 * start value before its first check-in). The last is the sum of their latest
 * values, so `goalProgress` on these is the one progress rule for both kinds
 * of goal. No check-ins anywhere give no readings.
 */
export function summedCheckIns(
  linked: readonly LinkedReadings[]
): { date: string; value: number }[] {
  const sorted = linked.map((entry) => sortCheckIns(entry.checkIns))
  const dates = [...new Set(sorted.flat().map((checkIn) => checkIn.date))].sort(compareIsoDates)
  return dates.map((date) => ({
    date,
    value: linked.reduce((sum, entry, index) => {
      const last = sorted[index]
        .filter((checkIn) => compareIsoDates(checkIn.date, date) <= 0)
        .at(-1)
      return sum + (last?.value ?? entry.measure.startValue)
    }, 0)
  }))
}

/** A measure's number in the person's region, at most two decimals. */
export function formatMeasureNumber(value: number): string {
  return formatNumber(Math.round(value * 100) / 100, { maximumFractionDigits: 2 })
}

/**
 * A number with its unit: "142 members", or "£1,200" for a unit that is a
 * symbol rather than a word.
 */
export function formatMeasureValue(value: number, unit: string): string {
  const number = formatMeasureNumber(value)
  if (!unit) return number
  return /\p{L}/u.test(unit) ? `${number} ${unit}` : `${unit}${number}`
}

/** "142 of 200 members", "£1,200 of £3,000". */
export function measureAgainstTarget(latest: number, measure: GoalMeasure): string {
  const symbol = measure.unit && !/\p{L}/u.test(measure.unit)
  return t('tasks:goalMeasure.ofTarget', {
    value: symbol ? formatMeasureValue(latest, measure.unit) : formatMeasureNumber(latest),
    target: formatMeasureValue(measure.targetValue, measure.unit)
  })
}

/** "142 of 200" with no unit: Home's cards and the Overview. */
export function measureShort(latest: number, measure: GoalMeasure): string {
  return t('tasks:goalMeasure.ofTarget', {
    value: formatMeasureNumber(latest),
    target: formatMeasureNumber(measure.targetValue)
  })
}

/** Ahead or behind in words: "8 behind the line", "On pace", "Target reached". */
export function paceText(progress: GoalProgress): string {
  if (progress.pace === 'reached') return t('tasks:goalMeasure.reached')
  if (progress.pace === 'on-pace') return t('tasks:goalMeasure.onPace')
  const amount = formatMeasureNumber(Math.abs(progress.gap))
  return progress.pace === 'ahead'
    ? t('tasks:goalMeasure.ahead', { amount })
    : t('tasks:goalMeasure.behind', { amount })
}

/** The chart's accessible summary: "142 of 200 members, 8 behind the line". */
export function measureSummary(progress: GoalProgress, measure: GoalMeasure): string {
  const value = measureAgainstTarget(progress.latest, measure)
  const amount = formatMeasureNumber(Math.abs(progress.gap))
  switch (progress.pace) {
    case 'reached':
      return t('tasks:goalMeasure.summaryReached', { value })
    case 'on-pace':
      return t('tasks:goalMeasure.summaryOnPace', { value })
    case 'ahead':
      return t('tasks:goalMeasure.summaryAhead', { value, amount })
    case 'behind':
      return t('tasks:goalMeasure.summaryBehind', { value, amount })
  }
}

/**
 * A typed number in the person's region: "1,5" where a comma is the decimal
 * separator. Group separators (spaces, the other mark) are ignored. Null
 * when it is not a number.
 */
export function parseMeasureNumber(text: string, separator: string): number | null {
  const group = separator === ',' ? /[.\s\u00a0\u202f']/g : /[,\s\u00a0\u202f']/g
  const cleaned = text.trim().replace(group, '').replace(separator, '.')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) && Math.abs(value) <= MAX_MEASURE_VALUE ? value : null
}

/** A number as typed back into a field in the person's region (no group separators). */
export function measureInputText(value: number, separator: string): string {
  return String(value).replace('.', separator)
}

/** An active goal's number at a glance, for Home's project cards. */
export interface GoalGlance {
  goalId: string
  projectId: string
  title: string
  measure: GoalMeasure
  progress: GoalProgress
}
