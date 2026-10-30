import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import {
  MAX_DAY_OFF_NAME,
  MAX_DAY_OFF_SPAN_DAYS,
  type CreateDayOffInput,
  type DayOff,
  type DaysOffImportInput,
  type DaysOffImportResult,
  type DaysOffQuery,
  type UpdateDayOffInput
} from '@shared/ostler-api'
import { compareIsoDates, isIsoDate, isoDaysBetween, todayIsoDate } from '@shared/dates'
import { readIcs } from '@shared/import/ics-read'
import { t } from '@shared/i18n'
import { DaysOffRepository } from './database/days-off-repository'
import { attachChangeRecorder } from './change-history/recorder'

const MAX_FILE_NAME = 255
/** The most days off one restore (an undo) may put back. */
const MAX_RESTORE = 10_000

export interface DaysOffServiceDependencies {
  /** Whether a live or archived person has this id. */
  personExists(id: string): boolean
  /** Today, `YYYY-MM-DD`; the computer's local date by default. */
  today?(): string
}

/**
 * Days off (N3.2, decision N25): bank holidays for everyone and one person's
 * leave, shared by every project. Every surface (IPC, the automation API)
 * goes through here, so the rules are the same everywhere: a name, dates as
 * `YYYY-MM-DD` with the last day not before the first and at most a year
 * apart, and a person who exists (or nobody, for everyone). Archiving a
 * person keeps their days off. Importing a calendar file reads its all-day
 * events (`ics-read.ts`); loading a file with the same name again for the
 * same person (or for everyone again) replaces the days that came from it,
 * while the same name for someone else is another load and keeps both.
 */
export class DaysOffService {
  private readonly db: Database.Database
  private readonly repository: DaysOffRepository

  constructor(
    dbPath: string,
    private readonly deps: DaysOffServiceDependencies
  ) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    attachChangeRecorder(this.db)
    this.repository = new DaysOffRepository(this.db)
  }

  close(): void {
    this.db.close()
  }

  list(query: DaysOffQuery = {}): DayOff[] {
    const from = query?.from === undefined ? undefined : this.date(query.from)
    const to = query?.to === undefined ? undefined : this.date(query.to)
    const personId = query?.personId === undefined ? undefined : this.person(query.personId)
    return this.repository.list({ from, to, personId: personId ?? undefined })
  }

  get(id: string): DayOff {
    return this.require(id)
  }

  create(input: CreateDayOffInput): DayOff {
    const firstDate = this.date(input?.firstDate)
    const lastDate = input?.lastDate === undefined ? firstDate : this.date(input.lastDate)
    this.span(firstDate, lastDate)
    const now = Date.now()
    const day: DayOff = {
      id: uuidv4(),
      personId: this.person(input?.personId ?? null),
      firstDate,
      lastDate,
      name: this.name(input?.name),
      sourceFile: null,
      createdAt: now,
      updatedAt: now
    }
    this.repository.insert(day)
    return day
  }

  update(id: string, updates: UpdateDayOffInput): DayOff {
    const current = this.require(id)
    const firstDate =
      updates?.firstDate === undefined ? current.firstDate : this.date(updates.firstDate)
    const lastDate =
      updates?.lastDate === undefined
        ? updates?.firstDate === undefined || current.firstDate !== current.lastDate
          ? current.lastDate
          : firstDate
        : this.date(updates.lastDate)
    this.span(firstDate, lastDate)
    const day: DayOff = {
      ...current,
      personId: updates?.personId === undefined ? current.personId : this.person(updates.personId),
      firstDate,
      lastDate,
      name: updates?.name === undefined ? current.name : this.name(updates.name),
      updatedAt: Date.now()
    }
    this.repository.update(day)
    return day
  }

  /** Removes a day off and returns it, so the undo can put it back (`restore`). */
  remove(id: string): DayOff {
    const current = this.require(id)
    this.repository.delete(id)
    return current
  }

  /** Puts removed days off back as they were (the undo of a remove or an import). */
  restore(days: readonly DayOff[]): DayOff[] {
    if (!Array.isArray(days) || days.length > MAX_RESTORE)
      throw new Error(t('errors:daysOffService.notFound'))
    const checked = days.map((day) => {
      if (!day || typeof day.id !== 'string' || !day.id)
        throw new Error(t('errors:daysOffService.notFound'))
      const firstDate = this.date(day.firstDate)
      const lastDate = this.date(day.lastDate)
      this.span(firstDate, lastDate)
      return {
        id: day.id,
        personId: this.person(day.personId ?? null),
        firstDate,
        lastDate,
        name: this.name(day.name),
        sourceFile: day.sourceFile === null ? null : this.fileName(day.sourceFile),
        createdAt: Number.isFinite(day.createdAt) ? day.createdAt : Date.now(),
        updatedAt: Date.now()
      } satisfies DayOff
    })
    return this.db.transaction(() => {
      for (const day of checked) if (!this.repository.get(day.id)) this.repository.insert(day)
      return checked
    })()
  }

  /**
   * Reads a holiday calendar file into days off for everyone or one person.
   * With `dryRun` nothing changes and the result is the preview; otherwise
   * the days that came from a file of the same name for the same person (or
   * for everyone, again) are replaced, in one transaction. The same name for
   * a different person is a separate load: both are kept.
   */
  importFile(input: DaysOffImportInput, options: { dryRun?: boolean } = {}): DaysOffImportResult {
    const fileName = this.fileName(input?.fileName)
    const personId = this.person(input?.personId ?? null)
    const read = readIcs(typeof input?.text === 'string' ? input.text : '', {
      today: this.deps.today?.() ?? todayIsoDate()
    })
    const days = read.events.map((event) => ({
      firstDate: event.firstDate,
      lastDate:
        isoDaysBetween(event.firstDate, event.lastDate) >= MAX_DAY_OFF_SPAN_DAYS
          ? event.firstDate
          : event.lastDate,
      name: event.name
    }))
    const previous = this.repository.listFromFile(fileName, personId)
    const preview: DaysOffImportResult = {
      fileName,
      personId,
      days,
      replacedCount: previous.length,
      skipped: read.skipped,
      added: [],
      replaced: []
    }
    if (options.dryRun) return preview
    if (days.length === 0) throw new Error(t('errors:daysOffService.nothingToImport'))
    const now = Date.now()
    const added: DayOff[] = days.map((day) => ({
      id: uuidv4(),
      personId,
      ...day,
      sourceFile: fileName,
      createdAt: now,
      updatedAt: now
    }))
    this.db.transaction(() => {
      this.repository.deleteFromFile(fileName, personId)
      for (const day of added) this.repository.insert(day)
    })()
    return { ...preview, added, replaced: previous }
  }

  /**
   * Removes the days off that came from this file and returns them, for the
   * undo: one load of it (`personId` a person, or null for everyone's), or
   * every load of it when `personId` is left out.
   */
  removeFile(fileName: string, personId?: string | null): DayOff[] {
    const name = this.fileName(fileName)
    const person = personId === undefined ? undefined : this.loadPerson(personId)
    return this.db.transaction(() => {
      const removed = this.repository.listFromFile(name, person)
      this.repository.deleteFromFile(name, person)
      return removed
    })()
  }

  private require(id: string): DayOff {
    if (typeof id !== 'string' || !id) throw new Error(t('errors:daysOffService.notFound'))
    const day = this.repository.get(id)
    if (!day) throw new Error(t('errors:daysOffService.notFound'))
    return day
  }

  private name(value: unknown): string {
    if (typeof value !== 'string' || !value.trim())
      throw new Error(t('errors:daysOffService.needsName'))
    const name = value.trim().replace(/\s+/g, ' ')
    if ([...name].length > MAX_DAY_OFF_NAME)
      throw new Error(t('errors:daysOffService.nameTooLong', { max: MAX_DAY_OFF_NAME }))
    return name
  }

  private date(value: unknown): string {
    if (!isIsoDate(value)) throw new Error(t('errors:daysOffService.badDate'))
    return value
  }

  private span(firstDate: string, lastDate: string): void {
    if (compareIsoDates(lastDate, firstDate) < 0)
      throw new Error(t('errors:daysOffService.lastBeforeFirst'))
    if (isoDaysBetween(firstDate, lastDate) >= MAX_DAY_OFF_SPAN_DAYS)
      throw new Error(t('errors:daysOffService.tooLong', { max: MAX_DAY_OFF_SPAN_DAYS }))
  }

  /** A person id that exists, or null for everyone. */
  private person(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null
    if (typeof value !== 'string' || !this.deps.personExists(value))
      throw new Error(t('errors:daysOffService.personNotFound'))
    return value
  }

  /**
   * The person a load of a file is for, or null for everyone. A person
   * archived or removed since still names their own load, so this checks
   * the shape only.
   */
  private loadPerson(value: unknown): string | null {
    if (value === null || value === '') return null
    if (typeof value !== 'string') throw new Error(t('errors:daysOffService.personNotFound'))
    return value
  }

  /** The file's own name, without any folder. */
  private fileName(value: unknown): string {
    if (typeof value !== 'string') throw new Error(t('errors:daysOffService.needsFileName'))
    const name = value.split(/[\\/]/).pop()!.trim()
    if (!name) throw new Error(t('errors:daysOffService.needsFileName'))
    return [...name].slice(0, MAX_FILE_NAME).join('')
  }
}
