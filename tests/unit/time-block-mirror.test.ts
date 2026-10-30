import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectedAccount, TimeBlock } from '../../src/shared/ostler-api'
import { TimeBlockMirror } from '../../electron/services/accounts/time-block-mirror'
import { AccountCallError } from '../../electron/services/accounts/account-fetch'
import { mergeCalendars } from '../../electron/services/accounts/account-calendars'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const account = (provider: ConnectedAccount['provider']): ConnectedAccount => ({
  id: 'a1',
  provider,
  label: 'ann@example.com',
  server: null,
  capabilities: ['calendar.read', 'calendar.write'],
  status: 'connected',
  failure: null,
  createdAt: 1,
  lastUsedAt: null
})

const block = (id: string, overrides: Partial<TimeBlock> = {}): TimeBlock => ({
  id,
  projectId: 'p1',
  workItemId: `t-${id}`,
  date: '2026-10-23',
  startMinute: 9 * 60,
  lengthMinutes: 60,
  createdAt: 1,
  title: 'Write the brief',
  status: 'ready',
  ...overrides
})

describe('time blocks copied into an account calendar (integrations phase 6)', () => {
  const root = useTempDir('ostler-block-mirror-')
  let databasePath: string
  let blocks: TimeBlock[]
  let mirror: TimeBlockMirror
  let callJson: ReturnType<typeof vi.fn>
  let call: ReturnType<typeof vi.fn>

  const make = (provider: ConnectedAccount['provider']) => {
    let next = 1
    callJson = vi.fn(async (_id: string, _url: string, init?: { method?: string }) =>
      init?.method === 'POST' ? { id: `e${next++}` } : {}
    )
    call = vi.fn(async () => ({ status: 204, headers: { get: () => '"etag-1"' }, text: '' }))
    mirror = new TimeBlockMirror(databasePath, {
      accounts: {
        get: () => account(provider),
        list: () => [account(provider)],
        call,
        callJson,
        serverOf: () => 'https://dav.example.com/'
      } as never,
      blocks: () => blocks,
      today: () => '2026-10-23',
      projectName: () => 'Launch',
      now: () => 1000
    })
  }

  beforeEach(async () => {
    databasePath = await createMigratedDatabase(root())
    blocks = [block('b1')]
  })

  afterEach(() => {
    mirror.close()
  })

  it('creates a Google event once, updates it when the block moves, and deletes it when the block goes', async () => {
    make('google')
    await mirror.setTarget({ accountId: 'a1', remoteId: 'primary', name: 'Work' })
    await mirror.sync()
    expect(callJson).toHaveBeenCalledTimes(1)
    const [, url, init] = callJson.mock.calls[0]
    expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({
      summary: 'Write the brief',
      start: { dateTime: new Date(2026, 9, 23, 9, 0).toISOString() },
      end: { dateTime: new Date(2026, 9, 23, 10, 0).toISOString() },
      extendedProperties: { private: { ostlerBlock: 'b1' } }
    })

    await mirror.sync()
    expect(callJson).toHaveBeenCalledTimes(1)

    blocks = [block('b1', { startMinute: 14 * 60 })]
    await mirror.sync()
    expect(callJson.mock.calls[1][1]).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/e1'
    )
    expect(callJson.mock.calls[1][2].method).toBe('PATCH')

    blocks = []
    await mirror.sync()
    expect(call).toHaveBeenCalledWith(
      'a1',
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/e1',
      { method: 'DELETE' }
    )
    expect(mirror.target()).toMatchObject({ name: 'Work', syncedAt: 1000, failure: null })
  })

  it('marks Graph events and records a sign-in that expired', async () => {
    make('microsoft')
    await mirror.setTarget({ accountId: 'a1', remoteId: 'cal-1', name: 'Calendar' })
    callJson.mockRejectedValueOnce(new AccountCallError('expired', 401))
    await mirror.sync()
    expect(mirror.target()).toMatchObject({ failure: 'expired' })
    await mirror.sync()
    const [, url, init] = callJson.mock.calls[1]
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/calendars/cal-1/events')
    expect(JSON.parse(init.body)).toMatchObject({
      subject: 'Write the brief',
      showAs: 'busy',
      transactionId: 'ostler-block-b1',
      start: { timeZone: 'UTC' }
    })
    expect(mirror.target()?.failure).toBeNull()
  })

  it('writes a CalDAV resource Ostler owns, and stopping deletes it', async () => {
    make('caldav')
    await mirror.setTarget({
      accountId: 'a1',
      remoteId: 'https://dav.example.com/cal/work/',
      name: 'Work'
    })
    await mirror.sync()
    const [, url, init] = call.mock.calls[0]
    expect(url).toBe('https://dav.example.com/cal/work/ostler-block-b1.ics')
    expect(init.method).toBe('PUT')
    expect(init.body).toContain('UID:ostler-block-b1@ostler')
    await mirror.clearTarget()
    expect(call).toHaveBeenLastCalledWith(
      'a1',
      'https://dav.example.com/cal/work/ostler-block-b1.ics',
      {
        method: 'DELETE'
      }
    )
    expect(mirror.target()).toBeNull()
  })

  it('refuses an account that cannot write calendars', async () => {
    make('google')
    const readOnly = { ...account('google'), capabilities: ['calendar.read'] }
    ;(mirror as unknown as { deps: { accounts: { list: () => unknown[] } } }).deps.accounts.list =
      () => [readOnly]
    await expect(
      mirror.setTarget({ accountId: 'a1', remoteId: 'primary', name: 'Work' })
    ).rejects.toThrow()
  })

  it('reading a CalDAV calendar back leaves the copied blocks out', () => {
    const resource = (uid: string) =>
      ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', `UID:${uid}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
    const merged = mergeCalendars([resource('meeting-1'), resource('ostler-block-b1@ostler')])
    expect(merged).toContain('UID:meeting-1')
    expect(merged).not.toContain('ostler-block-')
  })
})
