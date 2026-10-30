import http from 'node:http'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { OutsideCalendarService } from '../../electron/services/outside-calendar-service'
import { fetchCalendarLink } from '../../electron/services/calendar-link-fetch'
import {
  CalendarLinkSchedule,
  FETCH_INTERVAL_MS,
  FIRST_FETCH_DELAY_MS
} from '../../electron/services/calendar-link-schedule'
import { PlanningService } from '../../electron/services/planning-service'
import type { OutsideCalendar, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
/** The secret part of the test link: it must never come back. */
const SECRET = 'Okapi9Secret'

const project: WatchedProject = makeWatchedProject({
  id: 'calendar-link-project',
  name: 'Home',
  automationToken: 'token-links',
  estimateUnit: 'hours'
})

const ICS = (title: string) =>
  [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:okapi',
    `SUMMARY:${title}`,
    'DTSTART:20261021T130000Z',
    'DTEND:20261021T140000Z',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')

/** A clock the test moves by hand, for the hourly schedule. */
function fakeClock() {
  let now = 0
  let next = 1
  const timers = new Map<number, { at: number; callback: () => void }>()
  return {
    setTimer: (callback: () => void, ms: number) => {
      const id = next++
      timers.set(id, { at: now + ms, callback })
      return id
    },
    clearTimer: (id: unknown) => void timers.delete(id as number),
    async advance(ms: number, settle: () => Promise<void>) {
      const until = now + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].callback()
        await settle()
      }
      now = until
    }
  }
}

describe('automation-http-server.ts calendar links (N3.3b)', () => {
  const root = useTempDir('ostler-calendar-links-')
  let calendars: OutsideCalendarService
  let planning: PlanningService
  let server: AutomationHttpServer
  let feed: http.Server
  let feedPort = 0
  let body = ICS('Quagga planning')
  let status = 200
  let seen: http.IncomingHttpHeaders[] = []
  /** The path of every request the feed answered, to tell the links apart. */
  let fetched: string[] = []
  let shownFetched = 0

  beforeEach(async () => {
    seen = []
    fetched = []
    shownFetched = 0
    status = 200
    body = ICS('Quagga planning')
    // A local stand-in for the calendar's server: nothing here reaches the internet.
    feed = http.createServer((req, res) => {
      seen.push(req.headers)
      fetched.push(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
      if (status !== 200) {
        res.writeHead(status)
        return res.end()
      }
      if (req.headers['if-none-match'] === '"v1"') {
        res.writeHead(304)
        return res.end()
      }
      res.writeHead(200, { 'Content-Type': 'text/calendar', ETag: '"v1"' })
      res.end(body)
    })
    await new Promise<void>((resolve) => feed.listen(0, '127.0.0.1', resolve))
    feedPort = (feed.address() as AddressInfo).port
    const databasePath = await createMigratedDatabase(root())
    calendars = new OutsideCalendarService(databasePath, {
      readFile: () => {
        throw new Error('no files here')
      },
      timeZone: () => 'Europe/London',
      sealLink: (link) => `ostler-secure:v1:${Buffer.from(link).toString('base64')}`,
      openLink: (secret) =>
        Buffer.from(secret.slice('ostler-secure:v1:'.length), 'base64').toString(),
      // The real fetch module; only the transport is pointed at the local server.
      fetchLink: (link, conditions) =>
        fetchCalendarLink(link, conditions, {
          userAgent: 'Ostler test',
          fetch: (url, init) =>
            fetch(url.replace(/^https:\/\/calendar\.test/, `http://127.0.0.1:${feedPort}`), init)
        }),
      onShownFetched: () => {
        shownFetched += 1
      }
    })
    planning = new PlanningService(databasePath, () => [project.id])
    server = new AutomationHttpServer(
      () => [project],
      path.join(root(), 'runtime'),
      undefined,
      planning
    )
    server.calendars = { service: calendars, notify: () => {} }
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(async () => {
    server?.stop()
    calendars?.close()
    planning?.close()
    await new Promise((resolve) => feed.close(resolve))
  })

  async function call<T = unknown>(
    route: string,
    payload?: unknown,
    method = 'POST'
  ): Promise<{ status: number; ok: boolean; value: T; error?: string; text: string }> {
    const response = await fetch(`http://127.0.0.1:${PORT}/automation/${project.id}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${project.automationToken}`
      },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    })
    const text = await response.text()
    const json = JSON.parse(text) as { ok: boolean; value: T; error?: string }
    return { status: response.status, text, ...json }
  }

  const LINK = `webcal://calendar.test/feeds/${SECRET}/work.ics`

  it('lists the refresh route in help', async () => {
    const help = await call<{ routes: { method: string; path: string }[] }>(
      '/help',
      undefined,
      'GET'
    )
    expect(help.value.routes.map((route) => `${route.method} ${route.path}`)).toContain(
      'POST /calendars/:calendarId/refresh'
    )
  })

  it('adds a calendar from a link, refreshes it, and never returns the link', async () => {
    const added = await call<OutsideCalendar>('/calendars', { name: 'Work', link: LINK })
    expect(added.status).toBe(200)
    expect(added.value).toMatchObject({
      kind: 'link',
      readCount: 1,
      linkShown: 'calendar.test/…/work.ics',
      failure: null
    })
    expect(seen[0]['user-agent']).toBe('Ostler test')
    expect(seen[0].cookie).toBeUndefined()
    expect(seen[0].authorization).toBeUndefined()

    const id = added.value.id
    const refreshed = await call<OutsideCalendar>(`/calendars/${id}/refresh`)
    expect(refreshed.status).toBe(200)
    expect(seen[1]['if-none-match']).toBe('"v1"')
    expect(refreshed.value.failure).toBeNull()

    status = 404
    const failed = await call<OutsideCalendar>(`/calendars/${id}/refresh`)
    expect(failed.status).toBe(200)
    expect(failed.value.failure).toBe('refused')
    const events = await call<{ title: string }[]>(
      `/calendars/${id}/events?from=2026-10-21&to=2026-10-21`,
      undefined,
      'GET'
    )
    expect(events.value.map((event) => event.title)).toEqual(['Quagga planning'])

    for (const text of [added.text, refreshed.text, failed.text]) expect(text).not.toContain(SECRET)
    for (const route of [
      '/help',
      '/calendars',
      `/calendars/${id}`,
      '/work-items',
      '/search?q=Okapi'
    ])
      expect((await call(route, undefined, 'GET')).text, route).not.toContain(SECRET)
  })

  it('refuses http, a failing first fetch and a file refresh, without the link in the error', async () => {
    const plain = await call('/calendars', {
      name: 'Plain',
      link: `http://calendar.test/feeds/${SECRET}/work.ics`
    })
    expect(plain.status).toBe(400)
    expect(plain.text).not.toContain(SECRET)

    status = 500
    const broken = await call('/calendars', { name: 'Broken', link: LINK })
    expect(broken.status).toBe(400)
    expect(broken.error).toBe("The calendar's server had a problem")
    expect(broken.text).not.toContain(SECRET)
    expect((await call<OutsideCalendar[]>('/calendars', undefined, 'GET')).value).toEqual([])

    expect((await call('/calendars', { name: 'Both', link: LINK, text: ICS('x') })).status).toBe(
      400
    )
    status = 200
    const file = await call<OutsideCalendar>('/calendars', { name: 'File', text: ICS('x') })
    expect((await call(`/calendars/${file.value.id}/refresh`)).status).toBe(400)
  })

  it('replaces a link with PATCH, with the checks and effects of Replace link', async () => {
    const added = await call<OutsideCalendar>('/calendars', { name: 'Work', link: LINK })
    const id = added.value.id
    body = ICS('Tapir review')
    const replaced = await call<OutsideCalendar>(
      `/calendars/${id}`,
      { link: `https://calendar.test/other/${SECRET}/home.ics`, name: 'Home' },
      'PATCH'
    )
    expect(replaced.status).toBe(200)
    expect(replaced.value).toMatchObject({
      name: 'Home',
      linkShown: 'calendar.test/…/home.ics',
      failure: null
    })
    expect(replaced.text).not.toContain(SECRET)
    expect(fetched.at(-1)).toBe(`/other/${SECRET}/home.ics`)
    const events = await call<{ title: string }[]>(
      `/calendars/${id}/events?from=2026-10-21&to=2026-10-21`,
      undefined,
      'GET'
    )
    expect(events.value.map((event) => event.title)).toEqual(['Tapir review'])

    // The same checks as POST /calendars: http is refused, and so is a link that does not work.
    const plain = await call(
      `/calendars/${id}`,
      { link: `http://calendar.test/feeds/${SECRET}/work.ics` },
      'PATCH'
    )
    expect(plain.status).toBe(400)
    expect(plain.text).not.toContain(SECRET)
    status = 500
    const broken = await call(`/calendars/${id}`, { link: LINK }, 'PATCH')
    expect(broken.status).toBe(400)
    expect(broken.error).toBe("The calendar's server had a problem")
    expect(broken.text).not.toContain(SECRET)
    status = 200
    // The old link and events stay.
    const kept = await call<OutsideCalendar>(`/calendars/${id}`, undefined, 'GET')
    expect(kept.value.linkShown).toBe('calendar.test/…/home.ics')
    expect((await call(`/calendars/${id}`, { link: 42 }, 'PATCH')).status).toBe(400)
    expect((await call(`/calendars/${id}`, { text: ICS('x') }, 'PATCH')).status).toBe(400)
    const both = await call(`/calendars/${id}`, { text: ICS('x'), link: LINK }, 'PATCH')
    expect(both.status).toBe(400)
    const file = await call<OutsideCalendar>('/calendars', { name: 'File', text: ICS('x') })
    expect((await call(`/calendars/${file.value.id}`, { link: LINK }, 'PATCH')).status).toBe(400)
  })

  it('has no PUT /calendars/:calendarId: PATCH replaced it', async () => {
    const added = await call<OutsideCalendar>('/calendars', { name: 'Work', link: LINK })
    const before = fetched.length
    const put = await call(`/calendars/${added.value.id}`, { name: 'Renamed', link: LINK }, 'PUT')
    expect(put.status).toBe(404)
    expect(fetched.length).toBe(before)
    const kept = await call<OutsideCalendar>(`/calendars/${added.value.id}`, undefined, 'GET')
    expect(kept.value.name).toBe('Work')
    const help = await call<{ routes: { method: string; path: string }[] }>(
      '/help',
      undefined,
      'GET'
    )
    const routes = help.value.routes.map((route) => `${route.method} ${route.path}`)
    expect(routes).toContain('PATCH /calendars/:calendarId')
    expect(routes).not.toContain('PUT /calendars/:calendarId')
  })

  it('pauses a hidden link on the hourly fetch; showing it fetches it once at once', async () => {
    const work = await call<OutsideCalendar>('/calendars', { name: 'Work', link: LINK })
    const home = await call<OutsideCalendar>('/calendars', {
      name: 'Home',
      link: `https://calendar.test/feeds/${SECRET}/home.ics`
    })
    const workPath = `/feeds/${SECRET}/work.ics`
    const homePath = `/feeds/${SECRET}/home.ics`
    const count = (route: string) => fetched.filter((one) => one === route).length
    expect([count(workPath), count(homePath)]).toEqual([1, 1])

    const hidden = await call<OutsideCalendar>(
      `/calendars/${home.value.id}`,
      { hidden: true },
      'PATCH'
    )
    expect(hidden.value.hidden).toBe(true)
    expect(count(homePath)).toBe(1)

    const clock = fakeClock()
    let passes = 0
    const schedule = new CalendarLinkSchedule({
      hasLinks: () => calendars.hasLinks(),
      refreshLinks: () => calendars.refreshLinks(),
      onRefreshed: () => {
        passes += 1
      },
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer
    })
    // Each pass goes to the local feed server, so wait for it to finish before moving on.
    const settle = async () => {
      const target = passes + 1
      await vi.waitFor(() => expect(passes).toBe(target))
    }
    schedule.start()
    try {
      await clock.advance(FIRST_FETCH_DELAY_MS + FETCH_INTERVAL_MS * 2, settle)
      expect(passes).toBe(3)
      expect(count(workPath)).toBe(4)
      expect(count(homePath)).toBe(1)

      // Showing it fetches it at once, after the answer, and only once.
      const shown = await call<OutsideCalendar>(
        `/calendars/${home.value.id}`,
        { hidden: false },
        'PATCH'
      )
      expect(shown.value.hidden).toBe(false)
      await vi.waitFor(() => expect(shownFetched).toBe(1))
      expect(count(homePath)).toBe(2)
      expect(count(workPath)).toBe(4)
      // Showing a calendar already shown, or renaming it, fetches nothing.
      await call(`/calendars/${home.value.id}`, { hidden: false, name: 'House' }, 'PATCH')
      expect(count(homePath)).toBe(2)
      expect(shownFetched).toBe(1)

      // Then hourly as before.
      await clock.advance(FETCH_INTERVAL_MS, settle)
      expect(count(homePath)).toBe(3)
      expect(count(workPath)).toBe(5)

      // With every link hidden, a pass fetches nothing at all.
      for (const id of [work.value.id, home.value.id])
        await call(`/calendars/${id}`, { hidden: true }, 'PATCH')
      expect(calendars.hasLinks()).toBe(false)
      const before = fetched.length
      await calendars.refreshLinks()
      await schedule.tick()
      expect(fetched.length).toBe(before)
      expect(shownFetched).toBe(1)
    } finally {
      schedule.stop()
    }
  })
})
