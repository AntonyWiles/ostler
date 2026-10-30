import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutsideCalendarService } from '../../electron/services/outside-calendar-service'
import {
  CalendarLinkError,
  type CalendarLinkConditions,
  type CalendarLinkResult
} from '../../electron/services/calendar-link-fetch'
import { MIGRATIONS, migrateOstlerDatabase } from '../../electron/services/database/migrations'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const LINK = 'https://calendar.example.test/ical/me/private-Pangolin42Secret/basic.ics'

const ics = (title: string, count = 1) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    ...Array.from({ length: count }, (_, index) => [
      'BEGIN:VEVENT',
      `UID:event-${index}`,
      `SUMMARY:${title}`,
      'DTSTART:20261021T130000Z',
      'DTEND:20261021T140000Z',
      'END:VEVENT'
    ]).flat(),
    'END:VCALENDAR',
    ''
  ].join('\r\n')

/** A stand-in for safeStorage: reversible, and never the plain text. */
const seal = (link: string) =>
  `ostler-secure:v1:${Buffer.from([...link].reverse().join('')).toString('base64')}`
const open = (secret: string) =>
  [...Buffer.from(secret.slice('ostler-secure:v1:'.length), 'base64').toString()].reverse().join('')

describe('calendar links (N3.3b)', () => {
  const root = useTempDir('ostler-calendar-links-')
  let databasePath: string
  let service: OutsideCalendarService
  let fetchLink: ReturnType<
    typeof vi.fn<(link: string, conditions: CalendarLinkConditions) => Promise<CalendarLinkResult>>
  >
  let now: number

  const make = (overrides: Partial<ConstructorParameters<typeof OutsideCalendarService>[1]> = {}) =>
    new OutsideCalendarService(databasePath, {
      readFile: () => {
        throw new Error('no files')
      },
      timeZone: () => 'Europe/London',
      now: () => now,
      sealLink: seal,
      openLink: open,
      fetchLink,
      ...overrides
    })

  beforeEach(async () => {
    now = Date.parse('2026-10-17T09:00:00Z')
    databasePath = await createMigratedDatabase(root())
    fetchLink = vi.fn(async () => ({
      notModified: false as const,
      text: ics('Pangolin meeting'),
      etag: '"v1"',
      lastModified: 'Sat, 17 Oct 2026 08:00:00 GMT'
    }))
    service = make()
  })

  afterEach(() => {
    service.close()
  })

  const titles = () =>
    service.events({ from: '2026-10-21', to: '2026-10-21' }).map((event) => event.title)

  it('migration 47 adds the link columns to outside calendars', async () => {
    const file = path.join(root(), 'old.db')
    const options = { backupDir: path.join(root(), 'backups-old'), appVersion: 'test' }
    await migrateOstlerDatabase(
      file,
      options,
      MIGRATIONS.filter((migration) => migration.version <= 46)
    )
    const result = await migrateOstlerDatabase(file, options, MIGRATIONS)
    expect(result.from).toBe(46)
    expect(result.to).toBeGreaterThanOrEqual(47)
    const db = new Database(file)
    const columns = (
      db.prepare('PRAGMA table_info(outside_calendars)').all() as { name: string }[]
    ).map((column) => column.name)
    db.close()
    expect(columns).toEqual(
      expect.arrayContaining([
        'link_secret',
        'link_shown',
        'etag',
        'last_modified',
        'fetched_at',
        'failed_at',
        'failure'
      ])
    )
  })

  it('subscribes: fetches once, stores the link encrypted and never returns it', async () => {
    const added = await service.addLink({
      link: LINK.replace('https://', 'webcal://'),
      name: 'Work'
    })
    expect(fetchLink).toHaveBeenCalledWith(LINK, {})
    expect(added).toMatchObject({
      kind: 'link',
      path: null,
      readCount: 1,
      linkShown: 'calendar.example.test/…/basic.ics',
      fetchedAt: now,
      failure: null
    })
    expect(titles()).toEqual(['Pangolin meeting'])
    for (const shown of [added, service.get(added.id), service.list()])
      expect(JSON.stringify(shown)).not.toContain('Pangolin42Secret')
    expect(JSON.stringify(service.list())).not.toContain('ostler-secure')

    service.close()
    const db = new Database(databasePath)
    const row = db.prepare('SELECT link_secret FROM outside_calendars').get() as {
      link_secret: string
    }
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()
    expect(row.link_secret.startsWith('ostler-secure:v1:')).toBe(true)
    expect(open(row.link_secret)).toBe(LINK)
    for (const name of fs.readdirSync(root())) {
      const full = path.join(root(), name)
      if (fs.statSync(full).isFile())
        expect(fs.readFileSync(full).toString('latin1'), name).not.toContain('Pangolin42Secret')
    }
    service = make()
  })

  it('refuses http and redirects to http, and saves nothing', async () => {
    await expect(
      service.addLink({ link: 'http://calendar.example.test/a.ics', name: 'Plain' })
    ).rejects.toThrow(/secure/)
    expect(fetchLink).not.toHaveBeenCalled()
    fetchLink.mockRejectedValueOnce(new CalendarLinkError('notHttps'))
    await expect(service.addLink({ link: LINK, name: 'Moved' })).rejects.toThrow(
      "The address moved somewhere that isn't secure"
    )
    expect(service.list()).toEqual([])
  })

  it('cannot save a link when encryption is unavailable', async () => {
    service.close()
    service = make({
      sealLink: () => {
        throw new Error('Secure credential storage is unavailable')
      }
    })
    await expect(service.addLink({ link: LINK, name: 'Work' })).rejects.toThrow(/encrypt/)
    expect(fetchLink).not.toHaveBeenCalled()
    expect(service.list()).toEqual([])
  })

  it('refreshes with conditional requests; a 304 keeps the events', async () => {
    const added = await service.addLink({ link: LINK, name: 'Work' })
    fetchLink.mockResolvedValueOnce({ notModified: true })
    now += 3_600_000
    const refreshed = await service.refresh(added.id)
    expect(fetchLink).toHaveBeenLastCalledWith(LINK, {
      etag: '"v1"',
      lastModified: 'Sat, 17 Oct 2026 08:00:00 GMT'
    })
    expect(refreshed.fetchedAt).toBe(now)
    expect(titles()).toEqual(['Pangolin meeting'])

    fetchLink.mockResolvedValueOnce({
      notModified: false,
      text: ics('Aardvark review'),
      etag: '"v2"',
      lastModified: null
    })
    await service.refresh(added.id)
    expect(titles()).toEqual(['Aardvark review'])
  })

  it('a failure keeps the last events and records why, without the link', async () => {
    const added = await service.addLink({ link: LINK, name: 'Work' })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchLink.mockRejectedValueOnce(new CalendarLinkError('refused'))
    now += 60_000
    const failed = await service.refresh(added.id)
    expect(failed).toMatchObject({ failure: 'refused', failedAt: now, fetchedAt: added.fetchedAt })
    expect(titles()).toEqual(['Pangolin meeting'])

    fetchLink.mockRejectedValueOnce(new Error(`ECONNRESET ${LINK}`))
    expect((await service.refresh(added.id)).failure).toBe('unreachable')

    fetchLink.mockResolvedValueOnce({
      notModified: false,
      text: '<html>Sign in</html>',
      etag: null,
      lastModified: null
    })
    expect((await service.refresh(added.id)).failure).toBe('notCalendar')
    expect(titles()).toEqual(['Pangolin meeting'])
    expect(JSON.stringify(service.list())).not.toContain('Pangolin42Secret')
    for (const spy of [log, warn])
      for (const call of spy.mock.calls) expect(String(call)).not.toContain('Pangolin42Secret')
    log.mockRestore()
    warn.mockRestore()

    // The next success clears the failure.
    const fixed = await service.refresh(added.id)
    expect(fixed.failure).toBeNull()
  })

  it('reads the body with the file reader and its limits', async () => {
    fetchLink.mockResolvedValueOnce({
      notModified: false,
      text: ics('Too many', 50_001),
      etag: null,
      lastModified: null
    })
    await expect(service.addLink({ link: LINK, name: 'Huge' })).rejects.toThrow(
      'What came back is not a calendar'
    )
    expect(service.list()).toEqual([])
  })

  it('says Paste the link again when this computer cannot open it', async () => {
    const added = await service.addLink({ link: LINK, name: 'Work' })
    service.close()
    service = make({
      openLink: () => {
        throw new Error('Stored API key is not a valid Ostler encrypted credential.')
      }
    })
    const calls = fetchLink.mock.calls.length
    const refreshed = await service.refresh(added.id)
    expect(refreshed.failure).toBe('pasteAgain')
    expect(fetchLink.mock.calls.length).toBe(calls)
    expect(titles()).toEqual(['Pangolin meeting'])
  })

  it('replaces the link only when the new one works', async () => {
    const added = await service.addLink({ link: LINK, name: 'Work' })
    fetchLink.mockRejectedValueOnce(new CalendarLinkError('refused'))
    await expect(
      service.replaceLink(added.id, 'https://other.example.test/x/new.ics')
    ).rejects.toThrow('The address was refused: check it is still shared')
    expect(service.get(added.id).linkShown).toBe('calendar.example.test/…/basic.ics')

    fetchLink.mockResolvedValueOnce({
      notModified: false,
      text: ics('Aardvark review'),
      etag: null,
      lastModified: null
    })
    const replaced = await service.replaceLink(added.id, 'https://other.example.test/x/new.ics')
    expect(replaced.linkShown).toBe('other.example.test/…/new.ics')
    expect(titles()).toEqual(['Aardvark review'])
    await service.refresh(added.id)
    expect(fetchLink).toHaveBeenLastCalledWith('https://other.example.test/x/new.ics', {
      etag: null,
      lastModified: null
    })
  })

  it('fetches several links one after another, never at once', async () => {
    await service.addLink({ link: LINK, name: 'One' })
    await service.addLink({ link: 'https://calendar.example.test/b/two.ics', name: 'Two' })
    await service.addLink({ link: 'https://calendar.example.test/c/three.ics', name: 'Three' })
    let running = 0
    let most = 0
    fetchLink.mockImplementation(async () => {
      running += 1
      most = Math.max(most, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running -= 1
      return { notModified: true }
    })
    const [first] = service.list()
    await Promise.all([service.refreshLinks(), service.refresh(first.id), service.refreshLinks()])
    expect(most).toBe(1)
    expect(service.hasLinks()).toBe(true)
  })

  it('pauses a hidden link; showing it fetches it once at once', async () => {
    const shownFetched = vi.fn()
    service.close()
    service = make({ onShownFetched: shownFetched })
    const work = await service.addLink({ link: LINK, name: 'Work' })
    const file = service.addText({ name: 'File', text: ics('From a file') })
    expect(fetchLink).toHaveBeenCalledTimes(1)

    service.update(work.id, { hidden: true })
    expect(service.hasLinks()).toBe(false)
    expect(await service.refreshLinks()).toBe(0)
    expect(fetchLink).toHaveBeenCalledTimes(1)
    // Hiding it again, renaming it or showing a file fetches nothing.
    service.update(work.id, { hidden: true, name: 'Office' })
    service.update(file.id, { hidden: true })
    service.update(file.id, { hidden: false })
    await Promise.resolve()
    expect(fetchLink).toHaveBeenCalledTimes(1)

    fetchLink.mockResolvedValueOnce({
      notModified: false,
      text: ics('Shown again'),
      etag: '"v2"',
      lastModified: null
    })
    now += 3 * 24 * 60 * 60 * 1000
    const shown = service.update(work.id, { hidden: false })
    // The answer comes before the fetch, which then runs once.
    expect(shown.hidden).toBe(false)
    await vi.waitFor(() => expect(shownFetched).toHaveBeenCalledTimes(1))
    expect(fetchLink).toHaveBeenCalledTimes(2)
    expect(fetchLink).toHaveBeenLastCalledWith(LINK, {
      etag: '"v1"',
      lastModified: 'Sat, 17 Oct 2026 08:00:00 GMT'
    })
    expect(service.get(work.id)).toMatchObject({ fetchedAt: now, failure: null })
    expect(titles()).toContain('Shown again')
    expect(service.hasLinks()).toBe(true)
    expect(await service.refreshLinks()).toBe(1)
    expect(fetchLink).toHaveBeenCalledTimes(3)
  })

  it('records a failed fetch on showing, as the hourly fetch does', async () => {
    const shownFetched = vi.fn()
    service.close()
    service = make({ onShownFetched: shownFetched })
    const work = await service.addLink({ link: LINK, name: 'Work' })
    service.update(work.id, { hidden: true })
    fetchLink.mockRejectedValueOnce(new CalendarLinkError('timeout'))
    service.update(work.id, { hidden: false })
    await vi.waitFor(() => expect(shownFetched).toHaveBeenCalledTimes(1))
    expect(service.get(work.id)).toMatchObject({ failure: 'timeout', failedAt: now })
    expect(titles()).toEqual(['Pangolin meeting'])
  })

  it('skips a link hidden while a pass waits its turn', async () => {
    const one = await service.addLink({ link: LINK, name: 'One' })
    const two = await service.addLink({
      link: 'https://calendar.example.test/b/two.ics',
      name: 'Two'
    })
    let release: () => void = () => {}
    fetchLink.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ notModified: true })
        })
    )
    const pass = service.refreshLinks()
    await vi.waitFor(() => expect(fetchLink).toHaveBeenCalledTimes(3))
    expect(service.list().map((calendar) => calendar.id)).toEqual([one.id, two.id])
    service.update(two.id, { hidden: true })
    release()
    expect(await pass).toBe(1)
    expect(fetchLink).toHaveBeenCalledTimes(3)
  })

  it('has no links until one is added, and files are not refreshed', () => {
    expect(service.hasLinks()).toBe(false)
    const file = service.addText({ name: 'File', text: ics('From a file') })
    expect(service.hasLinks()).toBe(false)
    expect(() => service.refresh(file.id)).toThrow('This calendar is a file, not a link')
  })
})
