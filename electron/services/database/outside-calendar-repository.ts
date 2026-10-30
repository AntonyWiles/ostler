import type Database from 'better-sqlite3'
import type {
  CalendarEventRecord,
  CalendarLinkFailure,
  IcsTimeZone,
  StoredCalendar
} from '@shared/ostler-api'

interface CalendarRow {
  id: string
  name: string
  color: string
  kind: string
  path: string | null
  hidden: number
  loaded_at: number
  read_count: number
  skipped_count: number
  shown_once_count: number
  time_zones: string
  removed_at: number | null
  created_at: number
  updated_at: number
  link_secret: string | null
  link_shown: string | null
  etag: string | null
  last_modified: string | null
  fetched_at: number | null
  failed_at: number | null
  failure: string | null
  account_id: string | null
  account_calendar: string | null
}

const FAILURES: ReadonlySet<string> = new Set<CalendarLinkFailure>([
  'unreachable',
  'timeout',
  'refused',
  'server',
  'tooBig',
  'notCalendar',
  'notHttps',
  'redirects',
  'pasteAgain',
  'signInAgain'
])

interface EventRow {
  id: string
  calendar_id: string
  uid: string | null
  recurrence_id: string | null
  title: string
  location: string
  description: string
  start_at: string
  end_at: string
  all_day: number
  time_zone: string | null
  rrule: string | null
  exdates: string
  cancelled: number
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    const value = JSON.parse(text) as unknown
    return Array.isArray(value) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

function toCalendar(row: CalendarRow): StoredCalendar {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    kind: row.kind === 'link' || row.kind === 'account' ? row.kind : 'file',
    path: row.path,
    hidden: row.hidden === 1,
    loadedAt: row.loaded_at,
    readCount: row.read_count,
    skippedCount: row.skipped_count,
    shownOnceCount: row.shown_once_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    timeZones: parseJson<IcsTimeZone[]>(row.time_zones, []),
    linkSecret: row.link_secret,
    linkShown: row.link_shown,
    etag: row.etag,
    lastModified: row.last_modified,
    fetchedAt: row.fetched_at,
    failedAt: row.failed_at,
    failure: row.failure && FAILURES.has(row.failure) ? (row.failure as CalendarLinkFailure) : null,
    accountId: row.account_id,
    accountCalendar: row.account_calendar
  }
}

function toEvent(row: EventRow): CalendarEventRecord {
  return {
    id: row.id,
    calendarId: row.calendar_id,
    uid: row.uid,
    recurrenceId: row.recurrence_id,
    title: row.title,
    location: row.location,
    description: row.description,
    start: row.start_at,
    end: row.end_at,
    allDay: row.all_day === 1,
    timeZone: row.time_zone,
    rrule: row.rrule,
    exdates: parseJson<string[]>(row.exdates, []),
    cancelled: row.cancelled === 1
  }
}

/** A link or account calendar's columns, in table order (all null for a file). */
function linkValues(calendar: StoredCalendar): (string | number | null)[] {
  return [
    calendar.linkSecret ?? null,
    calendar.linkShown ?? null,
    calendar.etag ?? null,
    calendar.lastModified ?? null,
    calendar.fetchedAt ?? null,
    calendar.failedAt ?? null,
    calendar.failure ?? null,
    calendar.accountId ?? null,
    calendar.accountCalendar ?? null
  ]
}

/** An event with the days it can touch, for range queries. */
export interface EventWithBounds extends CalendarEventRecord {
  firstDate: string
  lastDate: string | null
}

/**
 * The `outside_calendars` and `outside_calendar_events` tables (N3.3a;
 * global, like days off). Plain reads and writes; the rules are
 * `OutsideCalendarService`'s.
 */
export class OutsideCalendarRepository {
  constructor(private readonly db: Database.Database) {}

  list(): StoredCalendar[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM outside_calendars WHERE removed_at IS NULL ORDER BY name COLLATE NOCASE, id'
      )
      .all() as CalendarRow[]
    return rows.map(toCalendar)
  }

  /** A calendar, removed or not. */
  get(id: string): (StoredCalendar & { removed: boolean }) | null {
    const row = this.db.prepare('SELECT * FROM outside_calendars WHERE id = ?').get(id) as
      CalendarRow | undefined
    return row ? { ...toCalendar(row), removed: row.removed_at !== null } : null
  }

  insert(calendar: StoredCalendar): void {
    this.db
      .prepare(
        `INSERT INTO outside_calendars (id, name, color, kind, path, hidden, loaded_at, read_count,
           skipped_count, shown_once_count, time_zones, removed_at, created_at, updated_at,
           link_secret, link_shown, etag, last_modified, fetched_at, failed_at, failure,
           account_id, account_calendar)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        calendar.id,
        calendar.name,
        calendar.color,
        calendar.kind,
        calendar.path,
        calendar.hidden ? 1 : 0,
        calendar.loadedAt,
        calendar.readCount,
        calendar.skippedCount,
        calendar.shownOnceCount,
        JSON.stringify(calendar.timeZones),
        calendar.createdAt,
        calendar.updatedAt,
        ...linkValues(calendar)
      )
  }

  update(calendar: StoredCalendar): void {
    this.db
      .prepare(
        `UPDATE outside_calendars SET name = ?, color = ?, path = ?, hidden = ?, loaded_at = ?,
           read_count = ?, skipped_count = ?, shown_once_count = ?, time_zones = ?, updated_at = ?,
           link_secret = ?, link_shown = ?, etag = ?, last_modified = ?, fetched_at = ?,
           failed_at = ?, failure = ?, account_id = ?, account_calendar = ?
         WHERE id = ?`
      )
      .run(
        calendar.name,
        calendar.color,
        calendar.path,
        calendar.hidden ? 1 : 0,
        calendar.loadedAt,
        calendar.readCount,
        calendar.skippedCount,
        calendar.shownOnceCount,
        JSON.stringify(calendar.timeZones),
        calendar.updatedAt,
        ...linkValues(calendar),
        calendar.id
      )
  }

  setRemoved(id: string, removedAt: number | null): void {
    this.db.prepare('UPDATE outside_calendars SET removed_at = ? WHERE id = ?').run(removedAt, id)
  }

  /** Clears removed calendars for good (their events go with them). */
  purgeRemoved(): number {
    return this.db.prepare('DELETE FROM outside_calendars WHERE removed_at IS NOT NULL').run()
      .changes
  }

  replaceEvents(calendarId: string, events: readonly EventWithBounds[]): void {
    this.db.prepare('DELETE FROM outside_calendar_events WHERE calendar_id = ?').run(calendarId)
    const insert = this.db.prepare(
      `INSERT INTO outside_calendar_events (id, calendar_id, uid, recurrence_id, title, location,
         description, start_at, end_at, all_day, time_zone, rrule, exdates, cancelled, first_date, last_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const event of events)
      insert.run(
        event.id,
        calendarId,
        event.uid,
        event.recurrenceId,
        event.title,
        event.location,
        event.description,
        event.start,
        event.end,
        event.allDay ? 1 : 0,
        event.timeZone,
        event.rrule,
        JSON.stringify(event.exdates),
        event.cancelled ? 1 : 0,
        event.firstDate,
        event.lastDate
      )
  }

  /**
   * The events of live calendars that can touch `from`..`to`, and every
   * override (an override hides its occurrence wherever it moved), in one
   * query. Hidden calendars only when asked for by id.
   */
  eventsBetween(from: string, to: string, calendarId?: string): CalendarEventRecord[] {
    const rows = this.db
      .prepare(
        `SELECT e.* FROM outside_calendar_events e
         JOIN outside_calendars c ON c.id = e.calendar_id
         WHERE c.removed_at IS NULL
           AND ${calendarId ? 'c.id = ?' : 'c.hidden = 0'}
           AND ((e.first_date <= ? AND (e.last_date IS NULL OR e.last_date >= ?))
                OR e.recurrence_id IS NOT NULL)`
      )
      .all(...(calendarId ? [calendarId] : []), to, from) as EventRow[]
    return rows.map(toEvent)
  }
}
