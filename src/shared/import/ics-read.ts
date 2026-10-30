import { compareIsoDates, isIsoDate, isoDaysBetween, shiftIsoDate } from '../dates'
import { t } from '../i18n'
import { DAY_MS, parseRRule, parseWall, wallDate, wallKey } from '../calendar/ics-rrule'
import {
  parseOffset,
  utcToWall,
  wallToUtc,
  type IcsObservance,
  type IcsTimeZone,
  type ZoneContext
} from '../calendar/ics-time'
import { MAX_EVENT_DESCRIPTION, type CalendarEventRecord } from '../ostler-api/calendar-types'

/*
 * Reading a calendar file (N3.2): a small iCalendar (RFC 5545) reader of our
 * own, with no dependency (decision N4). It unfolds lines, reads each
 * `VEVENT`'s `SUMMARY`, `DTSTART`, `DTEND`, `UID` and `RRULE`, and keeps
 * all-day events (`VALUE=DATE`, or a bare eight-digit date). `DTEND` is
 * exclusive, so an event ending on the 26th covers the 25th. A yearly repeat
 * on a fixed date (`RRULE:FREQ=YEARLY` with nothing but `UNTIL`, `COUNT` or
 * `INTERVAL`) is expanded for the next five years; any other repeat, and
 * every timed event, is listed as skipped.
 *
 * The file is untrusted data: its size, its number of events and the length
 * of its lines are limited, nothing in it is followed (no URL, no
 * attachment, no include), and its text is only ever shown as text. Pure, so
 * N3.3a can extend it to timed events and other repeats.
 */

/** The biggest calendar file read, in bytes of text. */
export const MAX_ICS_BYTES = 5 * 1024 * 1024
/** The most events one file may hold. */
export const MAX_ICS_EVENTS = 10_000
/** The longest unfolded line read. */
export const MAX_ICS_LINE_LENGTH = 10_000
/** How many years ahead a yearly repeat is expanded. */
export const ICS_REPEAT_YEARS = 5
/** The longest event name kept; longer ones are cut. */
const MAX_SUMMARY = 80

export interface IcsAllDayEvent {
  uid: string | null
  name: string
  /** `YYYY-MM-DD`, inclusive. */
  firstDate: string
  lastDate: string
}

export interface IcsSkippedEvent {
  name: string
  reason: 'timed' | 'repeat' | 'no-date'
}

export interface IcsReadResult {
  events: IcsAllDayEvent[]
  skipped: IcsSkippedEvent[]
}

/** A file the reader refuses, with a plain message. */
export class IcsReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IcsReadError'
  }
}

interface Property {
  name: string
  params: Record<string, string>
  value: string
}

/** Lines with their folds joined (RFC 5545 §3.1: CRLF then a space or tab continues a line). */
function unfold(text: string, maxLine = MAX_ICS_LINE_LENGTH): string[] {
  const lines: string[] = []
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1)
    } else {
      lines.push(raw)
    }
    if (lines.length > 0 && lines[lines.length - 1].length > maxLine)
      throw new IcsReadError(t('errors:icsRead.lineTooLong'))
  }
  return lines
}

/** `NAME;PARAM=VALUE:value`, or null for a line that is not a property. */
function parseLine(line: string): Property | null {
  // The first colon outside a quoted parameter value ends the name and parameters.
  let quoted = false
  let colon = -1
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"') quoted = !quoted
    else if (char === ':' && !quoted) {
      colon = index
      break
    }
  }
  if (colon <= 0) return null
  const [name, ...rawParams] = line.slice(0, colon).split(';')
  const params: Record<string, string> = {}
  for (const param of rawParams) {
    const equals = param.indexOf('=')
    if (equals > 0)
      params[param.slice(0, equals).toUpperCase()] = param.slice(equals + 1).replace(/"/g, '')
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) }
}

/** TEXT unescaped (RFC 5545 §3.3.11), one line, cut to a name's length. */
function unescapeText(value: string): string {
  const text = value
    .replace(/\\[nN]/g, ' ')
    .replace(/\\([\\;,])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return [...text].slice(0, MAX_SUMMARY).join('')
}

/** `20261225` as `2026-12-25`, or null. */
function dateValue(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim())
  if (!match) return null
  const date = `${match[1]}-${match[2]}-${match[3]}`
  return isIsoDate(date) ? date : null
}

/** Whether a DTSTART or DTEND holds a date, not a date and time. */
function isDateOnly(property: Property): boolean {
  return property.params.VALUE?.toUpperCase() === 'DATE' || /^\d{8}$/.test(property.value.trim())
}

interface YearlyRule {
  interval: number
  count: number | null
  until: string | null
}

/** A yearly repeat on a fixed date, or null for any other rule. */
function yearlyRule(value: string): YearlyRule | null {
  const parts = new Map<string, string>()
  for (const part of value.split(';')) {
    const equals = part.indexOf('=')
    if (equals <= 0) return null
    parts.set(part.slice(0, equals).toUpperCase(), part.slice(equals + 1).trim())
  }
  if (parts.get('FREQ')?.toUpperCase() !== 'YEARLY') return null
  for (const key of parts.keys())
    if (!['FREQ', 'UNTIL', 'COUNT', 'INTERVAL'].includes(key)) return null
  const interval = parts.has('INTERVAL') ? Number(parts.get('INTERVAL')) : 1
  const count = parts.has('COUNT') ? Number(parts.get('COUNT')) : null
  if (!Number.isInteger(interval) || interval < 1 || interval > 100) return null
  if (count !== null && (!Number.isInteger(count) || count < 1)) return null
  let until: string | null = null
  if (parts.has('UNTIL')) {
    until = dateValue(parts.get('UNTIL')!.slice(0, 8))
    if (!until) return null
  }
  return { interval, count, until }
}

/** `date` moved by whole years, or null when that day does not exist (29 February). */
function inYear(date: string, year: number): string | null {
  const moved = `${String(year).padStart(4, '0')}${date.slice(4)}`
  return isIsoDate(moved) ? moved : null
}

/** The occurrences of a yearly event from this year to five years ahead. */
function expandYearly(event: IcsAllDayEvent, rule: YearlyRule, today: string): IcsAllDayEvent[] {
  const firstYear = Number(event.firstDate.slice(0, 4))
  const fromYear = Number(today.slice(0, 4))
  const toYear = fromYear + ICS_REPEAT_YEARS
  const span = isoDaysBetween(event.firstDate, event.lastDate)
  const result: IcsAllDayEvent[] = []
  for (let index = 0; ; index++) {
    if (rule.count !== null && index >= rule.count) break
    const year = firstYear + index * rule.interval
    if (year > toYear) break
    const firstDate = inYear(event.firstDate, year)
    if (!firstDate) continue
    if (rule.until && compareIsoDates(firstDate, rule.until) > 0) break
    if (year < fromYear) continue
    result.push({ ...event, firstDate, lastDate: shiftIsoDate(firstDate, span) })
  }
  return result
}

/**
 * Reads a calendar file's all-day events. `today` (`YYYY-MM-DD`) is where
 * yearly repeats start from. Throws `IcsReadError` for a file that is too
 * big, has too many events or long lines, or is not a calendar at all.
 */
export function readIcs(text: string, options: { today: string }): IcsReadResult {
  if (typeof text !== 'string') throw new IcsReadError(t('errors:icsRead.notCalendar'))
  if (text.length > MAX_ICS_BYTES) throw new IcsReadError(t('errors:icsRead.tooBig'))
  const lines = unfold(text.replace(/^\uFEFF/, ''))
  if (!lines.some((line) => line.trim().toUpperCase() === 'BEGIN:VCALENDAR'))
    throw new IcsReadError(t('errors:icsRead.notCalendar'))

  const events: IcsAllDayEvent[] = []
  const skipped: IcsSkippedEvent[] = []
  let current: Property[] | null = null
  let depth = 0
  let eventCount = 0
  for (const line of lines) {
    const upper = line.trim().toUpperCase()
    if (upper === 'BEGIN:VEVENT' && current === null) {
      eventCount++
      if (eventCount > MAX_ICS_EVENTS) throw new IcsReadError(t('errors:icsRead.tooManyEvents'))
      current = []
      depth = 0
      continue
    }
    if (current === null) continue
    if (upper.startsWith('BEGIN:')) {
      // An alarm or other part inside the event: its lines are not the event's.
      depth++
      continue
    }
    if (upper.startsWith('END:') && depth > 0) {
      depth--
      continue
    }
    if (upper === 'END:VEVENT') {
      readEvent(current, options.today, events, skipped)
      current = null
      continue
    }
    if (depth > 0) continue
    const property = parseLine(line)
    if (property) current.push(property)
  }
  if (current !== null) throw new IcsReadError(t('errors:icsRead.unfinished'))
  events.sort((a, b) => compareIsoDates(a.firstDate, b.firstDate) || a.name.localeCompare(b.name))
  return { events, skipped }
}

function readEvent(
  properties: Property[],
  today: string,
  events: IcsAllDayEvent[],
  skipped: IcsSkippedEvent[]
): void {
  const find = (name: string) => properties.find((property) => property.name === name)
  const summary = find('SUMMARY')
  const name = summary ? unescapeText(summary.value) : ''
  const shownName = name || t('errors:icsRead.untitled')
  const start = find('DTSTART')
  if (!start) {
    skipped.push({ name: shownName, reason: 'no-date' })
    return
  }
  if (!isDateOnly(start)) {
    skipped.push({ name: shownName, reason: 'timed' })
    return
  }
  const firstDate = dateValue(start.value)
  if (!firstDate) {
    skipped.push({ name: shownName, reason: 'no-date' })
    return
  }
  // DTEND is exclusive: the day after the last day. Without one, a single day.
  const end = find('DTEND')
  let lastDate = firstDate
  if (end) {
    const endDate = isDateOnly(end) ? dateValue(end.value) : null
    if (!endDate) {
      skipped.push({ name: shownName, reason: 'timed' })
      return
    }
    const before = shiftIsoDate(endDate, -1)
    lastDate = compareIsoDates(before, firstDate) < 0 ? firstDate : before
  }
  const uid = find('UID')?.value.trim().slice(0, 255) || null
  const event: IcsAllDayEvent = { uid, name: shownName, firstDate, lastDate }
  const repeat = find('RRULE')
  if (!repeat) {
    events.push(event)
    return
  }
  // Exceptions and extra dates change a repeat in ways this reader does not follow.
  const rule = find('EXDATE') || find('RDATE') ? null : yearlyRule(repeat.value)
  if (!rule) {
    skipped.push({ name: shownName, reason: 'repeat' })
    return
  }
  events.push(...expandYearly(event, rule, today))
}

// ─── Reading a whole calendar (N3.3a) ───────────────────────────────────────

/** The biggest calendar file read as a calendar beside tasks, in bytes of text. */
export const MAX_CALENDAR_BYTES = 25 * 1024 * 1024
/** The most events one calendar file may hold. */
export const MAX_CALENDAR_EVENTS = 50_000
/** The longest unfolded line read in a calendar (a long description). */
const MAX_CALENDAR_LINE_LENGTH = 100_000
const MAX_TITLE = 200
const MAX_LOCATION = 200
const MAX_TIME_ZONES = 200

/** An event read from a calendar file, before it belongs to a calendar. */
export type IcsCalendarEvent = Omit<CalendarEventRecord, 'id' | 'calendarId'>

export interface IcsCalendarRead {
  events: IcsCalendarEvent[]
  timeZones: IcsTimeZone[]
  /** Events kept, events left out (no date, cancelled), repeats shown once. */
  readCount: number
  skippedCount: number
  shownOnceCount: number
}

interface Component {
  name: string
  properties: Property[]
  children: Component[]
}

/** TEXT unescaped, keeping line breaks (a description). */
function unescapeLongText(value: string, max: number): string {
  const text = value
    .replace(/\\[nN]/g, '\n')
    .replace(/\\([\\;,])/g, '$1')
    .replace(/\r/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return [...text].slice(0, max).join('')
}

function oneLine(value: string, max: number): string {
  return [...unescapeLongText(value, max * 2).replace(/\s+/g, ' ')].slice(0, max).join('')
}

/** The file's components, as a tree; counts events as it goes. */
function components(lines: string[]): Component {
  const root: Component = { name: 'ROOT', properties: [], children: [] }
  const stack: Component[] = [root]
  let events = 0
  for (const line of lines) {
    const upper = line.trim().toUpperCase()
    if (upper.startsWith('BEGIN:')) {
      const name = upper.slice(6)
      if (name === 'VEVENT' && ++events > MAX_CALENDAR_EVENTS)
        throw new IcsReadError(t('errors:icsRead.tooManyCalendarEvents'))
      if (stack.length > 8) throw new IcsReadError(t('errors:icsRead.notCalendar'))
      const child: Component = { name, properties: [], children: [] }
      stack[stack.length - 1].children.push(child)
      stack.push(child)
      continue
    }
    if (upper.startsWith('END:')) {
      if (stack.length > 1) stack.pop()
      continue
    }
    const property = parseLine(line)
    if (property && stack.length > 1) stack[stack.length - 1].properties.push(property)
  }
  if (stack.length > 1) throw new IcsReadError(t('errors:icsRead.unfinished'))
  return root
}

function readTimeZone(component: Component): IcsTimeZone | null {
  const id = component.properties.find((property) => property.name === 'TZID')?.value.trim()
  if (!id) return null
  const observances: IcsObservance[] = []
  for (const part of component.children) {
    if (part.name !== 'STANDARD' && part.name !== 'DAYLIGHT') continue
    const find = (name: string) => part.properties.find((property) => property.name === name)
    const offsetFrom = parseOffset(find('TZOFFSETFROM')?.value ?? '')
    const offsetTo = parseOffset(find('TZOFFSETTO')?.value ?? '')
    const start = parseWall(find('DTSTART')?.value ?? '')
    if (offsetFrom === null || offsetTo === null || !start) continue
    const rdates = part.properties
      .filter((property) => property.name === 'RDATE')
      .flatMap((property) => property.value.split(','))
      .map((value) => parseWall(value))
      .filter((value): value is NonNullable<typeof value> => value !== null)
      .slice(0, 400)
      .map((value) => wallKey(value.wall))
    observances.push({
      offsetFrom,
      offsetTo,
      start: wallKey(start.wall),
      rrule: find('RRULE')?.value.trim() ?? null,
      rdates
    })
  }
  return observances.length > 0
    ? { id: id.slice(0, 255), observances: observances.slice(0, 50) }
    : null
}

/** An iCalendar DURATION (`P1D`, `PT1H30M`, `P2W`) in milliseconds, or null. */
function durationMs(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim().toUpperCase()
  )
  if (!match) return null
  const [, sign, w, d, h, m, s] = match
  const total =
    Number(w ?? 0) * 7 * DAY_MS +
    Number(d ?? 0) * DAY_MS +
    Number(h ?? 0) * 3_600_000 +
    Number(m ?? 0) * 60_000 +
    Number(s ?? 0) * 1000
  return sign === '-' ? null : total
}

interface WallValue {
  wall: number
  utc: boolean
  dateOnly: boolean
  zone: string | null
}

function wallValue(property: Property | undefined): WallValue | null {
  if (!property) return null
  const parsed = parseWall(property.value)
  if (!parsed) return null
  const dateOnly = parsed.dateOnly || property.params.VALUE?.toUpperCase() === 'DATE'
  return {
    ...parsed,
    dateOnly,
    zone: parsed.utc ? 'UTC' : (property.params.TZID?.trim().slice(0, 255) ?? null)
  }
}

/** A wall time written in one zone, as a key in another (the series' own). */
function keyIn(
  value: WallValue,
  zone: string | null,
  allDay: boolean,
  context: ZoneContext
): string {
  if (allDay || value.dateOnly) return wallDate(value.wall)
  if (value.zone === zone) return wallKey(value.wall)
  return wallKey(utcToWall(wallToUtc(value.wall, value.zone, context), zone, context))
}

/**
 * Reads a calendar file's events for showing beside tasks: timed and all-day
 * events, their time zones (an IANA name, or the file's own VTIMEZONE), their
 * repeat rules (expanded later by `expand-events.ts`), EXDATEs and overrides
 * by RECURRENCE-ID. Cancelled events are left out; a cancelled override is
 * kept so it hides its occurrence. A repeat whose rule uses anything this
 * reader does not follow, or that has RDATEs, is kept as one event and
 * counted in `shownOnceCount`. `timeZone` is the person's IANA zone, for
 * floating times. Throws `IcsReadError` for a file that is too big, has
 * too many events or long lines, or is not a calendar at all. Nothing in the
 * file is followed: a URL or an attachment is only text.
 */
export function readIcsCalendar(text: string, options: { timeZone: string }): IcsCalendarRead {
  if (typeof text !== 'string') throw new IcsReadError(t('errors:icsRead.notCalendar'))
  if (text.length > MAX_CALENDAR_BYTES) throw new IcsReadError(t('errors:icsRead.calendarTooBig'))
  const lines = unfold(text.replace(/^\uFEFF/, ''), MAX_CALENDAR_LINE_LENGTH)
  const root = components(lines)
  const calendars = root.children.filter((component) => component.name === 'VCALENDAR')
  if (calendars.length === 0) throw new IcsReadError(t('errors:icsRead.notCalendar'))

  const zones = new Map<string, IcsTimeZone>()
  for (const calendar of calendars)
    for (const component of calendar.children)
      if (component.name === 'VTIMEZONE' && zones.size < MAX_TIME_ZONES) {
        const zone = readTimeZone(component)
        if (zone) zones.set(zone.id, zone)
      }
  const context: ZoneContext = { zones, local: options.timeZone }

  const events: IcsCalendarEvent[] = []
  const recurrenceValues = new Map<IcsCalendarEvent, WallValue>()
  let skippedCount = 0
  let shownOnceCount = 0
  for (const calendar of calendars) {
    for (const component of calendar.children) {
      if (component.name !== 'VEVENT') continue
      const all = component.properties
      const find = (name: string) => all.find((property) => property.name === name)
      const start = wallValue(find('DTSTART'))
      if (!start) {
        skippedCount++
        continue
      }
      const recurrence = wallValue(find('RECURRENCE-ID'))
      const cancelled = find('STATUS')?.value.trim().toUpperCase() === 'CANCELLED'
      if (cancelled && !recurrence) {
        skippedCount++
        continue
      }
      const allDay = start.dateOnly
      const zone = allDay ? null : start.zone
      let end = start.wall + (allDay ? DAY_MS : 0)
      const dtend = wallValue(find('DTEND'))
      const durationProperty = find('DURATION')
      const duration = durationProperty ? durationMs(durationProperty.value) : null
      if (dtend) {
        const endWall =
          dtend.zone === zone || allDay
            ? dtend.wall
            : utcToWall(wallToUtc(dtend.wall, dtend.zone, context), zone, context)
        if (endWall > start.wall) end = allDay ? Math.floor(endWall / DAY_MS) * DAY_MS : endWall
      } else if (duration !== null && duration > 0) {
        end = start.wall + duration
      }
      if (allDay && end <= start.wall) end = start.wall + DAY_MS
      let rrule = find('RRULE')?.value.trim() ?? null
      const hasRdate = !!find('RDATE')
      if (rrule && (hasRdate || !parseRRule(rrule))) {
        shownOnceCount++
        rrule = null
      } else if (!rrule && hasRdate) {
        shownOnceCount++
      }
      const exdates = rrule
        ? all
            .filter((property) => property.name === 'EXDATE')
            .flatMap((property) =>
              property.value.split(',').map((value) => wallValue({ ...property, value }))
            )
            .filter((value): value is WallValue => value !== null)
            .slice(0, 5000)
            .map((value) => keyIn(value, zone, allDay, context))
        : []
      const summary = find('SUMMARY')
      const event: IcsCalendarEvent = {
        uid: find('UID')?.value.trim().slice(0, 255) || null,
        recurrenceId: null,
        title: (summary && oneLine(summary.value, MAX_TITLE)) || t('errors:icsRead.untitled'),
        location: oneLine(find('LOCATION')?.value ?? '', MAX_LOCATION),
        description: unescapeLongText(find('DESCRIPTION')?.value ?? '', MAX_EVENT_DESCRIPTION),
        start: allDay ? wallDate(start.wall) : wallKey(start.wall),
        end: allDay ? wallDate(end) : wallKey(end),
        allDay,
        timeZone: zone,
        rrule,
        exdates,
        cancelled
      }
      if (recurrence) recurrenceValues.set(event, recurrence)
      events.push(event)
    }
  }

  // An override names its occurrence in its own zone: key it in its series' zone.
  const masters = new Map<string, IcsCalendarEvent>()
  for (const event of events)
    if (event.uid && !recurrenceValues.has(event)) masters.set(event.uid, event)
  for (const [event, value] of recurrenceValues) {
    const master = event.uid ? masters.get(event.uid) : undefined
    event.recurrenceId = master
      ? keyIn(value, master.timeZone, master.allDay, context)
      : keyIn(value, event.timeZone, event.allDay, context)
  }

  return {
    events,
    timeZones: [...zones.values()],
    readCount: events.filter((event) => !event.cancelled).length,
    skippedCount,
    shownOnceCount
  }
}
