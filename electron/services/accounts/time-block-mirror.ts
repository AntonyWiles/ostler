/**
 * Writing back, time blocks (docs/plans/integrations/overview.md, phase 6):
 * the person's time blocks copied as busy events into one calendar of a
 * connected account (Google, Microsoft 365 / Outlook.com or CalDAV), so
 * colleagues see the time as taken. Ostler stays the source: a block moved,
 * resized or removed here changes or deletes its event there; an event
 * changed there is put back as the block says the next time it is written.
 *
 * Only blocks from a week ago to 90 days ahead are copied. Each event carries
 * a mark (Google's private extended property, Graph's `transactionId`, a
 * CalDAV UID prefix) so reading that calendar back leaves them out: the
 * blocks already show as blocks. An event holds the task's title and
 * project name, nothing else.
 */
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import type { CalendarWriteTarget, TimeBlock } from '@shared/ostler-api'
import { shiftIsoDate } from '@shared/dates'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import type { ConnectedAccountsService } from './connected-accounts-service'
import { AccountCallError } from './account-fetch'
import { mirrorTargetHere } from './mirror-device'
import { thisDeviceId } from '../sync/sync-keys'
import { attachSyncCapture } from '../sync/capture'
import { davSend, vEvent } from './account-calendars'

/** The mark every copied event carries. */
export const BLOCK_MARK = 'ostler-block-'
const PAST_DAYS = 7
const FUTURE_DAYS = 90
const DEBOUNCE_MS = 5000

type Accounts = Pick<ConnectedAccountsService, 'get' | 'call' | 'callJson' | 'serverOf' | 'list'>

export interface TimeBlockMirrorDependencies {
  accounts: Accounts
  /** Blocks across every enabled project, `from` to `to` inclusive (local `YYYY-MM-DD`). */
  blocks(from: string, to: string): TimeBlock[]
  today(): string
  projectName(projectId: string): string | null
  /** After a sync or a change of calendar: Settings reads again. */
  changed?(): void
  now?(): number
}

interface TargetRow {
  account_id: string
  remote_calendar: string
  name: string
  synced_at: number | null
  failed_at: number | null
  failure: string | null
  /** The device that runs the write-back (mirror-device.ts). */
  device_id: string | null
}

interface EventRow {
  block_id: string
  remote_id: string
  etag: string | null
  hash: string
}

interface Desired {
  title: string
  description: string
  start: Date
  end: Date
}

export class TimeBlockMirror {
  private readonly db: Database.Database
  private readonly now: () => number
  private queue: Promise<unknown> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null

  constructor(
    dbPath: string,
    private readonly deps: TimeBlockMirrorDependencies
  ) {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    // The target rows sync to the other devices (settings follow the person, D18): their writes are captured here.
    attachSyncCapture(this.db)
    this.now = deps.now ?? Date.now
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.db.close()
  }

  /** The calendar blocks go to, or null. */
  target(): CalendarWriteTarget | null {
    const row = this.row()
    if (!row) return null
    return {
      accountId: row.account_id,
      name: row.name,
      syncedAt: row.synced_at,
      failedAt: row.failed_at,
      failure: (row.failure as CalendarWriteTarget['failure']) ?? null
    }
  }

  /** Puts blocks in this calendar from now on; the old calendar's copies are removed first. */
  async setTarget(input: { accountId: string; remoteId: string; name: string }): Promise<void> {
    const account = this.deps.accounts.list().find((entry) => entry.id === input?.accountId)
    if (!account || !account.capabilities.includes('calendar.write')) {
      throw new Refusal(t('errors:accounts.notAllowed'))
    }
    if (typeof input.remoteId !== 'string' || !input.remoteId) {
      throw new Refusal(t('errors:outsideCalendars.notFound'))
    }
    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : '—'
    await this.enqueue(async () => {
      await this.removeCopies()
      this.db.prepare('DELETE FROM calendar_write_target').run()
      this.db
        .prepare(
          `INSERT INTO calendar_write_target (id, account_id, remote_calendar, name, device_id)
           VALUES (1, ?, ?, ?, ?)`
        )
        .run(account.id, input.remoteId, name.slice(0, 200), thisDeviceId(this.db))
    })
    this.deps.changed?.()
    this.schedule(0)
  }

  /** Stops copying, and deletes the events Ostler wrote. */
  async clearTarget(): Promise<void> {
    await this.enqueue(async () => {
      await this.removeCopies()
      this.db.prepare('DELETE FROM calendar_write_target').run()
      this.db.prepare('DELETE FROM time_block_events').run()
    })
    this.deps.changed?.()
  }

  /** A sync soon: blocks change in bursts (a drag, a plan applied). */
  schedule(delay = DEBOUNCE_MS): void {
    if (!this.row()) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.sync()
    }, delay)
    this.timer.unref?.()
  }

  /** Writes what changed, deletes what is gone. Never throws; the failure is recorded. */
  sync(): Promise<void> {
    return this.enqueue(() => this.syncNow()).catch((error) =>
      console.error('Copying time blocks failed:', error)
    )
  }

  private async syncNow(): Promise<void> {
    const target = this.row()
    if (!target) return
    const today = this.deps.today()
    const blocks = this.deps.blocks(
      shiftIsoDate(today, -PAST_DAYS),
      shiftIsoDate(today, FUTURE_DAYS)
    )
    const wanted = new Map(blocks.map((block) => [block.id, block]))
    const written = new Map(
      (this.db.prepare('SELECT * FROM time_block_events').all() as EventRow[]).map((row) => [
        row.block_id,
        row
      ])
    )
    let failure: string | null = null
    const note = (error: unknown) => {
      if (!(error instanceof AccountCallError)) throw error
      failure ??= error.reason === 'expired' ? 'expired' : error.reason
    }

    for (const [blockId, row] of written) {
      if (wanted.has(blockId)) continue
      try {
        await this.remove(target, row)
        this.db.prepare('DELETE FROM time_block_events WHERE block_id = ?').run(blockId)
      } catch (error) {
        note(error)
      }
    }
    for (const block of blocks) {
      const desired = this.desired(block)
      const hash = createHash('sha256').update(JSON.stringify(desired)).digest('hex')
      const row = written.get(block.id)
      if (row?.hash === hash) continue
      try {
        const saved = await this.write(target, block.id, desired, row ?? null)
        this.db
          .prepare(
            `INSERT INTO time_block_events (block_id, remote_id, etag, hash, synced_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(block_id) DO UPDATE SET remote_id = excluded.remote_id,
               etag = excluded.etag, hash = excluded.hash, synced_at = excluded.synced_at`
          )
          .run(block.id, saved.remoteId, saved.etag, hash, this.now())
      } catch (error) {
        note(error)
        if (failure === 'expired') break
      }
    }
    const now = this.now()
    if (failure) {
      this.db
        .prepare('UPDATE calendar_write_target SET failed_at = ?, failure = ?')
        .run(now, failure)
    } else {
      this.db
        .prepare('UPDATE calendar_write_target SET synced_at = ?, failed_at = NULL, failure = NULL')
        .run(now)
    }
    this.deps.changed?.()
  }

  private desired(block: TimeBlock): Desired {
    const [year, month, day] = block.date.split('-').map(Number)
    const start = new Date(year, month - 1, day, 0, block.startMinute)
    const end = new Date(year, month - 1, day, 0, block.startMinute + block.lengthMinutes)
    const project = this.deps.projectName(block.projectId) ?? ''
    return {
      title: block.title,
      description: t('settings:calendarWrite.eventText', { title: block.title, project }),
      start,
      end
    }
  }

  private async write(
    target: TargetRow,
    blockId: string,
    desired: Desired,
    existing: EventRow | null
  ): Promise<{ remoteId: string; etag: string | null }> {
    const accounts = this.deps.accounts
    const provider = accounts.get(target.account_id).provider
    const calendar = encodeURIComponent(target.remote_calendar)
    if (provider === 'google') {
      const body = JSON.stringify({
        summary: desired.title,
        description: desired.description,
        start: { dateTime: desired.start.toISOString() },
        end: { dateTime: desired.end.toISOString() },
        transparency: 'opaque',
        extendedProperties: { private: { ostlerBlock: blockId } }
      })
      const base = `https://www.googleapis.com/calendar/v3/calendars/${calendar}/events`
      if (existing) {
        try {
          await accounts.callJson(
            target.account_id,
            `${base}/${encodeURIComponent(existing.remote_id)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body
            }
          )
          return { remoteId: existing.remote_id, etag: null }
        } catch (error) {
          // Deleted there: write it again.
          if (!gone(error)) throw error
        }
      }
      const made = await accounts.callJson<{ id?: string }>(target.account_id, base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      })
      if (!made.id) throw new AccountCallError('server')
      return { remoteId: made.id, etag: null }
    }
    if (provider === 'microsoft') {
      const fields = {
        subject: desired.title,
        body: { contentType: 'text', content: desired.description },
        start: { dateTime: utc(desired.start), timeZone: 'UTC' },
        end: { dateTime: utc(desired.end), timeZone: 'UTC' },
        showAs: 'busy',
        isReminderOn: false
      }
      if (existing) {
        try {
          await accounts.callJson(
            target.account_id,
            `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(existing.remote_id)}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(fields)
            }
          )
          return { remoteId: existing.remote_id, etag: null }
        } catch (error) {
          if (!gone(error)) throw error
        }
      }
      const made = await accounts.callJson<{ id?: string }>(
        target.account_id,
        `https://graph.microsoft.com/v1.0/me/calendars/${calendar}/events`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...fields, transactionId: `${BLOCK_MARK}${blockId}` })
        }
      )
      if (!made.id) throw new AccountCallError('server')
      return { remoteId: made.id, etag: null }
    }
    if (provider === 'caldav') {
      const url = existing?.remote_id ?? davEventUrl(target.remote_calendar, blockId)
      const event = vEvent({
        uid: `${BLOCK_MARK}${blockId}@ostler`,
        title: desired.title,
        location: '',
        description: desired.description,
        start: { dateTime: desired.start.toISOString() },
        end: { dateTime: desired.end.toISOString() }
      })
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Ostler//Time blocks//EN',
        event,
        'END:VCALENDAR',
        ''
      ].join('\r\n')
      // Ostler owns this resource: written whole, whatever is there.
      const response = await davSend(accounts, target.account_id)(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
        body: ics
      })
      return { remoteId: url, etag: response.headers.get('etag') }
    }
    throw new AccountCallError('refused')
  }

  private async remove(target: TargetRow, row: EventRow): Promise<void> {
    const accounts = this.deps.accounts
    const provider = accounts.get(target.account_id).provider
    const url =
      provider === 'google'
        ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.remote_calendar)}/events/${encodeURIComponent(row.remote_id)}`
        : provider === 'microsoft'
          ? `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(row.remote_id)}`
          : row.remote_id
    try {
      await accounts.call(target.account_id, url, { method: 'DELETE' })
    } catch (error) {
      if (!gone(error)) throw error
    }
  }

  /** Best effort: the events in the current calendar, before it changes or stops. */
  private async removeCopies(): Promise<void> {
    const target = this.row()
    if (!target) return
    const rows = this.db.prepare('SELECT * FROM time_block_events').all() as EventRow[]
    for (const row of rows) {
      try {
        await this.remove(target, row)
      } catch (error) {
        console.error(
          'Removing a copied time block failed:',
          error instanceof Error ? error.name : error
        )
      }
    }
    this.db.prepare('DELETE FROM time_block_events').run()
  }

  /** The target, when this device runs it (see mirror-device.ts); other devices see it and skip it. */
  private row(): TargetRow | null {
    const row =
      (this.db.prepare('SELECT * FROM calendar_write_target WHERE id = 1').get() as
        TargetRow | undefined) ?? null
    return mirrorTargetHere(this.db, 'calendar_write_target', row)
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => undefined)
    return next
  }
}

/** Gone there already: deleted by hand, or the calendar emptied. */
function gone(error: unknown): boolean {
  return error instanceof AccountCallError && (error.status === 404 || error.status === 410)
}

function utc(date: Date): string {
  return date.toISOString().slice(0, 19)
}

function davEventUrl(calendar: string, blockId: string): string {
  return `${calendar.endsWith('/') ? calendar : `${calendar}/`}${BLOCK_MARK}${blockId}.ics`
}
