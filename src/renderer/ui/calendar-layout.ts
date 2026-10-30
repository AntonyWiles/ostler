import { isoDaysBetween, isoWeekday, shiftIsoDate } from '@shared/dates'
import { formatLocale, t } from '@shared/i18n'
import { formatList } from '@shared/format'

/**
 * The calendar's arithmetic (CalendarGrid, P5.4): which days a month or week
 * shows, and where each item's bar sits. Pure, and every date is a
 * `YYYY-MM-DD` string moved through `@shared/dates`, so no time zone can
 * shift a day.
 */

/** Month and Week draw `CalendarGrid`; Year and Agenda (N3.1a) draw their own. */
export type CalendarMode = 'month' | 'week' | 'year' | 'agenda'

/** Weekday numbers: 0 is Sunday, 6 is Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

interface WeekInfo {
  firstDay?: number
}

/**
 * The first day of the week in the formatting locale (the Windows region,
 * P11.1), from `Intl.Locale` week info (`getWeekInfo()` or the older
 * `weekInfo`), falling back to Monday where the runtime does not say.
 */
export function localeWeekStart(locale: string = formatLocale()): Weekday {
  try {
    const value = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => WeekInfo
      weekInfo?: WeekInfo
    }
    const info = value.getWeekInfo?.() ?? value.weekInfo
    const first = info?.firstDay
    // Week info counts 1 (Monday) to 7 (Sunday).
    if (typeof first === 'number' && first >= 1 && first <= 7) return (first % 7) as Weekday
  } catch {
    // An unknown locale: the fallback below.
  }
  return 1
}

/** The first day of the week holding `date`. */
export function startOfWeek(date: string, weekStart: Weekday): string {
  const offset = (isoWeekday(date) - weekStart + 7) % 7
  return shiftIsoDate(date, -offset)
}

/** The seven days from `start`. */
export function weekFrom(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => shiftIsoDate(start, index))
}

/** `YYYY-MM` of a date. */
export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** The number of days in a date's month. */
export function daysInMonth(date: string): number {
  const [y, m] = date.split('-').map(Number)
  const first = `${monthOf(date)}-01`
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return isoDaysBetween(first, next)
}

/**
 * The weeks a period shows: in month mode every week touching the month of
 * `anchor` (four to six), in week mode the one week holding it.
 */
export function calendarWeeks(anchor: string, mode: CalendarMode, weekStart: Weekday): string[][] {
  if (mode === 'week') return [weekFrom(startOfWeek(anchor, weekStart))]
  const first = `${monthOf(anchor)}-01`
  const last = shiftIsoDate(first, daysInMonth(anchor) - 1)
  const weeks: string[][] = []
  for (let start = startOfWeek(first, weekStart); start <= last; start = shiftIsoDate(start, 7))
    weeks.push(weekFrom(start))
  return weeks
}

/**
 * `anchor` moved by whole periods: a month (Month and Agenda) keeps its day of
 * the month where it can (31 January plus one month is 28 or 29 February), a
 * year moves twelve months the same way, and a week moves 7 days.
 */
export function shiftPeriod(anchor: string, mode: CalendarMode, step: number): string {
  if (mode === 'week') return shiftIsoDate(anchor, step * 7)
  const months = mode === 'year' ? step * 12 : step
  const [y, m, d] = anchor.split('-').map(Number)
  const index = y * 12 + (m - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  const first = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
  return shiftIsoDate(first, Math.min(d, daysInMonth(first)) - 1)
}

/**
 * What a calendar says about a day off (N3.2): everyone's day off by name
 * (a bank holiday), and the people whose leave covers it. The view decides
 * both through `@shared/planning/working-days`; the grids only show them.
 */
export interface CalendarDayOff {
  /** Everyone's day off, or null. */
  name: string | null
  /** People away that day, by name. */
  people: string[]
}

/**
 * A day off's words: `label` for the day's accessible name ("day off:
 * Christmas Day, Sam off") and `note`, the short text shown on the day.
 */
export function dayOffWords(dayOff: CalendarDayOff | null | undefined): {
  label: string | null
  note: string | null
} {
  if (!dayOff) return { label: null, note: null }
  const people =
    dayOff.people.length === 0
      ? null
      : dayOff.people.length === 1
        ? t('common:daysOff.personOff', { person: dayOff.people[0] })
        : t('common:daysOff.peopleOff', { people: formatList(dayOff.people) })
  const named = dayOff.name ? t('common:daysOff.dayOffLabel', { name: dayOff.name }) : null
  return {
    label: [named, people].filter(Boolean).join(', ') || null,
    note: dayOff.name ?? people
  }
}

/** Whether a day is a Saturday or Sunday. */
export function isWeekend(date: string): boolean {
  const day = isoWeekday(date)
  return day === 0 || day === 6
}

/** An item on the calendar: a day, or a range of days (inclusive). */
export interface CalendarSpan {
  id: string
  start: string
  end: string
}

/** One visible piece of an item's bar within a week. */
export interface CalendarSegment<T extends CalendarSpan = CalendarSpan> {
  item: T
  /** The first day of the piece, and its column (0–6) and length in days. */
  start: string
  column: number
  span: number
  lane: number
  /** The item began before this piece, or goes on after it. */
  continuesBefore: boolean
  continuesAfter: boolean
}

export interface CalendarWeekLayout<T extends CalendarSpan = CalendarSpan> {
  segments: CalendarSegment<T>[]
  /** Per day of the week (by date): the items with no room, for "+N more". */
  hidden: Map<string, T[]>
}

/**
 * Where a week's items sit. Each item takes the lowest lane that is free on
 * every day it covers (longer ones first, then by start and the given order),
 * so a bar keeps one row across its days. A day shows at most `maxLanes`
 * rows; when it has more items than that, it shows `maxLanes - 1` and keeps
 * the last row for "+N more", and a bar is cut where it has no room.
 */
export function layoutWeek<T extends CalendarSpan>(
  items: readonly T[],
  week: readonly string[],
  maxLanes: number
): CalendarWeekLayout<T> {
  const first = week[0]
  const last = week[week.length - 1]
  const inWeek = items
    .map((item, order) => {
      const start = item.start <= item.end ? item.start : item.end
      return { item, order, start, end: item.end }
    })
    .filter(({ start, end }) => start <= last && end >= first)
    .map((entry) => {
      const from = entry.start < first ? first : entry.start
      const to = entry.end > last ? last : entry.end
      return {
        ...entry,
        column: isoDaysBetween(first, from),
        span: isoDaysBetween(from, to) + 1
      }
    })
    .sort((a, b) => b.span - a.span || a.column - b.column || a.order - b.order)

  const lanes: boolean[][] = []
  const placed = inWeek.map((entry) => {
    let lane = 0
    for (; ; lane++) {
      const row = (lanes[lane] ??= Array(week.length).fill(false))
      let free = true
      for (let day = entry.column; day < entry.column + entry.span; day++)
        if (row[day]) free = false
      if (free) {
        for (let day = entry.column; day < entry.column + entry.span; day++) row[day] = true
        break
      }
    }
    return { ...entry, lane }
  })

  const counts = week.map((_, day) =>
    placed.reduce(
      (count, entry) => count + (day >= entry.column && day < entry.column + entry.span ? 1 : 0),
      0
    )
  )
  const limit = counts.map((count) => (count > maxLanes ? maxLanes - 1 : maxLanes))

  const segments: CalendarSegment<T>[] = []
  const hidden = new Map<string, T[]>(week.map((date) => [date, []]))
  for (const entry of placed) {
    let run: number | null = null
    const close = (end: number) => {
      if (run === null) return
      segments.push({
        item: entry.item,
        start: week[run],
        column: run,
        span: end - run,
        lane: entry.lane,
        continuesBefore: run > entry.column || entry.start < first,
        continuesAfter: end < entry.column + entry.span || entry.end > last
      })
      run = null
    }
    for (let day = entry.column; day < entry.column + entry.span; day++) {
      if (entry.lane < limit[day]) {
        run ??= day
      } else {
        close(day)
        hidden.get(week[day])!.push(entry.item)
      }
    }
    close(entry.column + entry.span)
  }
  // Hidden items in the order they were given, so the popover reads as the
  // calendar does.
  for (const list of hidden.values()) list.sort((a, b) => items.indexOf(a) - items.indexOf(b))
  segments.sort((a, b) => a.column - b.column || a.lane - b.lane)
  return { segments, hidden }
}

/** One small month in Year: its first day, and its weeks with `null` outside the month. */
export interface YearMonth {
  first: string
  weeks: (string | null)[][]
}

/** The twelve months of `anchor`'s year, each in weeks from `weekStart`. */
export function yearMonths(anchor: string, weekStart: Weekday): YearMonth[] {
  const year = anchor.slice(0, 4)
  return Array.from({ length: 12 }, (_, index) => {
    const first = `${year}-${String(index + 1).padStart(2, '0')}-01`
    const month = monthOf(first)
    const weeks = calendarWeeks(first, 'month', weekStart).map((week) =>
      week.map((date) => (monthOf(date) === month ? date : null))
    )
    return { first, weeks }
  })
}

/** How much work a day holds in Year. */
export interface DayWork {
  tasks: number
  milestones: number
}

/**
 * Per day of `anchor`'s year, how many tasks run over it and how many
 * milestones fall on it: one pass over the items, counting into arrays by day
 * index, so a year of 5,000 tasks stays cheap. Days with nothing are absent.
 */
export function yearWork<T extends CalendarSpan>(
  items: readonly T[],
  anchor: string,
  isMilestone: (item: T) => boolean
): Map<string, DayWork> {
  const first = `${anchor.slice(0, 4)}-01-01`
  const last = `${anchor.slice(0, 4)}-12-31`
  const length = isoDaysBetween(first, last) + 1
  const tasks = new Array<number>(length).fill(0)
  const milestones = new Array<number>(length).fill(0)
  for (const item of items) {
    const start = item.start <= item.end ? item.start : item.end
    if (start > last || item.end < first) continue
    const from = start < first ? 0 : isoDaysBetween(first, start)
    const to = item.end > last ? length - 1 : isoDaysBetween(first, item.end)
    const counts = isMilestone(item) ? milestones : tasks
    for (let day = from; day <= to; day++) counts[day]++
  }
  const work = new Map<string, DayWork>()
  for (let day = 0; day < length; day++)
    if (tasks[day] || milestones[day])
      work.set(shiftIsoDate(first, day), { tasks: tasks[day], milestones: milestones[day] })
  return work
}

/** A day's mark in Year: 0 nothing, 1 one thing, 2 a few (up to four), 3 many. */
export function workLevel(work: DayWork | undefined): 0 | 1 | 2 | 3 {
  const count = work ? work.tasks + work.milestones : 0
  if (count === 0) return 0
  if (count === 1) return 1
  return count <= 4 ? 2 : 3
}

/** A day in Agenda, with the items that show under it. */
export interface AgendaDay<T> {
  date: string
  items: T[]
}

/**
 * Agenda for `anchor`'s month: each item listed once, on its first day within
 * the month, in the given order; days with nothing are left out.
 */
export function agendaDays<T extends CalendarSpan>(
  items: readonly T[],
  anchor: string
): AgendaDay<T>[] {
  const first = `${monthOf(anchor)}-01`
  const last = shiftIsoDate(first, daysInMonth(anchor) - 1)
  const byDay = new Map<string, T[]>()
  for (const item of items) {
    const start = item.start <= item.end ? item.start : item.end
    if (start > last || item.end < first) continue
    const day = start < first ? first : start
    const list = byDay.get(day)
    if (list) list.push(item)
    else byDay.set(day, [item])
  }
  return [...byDay.keys()].sort().map((date) => ({ date, items: byDay.get(date)! }))
}

/** All the items covering a day, in the given order. */
export function itemsOnDay<T extends CalendarSpan>(items: readonly T[], date: string): T[] {
  return items.filter((item) => {
    const start = item.start <= item.end ? item.start : item.end
    return start <= date && item.end >= date
  })
}
