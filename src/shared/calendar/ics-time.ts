import { DAY_MS, expandRule, parseRRule, parseWall } from './ics-rrule'

/*
 * Time zones for calendar events (N3.3a), with no dependency (decision N4).
 * A TZID that is an IANA name ("Europe/London") is read through `Intl`;
 * otherwise the file's own VTIMEZONE gives the offsets from its STANDARD and
 * DAYLIGHT parts and their rules, as Outlook writes Windows names ("GMT
 * Standard Time"). "UTC" is UTC, and a floating time (no zone) is the
 * person's own time zone. Pure, apart from `Intl`.
 */

/** One STANDARD or DAYLIGHT part of a VTIMEZONE. Offsets in minutes east of UTC. */
export interface IcsObservance {
  offsetFrom: number
  offsetTo: number
  /** Its DTSTART, as wall time `YYYY-MM-DDTHH:mm:ss` in the offset it starts from. */
  start: string
  rrule: string | null
  /** RDATEs, as wall times like `start`. */
  rdates: string[]
}

/** A VTIMEZONE from a calendar file, kept with its calendar. */
export interface IcsTimeZone {
  id: string
  observances: IcsObservance[]
}

/** How a zone is resolved: by name, through the file's own zones, with a fallback zone. */
export interface ZoneContext {
  zones: ReadonlyMap<string, IcsTimeZone>
  /** The person's IANA time zone, for floating times and unknown names. */
  local: string
}

const formats = new Map<string, Intl.DateTimeFormat | null>()

function formatFor(zone: string): Intl.DateTimeFormat | null {
  let format = formats.get(zone)
  if (format === undefined) {
    try {
      format = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    } catch {
      format = null
    }
    formats.set(zone, format)
  }
  return format
}

/** Whether `Intl` knows this zone name. */
export function isIanaZone(zone: string): boolean {
  return (
    /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$|^UTC$|^Etc\/[A-Za-z0-9+-]+$/.test(zone) &&
    formatFor(zone) !== null
  )
}

/** The person's own IANA zone, from the system. */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** An IANA zone's offset from UTC at an instant, in minutes. */
export function ianaOffset(utc: number, zone: string): number {
  const format = formatFor(zone)
  if (!format) return 0
  const parts: Record<string, number> = {}
  for (const part of format.formatToParts(new Date(utc)))
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute,
    parts.second
  )
  return Math.round((wall - Math.floor(utc / 1000) * 1000) / 60_000)
}

/** `+0100`, `-0500` or `+053000` as minutes. */
export function parseOffset(value: string): number | null {
  const match = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(value.trim())
  if (!match) return null
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

const onsetCache = new WeakMap<IcsTimeZone, Map<number, { at: number; offset: number }[]>>()

/** A VTIMEZONE's changes during a year: when (as UTC) and the offset after each, in order. */
function onsets(zone: IcsTimeZone, year: number): { at: number; offset: number }[] {
  let byYear = onsetCache.get(zone)
  if (!byYear) onsetCache.set(zone, (byYear = new Map()))
  const cached = byYear.get(year)
  if (cached) return cached
  const from = Date.UTC(year, 0, 1) - 2 * DAY_MS
  const to = Date.UTC(year + 1, 0, 1) + 2 * DAY_MS
  const list: { at: number; offset: number }[] = []
  for (const observance of zone.observances) {
    const start = parseWall(observance.start.replace(/[-:]/g, ''))
    if (!start) continue
    const walls: number[] = []
    const rule = observance.rrule ? parseRRule(observance.rrule) : null
    if (rule) walls.push(...expandRule(rule, start.wall, { from, to }))
    else if (start.wall >= from && start.wall <= to) walls.push(start.wall)
    for (const rdate of observance.rdates) {
      const parsed = parseWall(rdate.replace(/[-:]/g, ''))
      if (parsed && parsed.wall >= from && parsed.wall <= to) walls.push(parsed.wall)
    }
    for (const wall of walls)
      list.push({ at: wall - observance.offsetFrom * 60_000, offset: observance.offsetTo })
  }
  list.sort((a, b) => a.at - b.at)
  byYear.set(year, list)
  return list
}

/** A VTIMEZONE's offset at an instant, in minutes. */
function vtimezoneOffset(zone: IcsTimeZone, utc: number): number {
  const year = new Date(utc).getUTCFullYear()
  for (const candidate of [year, year - 1]) {
    const list = onsets(zone, candidate)
    for (let index = list.length - 1; index >= 0; index--)
      if (list[index].at <= utc) return list[index].offset
  }
  // Before any change the file describes: the earliest part's offset before it.
  const earliest = [...zone.observances].sort((a, b) => a.start.localeCompare(b.start))[0]
  return earliest ? earliest.offsetFrom : 0
}

/** A zone's offset at an instant: UTC, an IANA name, the file's VTIMEZONE, else the person's zone. */
export function offsetAt(utc: number, zone: string | null, context: ZoneContext): number {
  if (zone === 'UTC') return 0
  if (zone) {
    if (isIanaZone(zone)) return ianaOffset(utc, zone)
    const own = context.zones.get(zone)
    if (own) return vtimezoneOffset(own, utc)
  }
  return ianaOffset(utc, context.local)
}

/**
 * A wall time in a zone as an instant. A wall time that a clock change skips
 * moves forward with the change; one that happens twice is the first.
 */
export function wallToUtc(wall: number, zone: string | null, context: ZoneContext): number {
  if (zone === 'UTC') return wall
  const first = offsetAt(wall, zone, context)
  let utc = wall - first * 60_000
  const second = offsetAt(utc, zone, context)
  if (second !== first) {
    const retry = wall - second * 60_000
    // The wall time exists under the second offset: use it; otherwise it was skipped.
    utc = offsetAt(retry, zone, context) === second ? retry : wall - first * 60_000
  }
  return utc
}

/** An instant as wall time in a zone. */
export function utcToWall(utc: number, zone: string | null, context: ZoneContext): number {
  return utc + offsetAt(utc, zone, context) * 60_000
}
