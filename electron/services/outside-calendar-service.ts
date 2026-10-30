import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  MAX_CALENDAR_NAME,
  MAX_EVENTS_RANGE_DAYS,
  type AddAccountCalendarInput,
  type AddCalendarLinkInput,
  type AddCalendarTextInput,
  type CalendarLinkFailure,
  type CalendarEventsQuery,
  type CalendarFilePreview,
  type CalendarOccurrence,
  type OutsideCalendar,
  type StoredCalendar,
  type UpdateCalendarInput
} from '@shared/ostler-api'
import { compareIsoDates, isIsoDate, isoDaysBetween, shiftIsoDate } from '@shared/dates'
import { readIcsCalendar, type IcsCalendarRead } from '@shared/import/ics-read'
import { expandCalendarEvents } from '@shared/calendar/expand-events'
import { DAY_MS, parseRRule, wallDate, wallFromKey } from '@shared/calendar/ics-rrule'
import { isIanaZone, systemTimeZone } from '@shared/calendar/ics-time'
import { PROJECT_COLORS, isHexColor } from '@shared/project-colors'
import { t } from '@shared/i18n'
import { Refusal } from '@shared/refusal'
import {
  OutsideCalendarRepository,
  type EventWithBounds
} from './database/outside-calendar-repository'
import {
  CalendarLinkError,
  normaliseCalendarLink,
  shortenCalendarLink,
  type CalendarLinkConditions,
  type CalendarLinkResult
} from './calendar-link-fetch'

export interface OutsideCalendarServiceDependencies {
  /** Reads a calendar file the person chose, after a size check. Main only. */
  readFile(path: string): string
  /** The person's IANA time zone; the computer's by default. */
  timeZone?(): string
  now?(): number
  /**
   * Calendar links (N3.3b). `sealLink` encrypts a link for the database
   * (`encryptApiKey`: it throws when Windows cannot encrypt, so the link is
   * not saved); `openLink` decrypts it (throws on another computer).
   * `fetchLink` is `fetchCalendarLink` in the app and a stub in tests.
   */
  sealLink?(link: string): string
  openLink?(secret: string): string
  fetchLink?(link: string, conditions: CalendarLinkConditions): Promise<CalendarLinkResult>
  /**
   * After the fetch that showing a hidden link calendar starts: the Calendar
   * and Settings read again (`update` itself answers before it finishes).
   */
  onShownFetched?(): void
  /**
   * Account calendars (integrations phase 1): one calendar's events from
   * `from` to `to` as iCalendar text. A failure is a `CalendarLinkError`
   * with its reason (`signInAgain` when the account must sign in again).
   */
  accountCalendarText?(accountId: string, remoteId: string, from: Date, to: Date): Promise<string>
  /** What Settings shows for the account: "Google · ann@example.com". */
  accountLabel?(accountId: string): string | null
}

/** Days an account calendar keeps before and after today. */
const ACCOUNT_PAST_DAYS = 60
const ACCOUNT_FUTURE_DAYS = 365

/** A calendar as callers see it: its stored time zones and link stay inside. */
function shown(calendar: StoredCalendar): OutsideCalendar {
  const { timeZones, linkSecret, etag, lastModified, accountCalendar, ...rest } = calendar
  return rest
}

/** A link failure in plain words, for an error the person sees. */
export function calendarLinkFailureText(reason: CalendarLinkFailure): string {
  return t(`errors:calendarLinks.failure.${reason}`)
}

/**
 * Outside calendars (N3.3a, decision N26): `.ics` files whose events show
 * read-only beside tasks. Every surface (IPC, the automation API) goes
 * through here. A file is read only when it is added or reloaded; reloading
 * replaces that calendar's events and nothing else. Events never become
 * work by themselves, and never reach search, exports or the project file:
 * nothing outside this service and its repository reads their tables.
 * Removing a calendar can be undone until Ostler next starts.
 */
export class OutsideCalendarService {
  private readonly db: Database.Database
  private readonly repository: OutsideCalendarRepository
  /** Link fetches run one after another, never at once. */
  private queue: Promise<unknown> = Promise.resolve()
  private readonly pending = new Map<string, Promise<OutsideCalendar>>()

  constructor(
    dbPath: string,
    private readonly deps: OutsideCalendarServiceDependencies
  ) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.repository = new OutsideCalendarRepository(this.db)
    // A removal is undoable only while Ostler runs.
    this.repository.purgeRemoved()
  }

  close(): void {
    this.db.close()
  }

  list(): OutsideCalendar[] {
    return this.repository.list().map(shown)
  }

  get(id: string): OutsideCalendar {
    return shown(this.require(id))
  }

  /** What a file holds, without adding it. */
  preview(text: string, fileName = ''): CalendarFilePreview {
    const read = this.read(text)
    return {
      fileName,
      readCount: read.readCount,
      skippedCount: read.skippedCount,
      shownOnceCount: read.shownOnceCount
    }
  }

  /** Adds a calendar from a file the person chose; its path is kept for Reload. */
  addFile(input: { path: string; name: string; color?: string }): OutsideCalendar {
    if (typeof input?.path !== 'string' || !input.path)
      throw new Error(t('errors:outsideCalendars.needsFile'))
    return this.add(
      { name: input.name, color: input.color, text: this.deps.readFile(input.path) },
      input.path
    )
  }

  /** Adds a calendar from `.ics` text (the automation API); it has no path to reload from. */
  addText(input: AddCalendarTextInput): OutsideCalendar {
    return this.add(input, null)
  }

  /** Reads the calendar's file again and replaces its events. */
  reload(id: string): OutsideCalendar {
    const calendar = this.require(id)
    if (calendar.kind !== 'file') throw new Refusal(t('errors:calendarLinks.useRefresh'))
    if (!calendar.path) throw new Error(t('errors:outsideCalendars.noFile'))
    return this.replace(calendar, this.deps.readFile(calendar.path))
  }

  /** Replaces a calendar's events from new `.ics` text. */
  replaceText(id: string, text: string): OutsideCalendar {
    const calendar = this.require(id)
    if (calendar.kind !== 'file') throw new Refusal(t('errors:calendarLinks.useRefresh'))
    return this.replace(calendar, text)
  }

  /**
   * Subscribes to a calendar link (N3.3b): checks the name, colour and
   * address, encrypts the address (refused when Windows cannot), fetches it
   * once and adds the calendar only if what came back is a calendar.
   */
  async addLink(input: AddCalendarLinkInput): Promise<OutsideCalendar> {
    const name = this.name(input?.name)
    const color = input?.color === undefined ? this.nextColor() : this.color(input.color)
    const link = normaliseCalendarLink(input?.link)
    const secret = this.seal(link)
    const fetched = await this.enqueue(() => this.fetchFresh(link))
    const read = this.readFetched(fetched.text)
    const now = this.now()
    const calendar: StoredCalendar = {
      id: uuidv4(),
      name,
      color,
      kind: 'link',
      path: null,
      hidden: false,
      loadedAt: now,
      readCount: read.readCount,
      skippedCount: read.skippedCount,
      shownOnceCount: read.shownOnceCount,
      createdAt: now,
      updatedAt: now,
      timeZones: read.timeZones,
      linkSecret: secret,
      linkShown: shortenCalendarLink(link),
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      fetchedAt: now,
      failedAt: null,
      failure: null
    }
    this.db.transaction(() => {
      this.repository.insert(calendar)
      this.repository.replaceEvents(calendar.id, this.withBounds(read))
    })()
    return shown(calendar)
  }

  /**
   * Adds a calendar from a connected account (integrations phase 1): reads
   * its events once and adds it only if that worked. The same account
   * calendar can be added once.
   */
  async addAccountCalendar(input: AddAccountCalendarInput): Promise<OutsideCalendar> {
    const name = this.name(input?.name)
    const color = input?.color === undefined ? this.nextColor() : this.color(input.color)
    if (typeof input?.accountId !== 'string' || typeof input?.remoteId !== 'string') {
      throw new Refusal(t('errors:outsideCalendars.notFound'))
    }
    if (this.addedFromAccount(input.accountId).includes(input.remoteId)) {
      throw new Refusal(t('errors:outsideCalendars.alreadyAdded'))
    }
    const text = await this.enqueue(async () => {
      try {
        return await this.accountText(input.accountId, input.remoteId)
      } catch (error) {
        throw new Refusal(
          calendarLinkFailureText(error instanceof CalendarLinkError ? error.reason : 'unreachable')
        )
      }
    })
    const read = this.readFetched(text)
    const now = this.now()
    const calendar: StoredCalendar = {
      id: uuidv4(),
      name,
      color,
      kind: 'account',
      path: null,
      hidden: false,
      loadedAt: now,
      readCount: read.readCount,
      skippedCount: read.skippedCount,
      shownOnceCount: read.shownOnceCount,
      createdAt: now,
      updatedAt: now,
      timeZones: read.timeZones,
      linkSecret: null,
      linkShown: this.deps.accountLabel?.(input.accountId) ?? null,
      etag: null,
      lastModified: null,
      fetchedAt: now,
      failedAt: null,
      failure: null,
      accountId: input.accountId,
      accountCalendar: input.remoteId
    }
    this.db.transaction(() => {
      this.repository.insert(calendar)
      this.repository.replaceEvents(calendar.id, this.withBounds(read))
    })()
    return shown(calendar)
  }

  /** The provider ids of an account's calendars already added here. */
  addedFromAccount(accountId: string): string[] {
    return this.repository
      .list()
      .filter((calendar) => calendar.kind === 'account' && calendar.accountId === accountId)
      .map((calendar) => calendar.accountCalendar ?? '')
  }

  /**
   * Replaces a link calendar's address. The new one is fetched first and
   * kept only if it works; the old link and events stay otherwise.
   */
  async replaceLink(id: string, link: unknown): Promise<OutsideCalendar> {
    const current = this.requireLink(id)
    const address = normaliseCalendarLink(link)
    const secret = this.seal(address)
    const fetched = await this.enqueue(() => this.fetchFresh(address))
    const read = this.readFetched(fetched.text)
    const latest = this.requireLink(current.id)
    const now = this.now()
    return this.store(
      {
        ...latest,
        linkSecret: secret,
        linkShown: shortenCalendarLink(address),
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        fetchedAt: now,
        failedAt: null,
        failure: null
      },
      read
    )
  }

  /**
   * Fetches a link calendar now, asking only for what changed since the last
   * fetch. A failure keeps the last events and is recorded on the calendar
   * with its reason; it is not thrown. A refresh already waiting for this
   * calendar is shared.
   */
  refresh(id: string): Promise<OutsideCalendar> {
    const calendar = this.requireFetched(id)
    const waiting = this.pending.get(calendar.id)
    if (waiting) return waiting
    const run = this.enqueue(() => this.refreshNow(calendar.id)).finally(() =>
      this.pending.delete(calendar.id)
    )
    this.pending.set(calendar.id, run)
    return run
  }

  /**
   * Whether any shown calendar is a link: with none, the schedule fetches
   * nothing. A hidden link is paused until it is shown again.
   */
  hasLinks(): boolean {
    return this.repository.list().some((calendar) => calendar.kind !== 'file' && !calendar.hidden)
  }

  /**
   * Fetches every shown link calendar, one after another (the schedule's
   * pass). A hidden one is skipped, as is one hidden or removed while the
   * pass waited its turn.
   */
  async refreshLinks(): Promise<number> {
    let count = 0
    for (const calendar of this.repository.list()) {
      if (calendar.kind === 'file') continue
      const latest = this.repository.get(calendar.id)
      if (!latest || latest.removed || latest.hidden) continue
      try {
        await this.refresh(calendar.id)
        count += 1
      } catch {
        // Removed meanwhile: nothing to record.
      }
    }
    return count
  }

  update(id: string, updates: UpdateCalendarInput): OutsideCalendar {
    const current = this.require(id)
    const next: StoredCalendar = {
      ...current,
      name: updates?.name === undefined ? current.name : this.name(updates.name),
      color: updates?.color === undefined ? current.color : this.color(updates.color),
      hidden: updates?.hidden === undefined ? current.hidden : updates.hidden === true,
      updatedAt: this.now()
    }
    this.repository.update(next)
    // A hidden link was not fetched; showing it fetches it at once, then hourly as before.
    if (current.kind !== 'file' && current.hidden && !next.hidden) this.fetchShown(id)
    return shown(next)
  }

  /** Removes a calendar; `restore` puts it back until Ostler next starts. */
  remove(id: string): OutsideCalendar {
    const calendar = this.require(id)
    this.repository.setRemoved(id, this.now())
    return shown(calendar)
  }

  restore(id: string): OutsideCalendar {
    if (typeof id !== 'string' || !id) throw new Error(t('errors:outsideCalendars.notFound'))
    const calendar = this.repository.get(id)
    if (!calendar) throw new Error(t('errors:outsideCalendars.notFound'))
    this.repository.setRemoved(id, null)
    return shown(calendar)
  }

  /**
   * The occurrences between two dates in the person's time zone: one query
   * for the range, then repeats expanded for that range only.
   */
  events(query: CalendarEventsQuery): CalendarOccurrence[] {
    if (!isIsoDate(query?.from) || !isIsoDate(query?.to))
      throw new Error(t('errors:outsideCalendars.badRange'))
    if (compareIsoDates(query.to, query.from) < 0)
      throw new Error(t('errors:outsideCalendars.badRange'))
    if (isoDaysBetween(query.from, query.to) > MAX_EVENTS_RANGE_DAYS)
      throw new Error(t('errors:outsideCalendars.rangeTooWide', { max: MAX_EVENTS_RANGE_DAYS }))
    if (query.calendarId !== undefined) this.require(query.calendarId)
    const timeZone =
      typeof query.timeZone === 'string' && isIanaZone(query.timeZone)
        ? query.timeZone
        : this.timeZone()
    // A day either side, for events written in other zones.
    const events = this.repository.eventsBetween(
      shiftIsoDate(query.from, -1),
      shiftIsoDate(query.to, 1),
      query.calendarId
    )
    if (events.length === 0) return []
    const zones = new Map(
      this.repository.list().map((calendar) => [calendar.id, calendar.timeZones])
    )
    return expandCalendarEvents(events, {
      from: query.from,
      to: query.to,
      timeZone,
      zonesFor: (calendarId) => zones.get(calendarId) ?? []
    })
  }

  private add(input: AddCalendarTextInput, path: string | null): OutsideCalendar {
    const name = this.name(input?.name)
    const color = input?.color === undefined ? this.nextColor() : this.color(input.color)
    const read = this.read(typeof input?.text === 'string' ? input.text : '')
    const now = this.now()
    const calendar: StoredCalendar = {
      id: uuidv4(),
      name,
      color,
      kind: 'file',
      path,
      hidden: false,
      loadedAt: now,
      readCount: read.readCount,
      skippedCount: read.skippedCount,
      shownOnceCount: read.shownOnceCount,
      createdAt: now,
      updatedAt: now,
      timeZones: read.timeZones
    }
    this.db.transaction(() => {
      this.repository.insert(calendar)
      this.repository.replaceEvents(calendar.id, this.withBounds(read))
    })()
    return shown(calendar)
  }

  private replace(current: StoredCalendar, text: string): OutsideCalendar {
    const read = this.read(text)
    const now = this.now()
    const next: StoredCalendar = {
      ...current,
      loadedAt: now,
      readCount: read.readCount,
      skippedCount: read.skippedCount,
      shownOnceCount: read.shownOnceCount,
      timeZones: read.timeZones,
      updatedAt: now
    }
    this.db.transaction(() => {
      this.repository.update(next)
      this.repository.replaceEvents(current.id, this.withBounds(read))
    })()
    return shown(next)
  }

  private async refreshNow(id: string): Promise<OutsideCalendar> {
    // Read again: it may have changed or gone while it waited its turn.
    const calendar = this.requireFetched(id)
    if (calendar.kind === 'account') return this.refreshAccount(calendar)
    let link: string
    try {
      if (!calendar.linkSecret) throw new Error('No link stored')
      link = this.openLink(calendar.linkSecret)
    } catch {
      // A backup restored on another computer cannot open the link.
      return this.failed(calendar, 'pasteAgain')
    }
    let fetched: CalendarLinkResult
    try {
      fetched = await this.fetch(link, { etag: calendar.etag, lastModified: calendar.lastModified })
    } catch (error) {
      return this.failed(
        this.requireLink(id),
        error instanceof CalendarLinkError ? error.reason : 'unreachable'
      )
    }
    const latest = this.requireLink(id)
    const now = this.now()
    if (fetched.notModified) {
      const next: StoredCalendar = { ...latest, fetchedAt: now, failedAt: null, failure: null }
      this.repository.update(next)
      return shown(next)
    }
    let read: IcsCalendarRead
    try {
      read = this.read(fetched.text)
    } catch {
      return this.failed(latest, 'notCalendar')
    }
    return this.store(
      {
        ...latest,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
        fetchedAt: now,
        failedAt: null,
        failure: null
      },
      read
    )
  }

  /** Reads an account calendar's events again; a failure keeps the last ones. */
  private async refreshAccount(calendar: StoredCalendar): Promise<OutsideCalendar> {
    let text: string
    try {
      if (!calendar.accountId || !calendar.accountCalendar) {
        throw new CalendarLinkError('signInAgain')
      }
      text = await this.accountText(calendar.accountId, calendar.accountCalendar)
    } catch (error) {
      return this.failed(
        this.requireFetched(calendar.id),
        error instanceof CalendarLinkError ? error.reason : 'unreachable'
      )
    }
    const latest = this.requireFetched(calendar.id)
    let read: IcsCalendarRead
    try {
      read = this.read(text)
    } catch {
      return this.failed(latest, 'notCalendar')
    }
    return this.store(
      {
        ...latest,
        linkShown: this.deps.accountLabel?.(calendar.accountId ?? '') ?? latest.linkShown,
        fetchedAt: this.now(),
        failedAt: null,
        failure: null
      },
      read
    )
  }

  private accountText(accountId: string, remoteId: string): Promise<string> {
    if (!this.deps.accountCalendarText) {
      return Promise.reject(new CalendarLinkError('signInAgain'))
    }
    const now = this.now()
    return this.deps.accountCalendarText(
      accountId,
      remoteId,
      new Date(now - ACCOUNT_PAST_DAYS * DAY_MS),
      new Date(now + ACCOUNT_FUTURE_DAYS * DAY_MS)
    )
  }

  /** The fetch that showing a hidden link starts; it records its own failure. */
  private fetchShown(id: string): void {
    this.refresh(id)
      .catch(() => undefined) // Removed meanwhile: nothing to record.
      .then(() => this.deps.onShownFetched?.())
      .catch(() => undefined)
  }

  /** Records why a fetch failed; the calendar's events stay as they were. */
  private failed(calendar: StoredCalendar, reason: CalendarLinkFailure): OutsideCalendar {
    const next: StoredCalendar = { ...calendar, failedAt: this.now(), failure: reason }
    this.repository.update(next)
    return shown(next)
  }

  /** Saves a calendar with new events, in one transaction. */
  private store(calendar: StoredCalendar, read: IcsCalendarRead): OutsideCalendar {
    const now = this.now()
    const next: StoredCalendar = {
      ...calendar,
      loadedAt: now,
      readCount: read.readCount,
      skippedCount: read.skippedCount,
      shownOnceCount: read.shownOnceCount,
      timeZones: read.timeZones,
      updatedAt: now
    }
    this.db.transaction(() => {
      this.repository.update(next)
      this.repository.replaceEvents(calendar.id, this.withBounds(read))
    })()
    return shown(next)
  }

  /** A first fetch (add or replace): a failure is an error in plain words. */
  private async fetchFresh(
    link: string
  ): Promise<{ text: string; etag: string | null; lastModified: string | null }> {
    let fetched: CalendarLinkResult
    try {
      fetched = await this.fetch(link, {})
    } catch (error) {
      throw new Refusal(
        calendarLinkFailureText(error instanceof CalendarLinkError ? error.reason : 'unreachable')
      )
    }
    // No conditions were sent, so a 304 is a confused server.
    if (fetched.notModified) throw new Refusal(calendarLinkFailureText('server'))
    return fetched
  }

  private fetch(link: string, conditions: CalendarLinkConditions): Promise<CalendarLinkResult> {
    if (!this.deps.fetchLink) return Promise.reject(new CalendarLinkError('unreachable'))
    return this.deps.fetchLink(link, conditions)
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private seal(link: string): string {
    if (!this.deps.sealLink) throw new Refusal(t('errors:calendarLinks.cannotEncrypt'))
    try {
      return this.deps.sealLink(link)
    } catch {
      throw new Refusal(t('errors:calendarLinks.cannotEncrypt'))
    }
  }

  private openLink(secret: string): string {
    if (!this.deps.openLink) throw new Error('Links cannot be opened here')
    return this.deps.openLink(secret)
  }

  private requireLink(id: string): StoredCalendar {
    const calendar = this.require(id)
    if (calendar.kind !== 'link') throw new Refusal(t('errors:calendarLinks.notLink'))
    return calendar
  }

  /** A calendar Ostler fetches on its schedule: a link or an account calendar. */
  private requireFetched(id: string): StoredCalendar {
    const calendar = this.require(id)
    if (calendar.kind === 'file') throw new Refusal(t('errors:calendarLinks.notLink'))
    return calendar
  }

  /** What a link gave, read as a file is; anything else is "not a calendar". */
  private readFetched(text: string): IcsCalendarRead {
    try {
      return this.read(text)
    } catch {
      throw new Refusal(calendarLinkFailureText('notCalendar'))
    }
  }

  private read(text: string): IcsCalendarRead {
    return readIcsCalendar(typeof text === 'string' ? text : '', { timeZone: this.timeZone() })
  }

  /** Each event with the days it can touch: a day either side for time zones. */
  private withBounds(read: IcsCalendarRead): EventWithBounds[] {
    return read.events.map((event) => {
      const firstDate = shiftIsoDate(event.start.slice(0, 10), -1)
      const endDate = event.end.slice(0, 10)
      let lastDate: string | null = shiftIsoDate(endDate, 1)
      if (event.rrule) {
        const rule = parseRRule(event.rrule)
        const length = Math.max(0, wallFromKey(event.end) - wallFromKey(event.start))
        // A repeat with an end is bounded by it; one with only a COUNT or no end is open.
        lastDate =
          rule && rule.until !== null
            ? shiftIsoDate(wallDate(rule.until + length + DAY_MS), 2)
            : null
      }
      return { ...event, id: uuidv4(), calendarId: '', firstDate, lastDate }
    })
  }

  private require(id: string): StoredCalendar {
    if (typeof id !== 'string' || !id) throw new Error(t('errors:outsideCalendars.notFound'))
    const calendar = this.repository.get(id)
    if (!calendar || calendar.removed) throw new Error(t('errors:outsideCalendars.notFound'))
    const { removed, ...rest } = calendar
    return rest
  }

  private name(value: unknown): string {
    if (typeof value !== 'string' || !value.trim())
      throw new Error(t('errors:outsideCalendars.needsName'))
    const name = value.trim().replace(/\s+/g, ' ')
    if ([...name].length > MAX_CALENDAR_NAME)
      throw new Error(t('errors:outsideCalendars.nameTooLong', { max: MAX_CALENDAR_NAME }))
    return name
  }

  private color(value: unknown): string {
    if (!isHexColor(value) || !PROJECT_COLORS.includes(value.toLowerCase()))
      throw new Error(t('errors:outsideCalendars.badColor'))
    return value.toLowerCase()
  }

  /** The next palette colour after the ones in use. */
  private nextColor(): string {
    const used = new Set(this.repository.list().map((calendar) => calendar.color))
    return (
      PROJECT_COLORS.find((color) => !used.has(color)) ??
      PROJECT_COLORS[used.size % PROJECT_COLORS.length]
    )
  }

  private timeZone(): string {
    const zone = this.deps.timeZone?.() ?? systemTimeZone()
    return isIanaZone(zone) ? zone : 'UTC'
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }
}
