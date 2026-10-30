import { compareIsoDates, formatIsoDate, isoDaysBetween, shiftIsoDate } from '@shared/dates'
import { isWeekend, localeWeekStart, startOfWeek, type Weekday } from './calendar-layout'
import { t } from '@shared/i18n'

/**
 * The timeline's arithmetic (TimelineGrid, P5.5): how wide a day is at each
 * zoom, where a date sits and which date a point is, the range a set of
 * dates needs, and the header's ticks. Pure, with every date a `YYYY-MM-DD`
 * string moved through `@shared/dates`, so no time zone can shift a day.
 */

export type TimelineZoom = 'week' | 'month' | 'quarter'

/** Closest first: Ctrl with the wheel steps through these. */
export const TIMELINE_ZOOMS: readonly TimelineZoom[] = ['week', 'month', 'quarter']

/** Pixels per day at each zoom: layout geometry, not a design token. */
const DAY_WIDTH: Record<TimelineZoom, number> = { week: 32, month: 10, quarter: 3 }

/** The days of margin a range keeps around its dates at each zoom. */
const MARGIN_DAYS: Record<TimelineZoom, number> = { week: 14, month: 31, quarter: 92 }

export function dayWidth(zoom: TimelineZoom): number {
  return DAY_WIDTH[zoom]
}

/** The zoom one step closer (`-1`) or further out (`1`), staying in range. */
export function stepZoom(zoom: TimelineZoom, step: -1 | 1): TimelineZoom {
  const index = TIMELINE_ZOOMS.indexOf(zoom) + step
  return TIMELINE_ZOOMS[Math.min(TIMELINE_ZOOMS.length - 1, Math.max(0, index))]
}

/** The left edge of a day, in pixels from the range's first day. */
export function dateToX(date: string, origin: string, zoom: TimelineZoom): number {
  return isoDaysBetween(origin, date) * DAY_WIDTH[zoom]
}

/** The day under a point, `x` pixels from the range's first day. */
export function xToDate(x: number, origin: string, zoom: TimelineZoom): string {
  return shiftIsoDate(origin, Math.floor(x / DAY_WIDTH[zoom]))
}

/** Whole days a horizontal drag of `dx` pixels covers, to the nearest day. */
export function pixelsToDays(dx: number, zoom: TimelineZoom): number {
  const days = Math.round(dx / DAY_WIDTH[zoom])
  return days === 0 ? 0 : days
}

/** The first of the month holding `date`. */
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`
}

/** The first of the month after the one holding `date`. */
function nextMonth(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/**
 * The days a timeline shows: every date given and today, with a margin on
 * each side, from the first of a month to the last day of a month, so the
 * header's months are whole.
 */
export function timelineRange(
  dates: readonly string[],
  today: string,
  zoom: TimelineZoom
): { start: string; end: string } {
  let first = today
  let last = today
  for (const date of dates) {
    if (compareIsoDates(date, first) < 0) first = date
    if (compareIsoDates(date, last) > 0) last = date
  }
  const start = monthStart(shiftIsoDate(first, -MARGIN_DAYS[zoom]))
  const end = shiftIsoDate(nextMonth(shiftIsoDate(last, MARGIN_DAYS[zoom])), -1)
  return { start, end }
}

/** One label in the header: from `date`, `days` long. */
export interface TimelineTick {
  date: string
  days: number
  label: string
  /** A longer name for the tooltip and screen readers. */
  title: string
}

function format(date: string, options: Intl.DateTimeFormatOptions): string {
  return formatIsoDate(date, options)
}

/** Cuts `start`..`end` into pieces beginning where `next` says, each kept within the range. */
function pieces(
  start: string,
  end: string,
  first: string,
  next: (date: string) => string,
  label: (date: string) => { label: string; title: string }
): TimelineTick[] {
  const ticks: TimelineTick[] = []
  let at = first
  while (compareIsoDates(at, end) <= 0) {
    const following = next(at)
    const from = compareIsoDates(at, start) < 0 ? start : at
    const to =
      compareIsoDates(following, shiftIsoDate(end, 1)) > 0 ? shiftIsoDate(end, 1) : following
    ticks.push({ date: from, days: isoDaysBetween(from, to), ...label(at) })
    at = following
  }
  return ticks
}

function quarterOf(date: string): number {
  return Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1
}

/**
 * The header's two rows of ticks for a range: months over days at Week zoom,
 * months over weeks at Month zoom, and quarters over months at Quarter zoom.
 */
export function timelineTicks(
  range: { start: string; end: string },
  zoom: TimelineZoom,
  weekStart: Weekday = localeWeekStart()
): { major: TimelineTick[]; minor: TimelineTick[] } {
  const { start, end } = range
  const months = pieces(start, end, monthStart(start), nextMonth, (date) => {
    const name = format(date, { month: 'long', year: 'numeric' })
    return { label: zoom === 'quarter' ? format(date, { month: 'short' }) : name, title: name }
  })
  if (zoom === 'quarter') {
    const quarterStart = (date: string) =>
      `${date.slice(0, 4)}-${String((quarterOf(date) - 1) * 3 + 1).padStart(2, '0')}-01`
    const nextQuarter = (date: string) => nextMonth(nextMonth(nextMonth(quarterStart(date))))
    const quarters = pieces(start, end, quarterStart(start), nextQuarter, (date) => {
      const name = `Q${quarterOf(date)} ${date.slice(0, 4)}`
      return { label: name, title: name }
    })
    return { major: quarters, minor: months }
  }
  if (zoom === 'month') {
    const weeks = pieces(
      start,
      end,
      startOfWeek(start, weekStart),
      (date) => shiftIsoDate(date, 7),
      (date) => ({
        label: format(date, { day: 'numeric' }),
        title: t('common:timelineScale.week', {
          format: format(date, { day: 'numeric', month: 'long', year: 'numeric' })
        })
      })
    )
    return { major: months, minor: weeks }
  }
  const days = pieces(
    start,
    end,
    start,
    (date) => shiftIsoDate(date, 1),
    (date) => ({
      label: format(date, { day: 'numeric' }),
      title: format(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    })
  )
  return { major: months, minor: days }
}

/** The weekend days in a range, for shading at Week zoom. */
export function weekendDays(range: { start: string; end: string }): string[] {
  const days: string[] = []
  for (let at = range.start; compareIsoDates(at, range.end) <= 0; at = shiftIsoDate(at, 1))
    if (isWeekend(at)) days.push(at)
  return days
}
