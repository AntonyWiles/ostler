/*
 * Repeating calendar events (N3.3a): the part of iCalendar's RRULE (RFC 5545
 * §3.3.10) that Outlook, Google and Apple write. FREQ of DAILY, WEEKLY,
 * MONTHLY or YEARLY with INTERVAL, COUNT, UNTIL, BYDAY (with ordinals such as
 * 2TU or -1FR), BYMONTHDAY, BYMONTH, BYSETPOS and WKST. A rule with anything
 * else is not read (`parseRRule` returns null) and its event is shown once.
 *
 * Times here are "wall" milliseconds: a date and time of day as written,
 * counted as if it were UTC, so day arithmetic never meets a time-zone
 * change. `ics-time.ts` turns a wall time in a zone into an instant. Pure.
 */

export const DAY_MS = 86_400_000

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export interface ByDay {
  /** 0 Sunday … 6 Saturday. */
  weekday: number
  /** 2 for "2TU", -1 for "-1FR", null for every one. */
  ordinal: number | null
}

export interface RRule {
  freq: Frequency
  interval: number
  count: number | null
  /** The last start allowed, as wall time; `untilUtc` says it was written in UTC. */
  until: number | null
  untilUtc: boolean
  byDay: ByDay[]
  byMonthDay: number[]
  byMonth: number[]
  bySetPos: number[]
  /** The week's first day, 0 Sunday … 6 Saturday (Monday by default). */
  weekStart: number
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const SUPPORTED = new Set([
  'FREQ',
  'INTERVAL',
  'COUNT',
  'UNTIL',
  'BYDAY',
  'BYMONTHDAY',
  'BYMONTH',
  'BYSETPOS',
  'WKST'
])
/** The most occurrences one COUNT may ask for. */
const MAX_COUNT = 10_000
/** How many periods a rule is followed before giving up (a rule that never matches). */
const MAX_PERIODS = 50_000

/** `20261016`, `20261016T093000` or `20261016T093000Z` as wall milliseconds, or null. */
export function parseWall(value: string): { wall: number; utc: boolean; dateOnly: boolean } | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim())
  if (!match) return null
  const [, y, mo, d, h, mi, s, z] = match
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const wall = Date.UTC(year, month - 1, day, Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0))
  const check = new Date(wall)
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    return null
  if (h !== undefined && (Number(h) > 23 || Number(mi) > 59 || Number(s ?? 0) > 60)) return null
  return { wall, utc: z === 'Z', dateOnly: h === undefined }
}

function integers(
  value: string,
  min: number,
  max: number,
  allowNegative: boolean
): number[] | null {
  const list: number[] = []
  for (const part of value.split(',')) {
    const number = Number(part.trim())
    if (!Number.isInteger(number)) return null
    const size = Math.abs(number)
    if (size < min || size > max || (number < 0 && !allowNegative)) return null
    list.push(number)
  }
  return list
}

/** A rule this reader follows, or null for one it does not (shown once). */
export function parseRRule(value: string): RRule | null {
  const parts = new Map<string, string>()
  for (const part of value.split(';')) {
    if (!part.trim()) continue
    const equals = part.indexOf('=')
    if (equals <= 0) return null
    const key = part.slice(0, equals).trim().toUpperCase()
    if (!SUPPORTED.has(key) || parts.has(key)) return null
    parts.set(
      key,
      part
        .slice(equals + 1)
        .trim()
        .toUpperCase()
    )
  }
  const freq = parts.get('FREQ') as Frequency | undefined
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null
  const interval = parts.has('INTERVAL') ? Number(parts.get('INTERVAL')) : 1
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return null
  const count = parts.has('COUNT') ? Number(parts.get('COUNT')) : null
  if (count !== null && (!Number.isInteger(count) || count < 1)) return null
  let until: number | null = null
  let untilUtc = false
  if (parts.has('UNTIL')) {
    const parsed = parseWall(parts.get('UNTIL')!)
    if (!parsed) return null
    // A date-only UNTIL includes that whole day.
    until = parsed.dateOnly ? parsed.wall + DAY_MS - 1 : parsed.wall
    untilUtc = parsed.utc
  }
  const byDay: ByDay[] = []
  if (parts.has('BYDAY')) {
    for (const part of parts.get('BYDAY')!.split(',')) {
      const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(part.trim())
      if (!match) return null
      const ordinal = match[1] ? Number(match[1]) : null
      if (ordinal !== null && (ordinal === 0 || Math.abs(ordinal) > 53)) return null
      byDay.push({ weekday: WEEKDAYS.indexOf(match[2]), ordinal })
    }
  }
  const byMonthDay = parts.has('BYMONTHDAY') ? integers(parts.get('BYMONTHDAY')!, 1, 31, true) : []
  const byMonth = parts.has('BYMONTH') ? integers(parts.get('BYMONTH')!, 1, 12, false) : []
  const bySetPos = parts.has('BYSETPOS') ? integers(parts.get('BYSETPOS')!, 1, 366, true) : []
  if (!byMonthDay || !byMonth || !bySetPos) return null
  const weekStart = parts.has('WKST') ? WEEKDAYS.indexOf(parts.get('WKST')!) : 1
  if (weekStart < 0) return null
  return {
    freq,
    interval,
    count: count === null ? null : Math.min(count, MAX_COUNT),
    until,
    untilUtc,
    byDay,
    byMonthDay,
    byMonth,
    bySetPos,
    weekStart
  }
}

/** Day number (days since 1970-01-01) to its weekday, 0 Sunday. */
function weekdayOf(day: number): number {
  return (((day + 4) % 7) + 7) % 7
}

function dayOf(year: number, month: number, date: number): number {
  return Math.floor(Date.UTC(year, month - 1, date) / DAY_MS)
}

function monthLength(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function partsOf(day: number): { year: number; month: number; date: number } {
  const value = new Date(day * DAY_MS)
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, date: value.getUTCDate() }
}

/** Days of `first`..`last` (inclusive) on a weekday, with an ordinal counted within that span. */
function weekdaysIn(first: number, last: number, byDay: ByDay): number[] {
  const all: number[] = []
  let day = first + ((byDay.weekday - weekdayOf(first) + 7) % 7)
  for (; day <= last; day += 7) all.push(day)
  if (byDay.ordinal === null) return all
  const index = byDay.ordinal > 0 ? byDay.ordinal - 1 : all.length + byDay.ordinal
  return index >= 0 && index < all.length ? [all[index]] : []
}

function monthDays(year: number, month: number, rule: RRule, startDate: number): number[] {
  const length = monthLength(year, month)
  const first = dayOf(year, month, 1)
  const last = first + length - 1
  let fromMonthDay: number[] | null = null
  if (rule.byMonthDay.length > 0) {
    fromMonthDay = rule.byMonthDay
      .map((value) => (value > 0 ? value : length + value + 1))
      .filter((value) => value >= 1 && value <= length)
      .map((value) => first + value - 1)
  }
  let fromDay: number[] | null = null
  if (rule.byDay.length > 0) fromDay = rule.byDay.flatMap((byDay) => weekdaysIn(first, last, byDay))
  if (fromMonthDay && fromDay) return fromMonthDay.filter((day) => fromDay!.includes(day))
  if (fromMonthDay) return fromMonthDay
  if (fromDay) return fromDay
  return startDate <= length ? [first + startDate - 1] : []
}

/** The candidate days of one period, before BYSETPOS. */
function periodDays(rule: RRule, period: number, start: number): number[] {
  const startParts = partsOf(start)
  const keepMonth = (day: number) =>
    rule.byMonth.length === 0 || rule.byMonth.includes(partsOf(day).month)
  if (rule.freq === 'DAILY') {
    const day = start + period * rule.interval
    if (!keepMonth(day)) return []
    if (rule.byMonthDay.length > 0) {
      const { year, month, date } = partsOf(day)
      const length = monthLength(year, month)
      if (!rule.byMonthDay.some((value) => (value > 0 ? value : length + value + 1) === date))
        return []
    }
    if (rule.byDay.length > 0 && !rule.byDay.some((byDay) => byDay.weekday === weekdayOf(day)))
      return []
    return [day]
  }
  if (rule.freq === 'WEEKLY') {
    const weekFirst =
      start - ((weekdayOf(start) - rule.weekStart + 7) % 7) + period * rule.interval * 7
    const weekdays =
      rule.byDay.length > 0 ? rule.byDay.map((byDay) => byDay.weekday) : [weekdayOf(start)]
    const days: number[] = []
    for (let offset = 0; offset < 7; offset++) {
      const day = weekFirst + offset
      if (weekdays.includes(weekdayOf(day)) && keepMonth(day)) days.push(day)
    }
    return days
  }
  if (rule.freq === 'MONTHLY') {
    const index = startParts.year * 12 + (startParts.month - 1) + period * rule.interval
    const year = Math.floor(index / 12)
    const month = (index % 12) + 1
    if (rule.byMonth.length > 0 && !rule.byMonth.includes(month)) return []
    return monthDays(year, month, rule, startParts.date)
  }
  const year = startParts.year + period * rule.interval
  if (rule.byMonth.length > 0)
    return rule.byMonth.flatMap((month) =>
      rule.byDay.length === 0 && rule.byMonthDay.length === 0
        ? startParts.date <= monthLength(year, month)
          ? [dayOf(year, month, startParts.date)]
          : []
        : monthDays(year, month, rule, startParts.date)
    )
  if (rule.byMonthDay.length > 0)
    return Array.from({ length: 12 }, (_, index) =>
      monthDays(year, index + 1, { ...rule, byDay: [] }, startParts.date)
    )
      .flat()
      .filter(
        (day) =>
          rule.byDay.length === 0 || rule.byDay.some((byDay) => byDay.weekday === weekdayOf(day))
      )
  if (rule.byDay.length > 0)
    return rule.byDay.flatMap((byDay) => weekdaysIn(dayOf(year, 1, 1), dayOf(year, 12, 31), byDay))
  return startParts.date <= monthLength(year, startParts.month)
    ? [dayOf(year, startParts.month, startParts.date)]
    : []
}

function withSetPos(days: number[], setPos: number[]): number[] {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (setPos.length === 0) return sorted
  const picked = setPos
    .map((position) => (position > 0 ? sorted[position - 1] : sorted[sorted.length + position]))
    .filter((day): day is number => day !== undefined)
  return [...new Set(picked)].sort((a, b) => a - b)
}

/** How many whole periods lie between two days, for skipping ahead. */
function periodsBetween(rule: RRule, from: number, to: number): number {
  if (to <= from) return 0
  const a = partsOf(from)
  const b = partsOf(to)
  const span =
    rule.freq === 'DAILY'
      ? to - from
      : rule.freq === 'WEEKLY'
        ? Math.floor((to - from) / 7)
        : rule.freq === 'MONTHLY'
          ? (b.year - a.year) * 12 + (b.month - a.month)
          : b.year - a.year
  return Math.max(0, Math.floor(span / rule.interval) - 1)
}

/**
 * The starts (wall ms) of a repeating event that fall within `from`..`to`
 * (wall ms, inclusive), in order. `start` is DTSTART's wall time; `until` is
 * the rule's UNTIL already in the event's own wall time. DTSTART is always
 * the first occurrence. Without COUNT, the periods before `from` are skipped
 * rather than walked.
 */
export function expandRule(
  rule: RRule,
  start: number,
  range: { from: number; to: number },
  until: number | null = rule.until
): number[] {
  const startDay = Math.floor(start / DAY_MS)
  const time = start - startDay * DAY_MS
  const result: number[] = []
  let count = 0
  const take = (occurrence: number): boolean => {
    if (until !== null && occurrence > until) return false
    count++
    if (rule.count !== null && count > rule.count) return false
    if (occurrence > range.to) return false
    if (occurrence >= range.from) result.push(occurrence)
    return true
  }
  if (!take(start)) return result
  const first =
    rule.count === null ? periodsBetween(rule, startDay, Math.floor(range.from / DAY_MS)) : 0
  for (let period = first, empty = 0; period < first + MAX_PERIODS; period++) {
    const days = withSetPos(periodDays(rule, period, startDay), rule.bySetPos)
    empty = days.length === 0 ? empty + 1 : 0
    for (const day of days) {
      if (day <= startDay) continue
      if (!take(day * DAY_MS + time)) return result
    }
    // Past the range, or a rule that has stopped matching (BYMONTHDAY=31 in a
    // MONTHLY;BYMONTH=2 rule, say): stop.
    const periodStart = periodDays(
      { ...rule, byDay: [], byMonthDay: [], byMonth: [], bySetPos: [] },
      period,
      startDay
    )[0]
    if (periodStart !== undefined && periodStart * DAY_MS > range.to + 400 * DAY_MS) return result
    if (empty > 2000) return result
  }
  return result
}

/** A wall time as `YYYY-MM-DDTHH:mm:ss`. */
export function wallKey(wall: number): string {
  return new Date(wall).toISOString().slice(0, 19)
}

/** A wall time's date, `YYYY-MM-DD`. */
export function wallDate(wall: number): string {
  return new Date(wall).toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm:ss` as wall milliseconds. */
export function wallFromKey(key: string): number {
  return Date.parse(key.length === 10 ? `${key}T00:00:00Z` : `${key}Z`)
}
