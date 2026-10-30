import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutsideCalendarService } from '../../electron/services/outside-calendar-service'
import { CalendarLinkError } from '../../electron/services/calendar-link-fetch'
import {
  accountCalendarIcs,
  listAccountCalendars,
  mergeCalendars,
  vEvent
} from '../../electron/services/accounts/account-calendars'
import { isMeetingLink, meetingLink } from '../../src/shared/calendar/meeting-link'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const ics = (title: string) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:e1',
    `SUMMARY:${title}`,
    'DTSTART:20261021T130000Z',
    'DTEND:20261021T140000Z',
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n')

describe('meeting links (integrations phase 1)', () => {
  it('finds Teams, Zoom and Meet links, and nothing else', () => {
    expect(meetingLink('Room 4', 'Join: https://teams.microsoft.com/l/meetup-join/abc.')).toBe(
      'https://teams.microsoft.com/l/meetup-join/abc'
    )
    expect(meetingLink('https://acme.zoom.us/j/123', '')).toBe('https://acme.zoom.us/j/123')
    expect(meetingLink('', 'see https://meet.google.com/abc-defg-hij')).toBe(
      'https://meet.google.com/abc-defg-hij'
    )
    expect(meetingLink('', 'https://zoom.us.evil.example/j/1 http://zoom.us/j/1')).toBeNull()
    expect(isMeetingLink('https://zoom.us/')).toBe(false)
    expect(isMeetingLink('https://user:pw@zoom.us/j/1')).toBe(false)
  })
})

describe('account calendars as iCalendar', () => {
  it('writes a VEVENT, escaping text, with all-day dates', () => {
    expect(
      vEvent({
        uid: 'x@google',
        title: 'Plan, review; ship',
        location: '',
        description: 'line 1\nline 2',
        start: { date: '2026-10-21' },
        end: { date: '2026-10-22' }
      })
    ).toBe(
      [
        'BEGIN:VEVENT',
        'UID:x@google',
        'DTSTART;VALUE=DATE:20261021',
        'DTEND;VALUE=DATE:20261022',
        'SUMMARY:Plan\\, review\\; ship',
        'DESCRIPTION:line 1\\nline 2',
        'END:VEVENT'
      ].join('\r\n')
    )
    expect(vEvent({ uid: 'u', title: '', location: '', description: '', start: {}, end: {} })).toBe(
      null
    )
  })

  it('merges CalDAV resources, keeping each time zone once', () => {
    const zone = ['BEGIN:VTIMEZONE', 'TZID:Europe/London', 'END:VTIMEZONE']
    const resource = (uid: string) =>
      [
        'BEGIN:VCALENDAR',
        ...zone,
        'BEGIN:VEVENT',
        `UID:${uid}`,
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\r\n')
    const merged = mergeCalendars([resource('a'), resource('b')])
    expect(merged.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1)
    expect(merged.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(merged.indexOf('VTIMEZONE')).toBeLessThan(merged.indexOf('VEVENT'))
  })

  it('reads Google events page by page, with the Meet link first', async () => {
    const callJson = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            id: 'g1',
            summary: 'Stand-up',
            start: { dateTime: '2026-10-21T09:00:00+13:00' },
            end: { dateTime: '2026-10-21T09:15:00+13:00' },
            hangoutLink: 'https://meet.google.com/abc-defg-hij'
          },
          { id: 'g2', status: 'cancelled', start: {}, end: {} }
        ],
        nextPageToken: 'p2'
      })
      .mockResolvedValueOnce({ items: [] })
    const accounts = {
      get: () => ({ provider: 'google' as const }),
      call: vi.fn(),
      callJson,
      serverOf: () => null
    }
    const text = await accountCalendarIcs(
      accounts as never,
      'a1',
      'me@example.com',
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-11-01T00:00:00Z')
    )
    expect(callJson).toHaveBeenCalledTimes(2)
    expect(String(callJson.mock.calls[1][1])).toContain('pageToken=p2')
    expect(text).toContain('DTSTART:20261020T200000Z')
    expect(text).toContain('DESCRIPTION:https://meet.google.com/abc-defg-hij')
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1)
  })

  it('lists Microsoft calendars with their colours', async () => {
    const accounts = {
      get: () => ({ provider: 'microsoft' as const }),
      call: vi.fn(),
      callJson: vi.fn(async () => ({
        value: [{ id: 'c1', name: 'Calendar', hexColor: '#3366FF' }, { name: 'no id' }]
      })),
      serverOf: () => null
    }
    expect(await listAccountCalendars(accounts as never, 'a1')).toEqual([
      { remoteId: 'c1', name: 'Calendar', color: '#3366ff' }
    ])
  })
})

describe('OutsideCalendarService with account calendars', () => {
  const root = useTempDir('ostler-account-calendars-')
  let databasePath: string
  let service: OutsideCalendarService
  let accountCalendarText: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    databasePath = await createMigratedDatabase(root())
    accountCalendarText = vi.fn(async () => ics('Pangolin review'))
    service = new OutsideCalendarService(databasePath, {
      readFile: () => {
        throw new Error('no files')
      },
      timeZone: () => 'Europe/London',
      now: () => Date.parse('2026-10-17T09:00:00Z'),
      sealLink: (link) => link,
      openLink: (secret) => secret,
      fetchLink: vi.fn(),
      accountCalendarText,
      accountLabel: () => 'Google · ann@example.com'
    })
  })

  afterEach(() => {
    service.close()
  })

  it('adds an account calendar once, and refreshes it through the account', async () => {
    const calendar = await service.addAccountCalendar({
      accountId: 'a1',
      remoteId: 'primary',
      name: 'Work'
    })
    expect(calendar).toMatchObject({ kind: 'account', linkShown: 'Google · ann@example.com' })
    expect(calendar).not.toHaveProperty('accountCalendar')
    expect(service.events({ from: '2026-10-21', to: '2026-10-21' })[0].title).toBe(
      'Pangolin review'
    )
    expect(service.addedFromAccount('a1')).toEqual(['primary'])
    await expect(
      service.addAccountCalendar({ accountId: 'a1', remoteId: 'primary', name: 'Again' })
    ).rejects.toThrow(/already|alreadyAdded/)

    accountCalendarText.mockRejectedValueOnce(new CalendarLinkError('signInAgain'))
    const failed = await service.refresh(calendar.id)
    expect(failed.failure).toBe('signInAgain')
    expect(service.events({ from: '2026-10-21', to: '2026-10-21' })).toHaveLength(1)

    accountCalendarText.mockResolvedValueOnce(ics('Pangolin retro'))
    const fresh = await service.refresh(calendar.id)
    expect(fresh.failure).toBeNull()
    expect(service.events({ from: '2026-10-21', to: '2026-10-21' })[0].title).toBe('Pangolin retro')
  })

  it('adds nothing when the first read fails', async () => {
    accountCalendarText.mockRejectedValueOnce(new CalendarLinkError('refused'))
    await expect(
      service.addAccountCalendar({ accountId: 'a1', remoteId: 'x', name: 'Work' })
    ).rejects.toThrow()
    expect(service.list()).toEqual([])
  })
})
