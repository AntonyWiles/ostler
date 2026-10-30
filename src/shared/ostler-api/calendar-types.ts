// ─── Calendar files beside tasks (N3.3a, decision N26) ──────────────────────

import type { IcsTimeZone } from '../calendar/ics-time'

export type { IcsTimeZone, IcsObservance } from '../calendar/ics-time'

/**
 * An outside calendar: an `.ics` file the person added in Settings, shown
 * read-only beside tasks. Global, like people and days off. Ostler reads the
 * file only when it is added or reloaded, and never copies it.
 */
export interface OutsideCalendar {
  id: string
  name: string
  /** A label colour from the palette (`PROJECT_COLORS`). */
  color: string
  /** `link` (N3.3b): a private calendar address Ostler fetches on a schedule. */
  kind: OutsideCalendarKind
  /** The file it was read from, or null when its text came through the automation API (or for a link). */
  path: string | null
  hidden: boolean
  /** When its events were last read, ms. */
  loadedAt: number
  /** Events read, events left out (no date, cancelled), and repeats shown once (a rule Ostler does not follow). */
  readCount: number
  skippedCount: number
  shownOnceCount: number
  createdAt: number
  updatedAt: number
  /**
   * A link calendar's address, shortened for display ("outlook.office365.com/…/calendar.ics").
   * The full address never leaves the main process. Absent or null for a file.
   */
  linkShown?: string | null
  /** When a fetch last succeeded (a 304 counts), ms; null before the first. */
  fetchedAt?: number | null
  /** Why the last try failed, or null when it worked. */
  failure?: CalendarLinkFailure | null
  failedAt?: number | null
  /** `account` (integrations phase 1): the connected account it is read from. */
  accountId?: string | null
}

export type OutsideCalendarKind = 'file' | 'link' | 'account'

/**
 * Why fetching a calendar link failed, shown in plain words. Never carries
 * the address or the raw error text.
 * - `unreachable`: no answer, or the connection failed
 * - `timeout`: no answer in 30 seconds
 * - `refused`: the server said no (401, 403, 404, 410): the link may no longer be shared
 * - `server`: any other bad answer
 * - `tooBig`: more than 20 MB
 * - `notCalendar`: the answer is not a calendar Ostler can read
 * - `notHttps`: the address, or a redirect, was not https
 * - `redirects`: more than three redirects
 * - `pasteAgain`: this computer cannot open the saved link (a backup from another PC)
 */
export type CalendarLinkFailure =
  | 'unreachable'
  | 'timeout'
  | 'refused'
  | 'server'
  | 'tooBig'
  | 'notCalendar'
  | 'notHttps'
  | 'redirects'
  | 'pasteAgain'
  | 'signInAgain'

export interface AddCalendarLinkInput {
  /** An `https://` or `webcal://` address. A secret: never returned. */
  link: string
  name: string
  color?: string
}

/**
 * An event as the file gives it. `start` and `end` are wall times in
 * `timeZone` (`YYYY-MM-DDTHH:mm:ss`), or dates (`YYYY-MM-DD`) for an all-day
 * event, whose `end` is the day after its last day. `timeZone` is a TZID
 * ("Europe/London", "GMT Standard Time"), "UTC", or null for a floating
 * time (the person's own zone). Repeats are expanded when read.
 */
export interface CalendarEventRecord {
  id: string
  calendarId: string
  uid: string | null
  /** For an override of one occurrence: that occurrence's start, as a wall time in its series' zone. */
  recurrenceId: string | null
  title: string
  location: string
  /** Plain text, at most 2,000 characters. Never shown as HTML. */
  description: string
  start: string
  end: string
  allDay: boolean
  timeZone: string | null
  /** The RRULE as written, or null for a single event (or a rule shown once). */
  rrule: string | null
  /** EXDATEs, as wall times (or dates) in the event's zone. */
  exdates: string[]
  /** A cancelled override: it removes its occurrence. */
  cancelled: boolean
}

/** One occurrence of an event, in the person's time zone. */
export interface CalendarOccurrence {
  /** Unique within a range: the event's id and the occurrence's start. */
  id: string
  eventId: string
  calendarId: string
  title: string
  location: string
  description: string
  allDay: boolean
  /** Local dates it covers, inclusive (a timed event past midnight covers both days). */
  startDate: string
  endDate: string
  /** `HH:mm` local, or null for an all-day event. */
  startTime: string | null
  endTime: string | null
  /** Instants, ms; for an all-day event, local midnight of its first day and the day after its last. */
  start: number
  end: number
}

/** What reading a calendar file found. */
export interface CalendarFilePreview {
  fileName: string
  readCount: number
  skippedCount: number
  shownOnceCount: number
}

/** A file chosen in the open dialog. Main keeps its text; the renderer gets the path and counts. */
export interface ChosenCalendarFile extends CalendarFilePreview {
  path: string
}

export interface AddCalendarFileInput {
  /** A path chosen in this session's open dialog. */
  path: string
  name: string
  color?: string
}

export interface AddCalendarTextInput {
  name: string
  /** The `.ics` text. Untrusted data. */
  text: string
  color?: string
}

export interface UpdateCalendarInput {
  name?: string
  color?: string
  hidden?: boolean
}

export interface CalendarEventsQuery {
  /** `YYYY-MM-DD`, inclusive, in the person's time zone. */
  from: string
  to: string
  /** Leave out for every shown calendar. */
  calendarId?: string
  /** The person's IANA time zone; the computer's by default. */
  timeZone?: string
}

/** A calendar and its time zones, as kept. */
export interface StoredCalendar extends OutsideCalendar {
  timeZones: IcsTimeZone[]
  /** A link calendar's address, encrypted (`encryptApiKey`); null for a file. Main only. */
  linkSecret?: string | null
  etag?: string | null
  lastModified?: string | null
  /** An account calendar's id at its provider (a CalDAV calendar's address). Main only. */
  accountCalendar?: string | null
}

/** A calendar a connected account has, as Add from an account lists it. */
export interface AccountCalendarChoice {
  /** The provider's id for it; passed back to add it. */
  remoteId: string
  name: string
  /** `#rrggbb` when the provider says, else null. */
  color: string | null
  /** Already added here. */
  added: boolean
}

export interface AddAccountCalendarInput {
  accountId: string
  remoteId: string
  name: string
  color?: string
}

/** The longest name a calendar may have. */
export const MAX_CALENDAR_NAME = 80
/** The longest description kept. */
export const MAX_EVENT_DESCRIPTION = 2000
/** The widest range one events query may ask for, in days. */
export const MAX_EVENTS_RANGE_DAYS = 400
