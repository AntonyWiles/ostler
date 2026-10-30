import { shiftIsoDate } from '../dates'
import type { CalendarEventRecord, CalendarOccurrence } from '../ostler-api/calendar-types'
import { DAY_MS, expandRule, parseRRule, wallDate, wallFromKey, wallKey } from './ics-rrule'
import { utcToWall, wallToUtc, type IcsTimeZone, type ZoneContext } from './ics-time'

/*
 * Expanding calendar events (N3.3a): the occurrences of a calendar's events
 * between two dates, in the person's time zone. Events are kept as the file
 * gives them (`CalendarEventRecord`); this is the one place their repeats,
 * exceptions and overrides become days on a calendar, so the Calendar, Home,
 * Print my week and the automation API all agree. Pure.
 *
 * An all-day event stays on its calendar dates whatever the zone. A timed
 * event is placed by its instant, so a meeting written in New York shows at
 * the right hour in London, and one that runs past midnight covers both days.
 */

export interface ExpandOptions {
  /** `YYYY-MM-DD`, inclusive, in `timeZone`. */
  from: string
  to: string
  /** The person's IANA time zone. */
  timeZone: string
  /** Each calendar's own time zones (its file's VTIMEZONEs), by calendar id. */
  zonesFor: (calendarId: string) => readonly IcsTimeZone[]
}

const contexts = new WeakMap<readonly IcsTimeZone[], Map<string, ZoneContext>>()

function contextFor(zones: readonly IcsTimeZone[], local: string): ZoneContext {
  let byLocal = contexts.get(zones)
  if (!byLocal) contexts.set(zones, (byLocal = new Map()))
  let context = byLocal.get(local)
  if (!context) {
    context = { zones: new Map(zones.map((zone) => [zone.id, zone])), local }
    byLocal.set(local, context)
  }
  return context
}

function hhmm(wall: number): string {
  return wallKey(wall).slice(11, 16)
}

/**
 * Every occurrence that overlaps `from`..`to`, sorted by start (all-day
 * first on a day), then title. Cancelled overrides and EXDATEs remove their
 * occurrences; an override replaces its occurrence wherever it moved to.
 */
export function expandCalendarEvents(
  events: readonly CalendarEventRecord[],
  options: ExpandOptions
): CalendarOccurrence[] {
  const { from, to, timeZone } = options
  const local: ZoneContext = { zones: new Map(), local: timeZone }
  const rangeStart = wallToUtc(wallFromKey(from), null, local)
  const rangeEnd = wallToUtc(wallFromKey(shiftIsoDate(to, 1)), null, local)
  const fromDay = wallFromKey(from)
  const toDayEnd = wallFromKey(shiftIsoDate(to, 1))

  // Occurrences replaced by an override, or cancelled, by series.
  const replaced = new Map<string, Set<string>>()
  for (const event of events) {
    if (!event.recurrenceId || !event.uid) continue
    const key = `${event.calendarId}\n${event.uid}`
    let set = replaced.get(key)
    if (!set) replaced.set(key, (set = new Set()))
    set.add(event.recurrenceId)
  }

  const result: CalendarOccurrence[] = []
  for (const event of events) {
    if (event.cancelled) continue
    const startWall = wallFromKey(event.start)
    const endWall = Math.max(wallFromKey(event.end), startWall)
    const length = endWall - startWall
    const context = contextFor(options.zonesFor(event.calendarId), timeZone)
    const isMaster = !event.recurrenceId
    const rule = isMaster && event.rrule ? parseRRule(event.rrule) : null
    const skip = new Set(event.exdates)
    const overridden = event.uid ? replaced.get(`${event.calendarId}\n${event.uid}`) : undefined

    let starts: number[]
    if (event.allDay) {
      const range = { from: fromDay - length + 1, to: toDayEnd - 1 }
      starts = rule
        ? expandRule(rule, startWall, range)
        : startWall <= range.to && startWall >= range.from
          ? [startWall]
          : []
    } else {
      // Search a little wider in the event's own wall time, then keep only
      // what overlaps the range as instants.
      const margin = 2 * DAY_MS
      const range = {
        from: utcToWall(rangeStart, event.timeZone, context) - length - margin,
        to: utcToWall(rangeEnd, event.timeZone, context) + margin
      }
      let until = rule?.until ?? null
      if (rule && until !== null && rule.untilUtc) until = utcToWall(until, event.timeZone, context)
      starts = rule
        ? expandRule(rule, startWall, range, until)
        : startWall <= range.to && startWall >= range.from
          ? [startWall]
          : []
    }

    for (const wall of starts) {
      const key = event.allDay ? wallDate(wall) : wallKey(wall)
      if (isMaster && (skip.has(key) || skip.has(wallDate(wall)))) continue
      if (isMaster && rule && overridden?.has(key)) continue
      let occurrence: CalendarOccurrence
      if (event.allDay) {
        const startDate = wallDate(wall)
        const endDate = wallDate(wall + Math.max(length, DAY_MS) - DAY_MS)
        if (endDate < from || startDate > to) continue
        occurrence = {
          id: `${event.id}:${startDate}`,
          eventId: event.id,
          calendarId: event.calendarId,
          title: event.title,
          location: event.location,
          description: event.description,
          allDay: true,
          startDate,
          endDate,
          startTime: null,
          endTime: null,
          start: wallToUtc(wallFromKey(startDate), null, local),
          end: wallToUtc(wallFromKey(shiftIsoDate(endDate, 1)), null, local)
        }
      } else {
        const start = wallToUtc(wall, event.timeZone, context)
        const end = wallToUtc(wall + length, event.timeZone, context)
        const overlaps =
          end > start
            ? start < rangeEnd && end > rangeStart
            : start >= rangeStart && start < rangeEnd
        if (!overlaps) continue
        const startLocal = utcToWall(start, null, local)
        const endLocal = utcToWall(end, null, local)
        const startDate = wallDate(startLocal)
        // An event ending at midnight ends on the day before.
        const endDate = end > start ? wallDate(endLocal - 1) : startDate
        occurrence = {
          id: `${event.id}:${start}`,
          eventId: event.id,
          calendarId: event.calendarId,
          title: event.title,
          location: event.location,
          description: event.description,
          allDay: false,
          startDate,
          endDate: endDate < startDate ? startDate : endDate,
          startTime: hhmm(startLocal),
          endTime: hhmm(endLocal),
          start,
          end
        }
      }
      result.push(occurrence)
    }
  }
  result.sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      Number(b.allDay) - Number(a.allDay) ||
      a.start - b.start ||
      a.title.localeCompare(b.title)
  )
  return result
}

/** "09:30 Stand-up", or the title alone for an all-day event: how an event reads on a calendar. */
export function occurrenceLine(
  occurrence: Pick<CalendarOccurrence, 'startTime' | 'title'>
): string {
  return occurrence.startTime ? `${occurrence.startTime} ${occurrence.title}` : occurrence.title
}
