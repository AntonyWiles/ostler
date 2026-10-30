import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { OutsideCalendarService } from '../../electron/services/outside-calendar-service'
import { PlanningService } from '../../electron/services/planning-service'
import type {
  CalendarOccurrence,
  OutsideCalendar,
  WatchedProject
} from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

const project: WatchedProject = makeWatchedProject({
  id: 'calendar-project',
  name: 'Home',
  automationToken: 'token-one',
  estimateUnit: 'hours'
})

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:standup',
  'SUMMARY:Quokka stand-up',
  'DTSTART;TZID=Europe/London:20261019T093000',
  'DTEND;TZID=Europe/London:20261019T094500',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

describe('automation-http-server.ts /calendars routes (N3.3a)', () => {
  const root = useTempDir('ostler-automation-calendars-')
  let calendars: OutsideCalendarService
  let planning: PlanningService
  let server: AutomationHttpServer
  let notified = 0

  beforeEach(async () => {
    notified = 0
    const databasePath = await createMigratedDatabase(root())
    calendars = new OutsideCalendarService(databasePath, {
      readFile: () => {
        throw new Error('no files here')
      },
      timeZone: () => 'Europe/London'
    })
    planning = new PlanningService(databasePath, () => [project.id])
    server = new AutomationHttpServer(
      () => [project],
      path.join(root(), 'runtime'),
      undefined,
      planning
    )
    server.calendars = { service: calendars, notify: () => notified++ }
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
    calendars?.close()
    planning?.close()
  })

  async function call<T = unknown>(
    route: string,
    body?: unknown,
    method = 'POST'
  ): Promise<{ status: number; ok: boolean; value: T; error?: string; text: string }> {
    const response = await fetch(`http://127.0.0.1:${PORT}/automation/${project.id}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${project.automationToken}`
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const text = await response.text()
    const json = JSON.parse(text) as { ok: boolean; value: T; error?: string }
    return { status: response.status, text, ...json }
  }

  it('lists the routes in help', async () => {
    const help = await call<{ routes: { method: string; path: string }[] }>(
      '/help',
      undefined,
      'GET'
    )
    const routes = help.value.routes.map((route) => `${route.method} ${route.path}`)
    expect(routes).toEqual(
      expect.arrayContaining([
        'GET /calendars',
        'POST /calendars',
        'PATCH /calendars/:calendarId',
        'DELETE /calendars/:calendarId',
        'GET /calendars/:calendarId/events'
      ])
    )
  })

  it('adds, lists, replaces, reads events for a range and removes a calendar', async () => {
    const added = await call<OutsideCalendar>('/calendars', { name: 'Work', text: ICS })
    expect(added.status).toBe(200)
    expect(added.value).toMatchObject({ name: 'Work', path: null, readCount: 1 })

    const list = await call<OutsideCalendar[]>('/calendars', undefined, 'GET')
    expect(list.value.map((calendar) => calendar.name)).toEqual(['Work'])
    expect(list.text).not.toContain('Quokka')

    const id = added.value.id
    const events = await call<CalendarOccurrence[]>(
      `/calendars/${id}/events?from=2026-10-19&to=2026-10-25`,
      undefined,
      'GET'
    )
    expect(events.value.map((event) => `${event.startDate} ${event.startTime}`)).toEqual([
      '2026-10-19 09:30',
      '2026-10-20 09:30',
      '2026-10-21 09:30',
      '2026-10-22 09:30',
      '2026-10-23 09:30'
    ])
    expect(
      (await call(`/calendars/${id}/events?from=2026-10-25&to=2026-10-01`, undefined, 'GET')).status
    ).toBe(400)

    const replaced = await call<OutsideCalendar>(
      `/calendars/${id}`,
      { text: ICS.replace('BYDAY=MO,TU,WE,TH,FR', 'BYDAY=MO'), name: 'Office' },
      'PATCH'
    )
    expect(replaced.value.name).toBe('Office')
    const fewer = await call<CalendarOccurrence[]>(
      `/calendars/${id}/events?from=2026-10-19&to=2026-10-25`,
      undefined,
      'GET'
    )
    expect(fewer.value).toHaveLength(1)
    expect((await call(`/calendars/${id}`, {}, 'PATCH')).status).toBe(400)

    const removed = await call<OutsideCalendar>(`/calendars/${id}`, undefined, 'DELETE')
    expect(removed.value.name).toBe('Office')
    expect((await call('/calendars', undefined, 'GET')).value).toEqual([])
    expect(notified).toBe(3)
    expect((await call('/calendars', { name: 'Bad', text: 'nope' })).status).toBe(400)
  })

  it('no other route returns events', async () => {
    const added = await call<OutsideCalendar>('/calendars', { name: 'Work', text: ICS })
    expect(added.status).toBe(200)
    for (const route of [
      '/help',
      '/calendars',
      `/calendars/${added.value.id}`,
      '/work-items',
      '/search?q=Quokka'
    ]) {
      const result = await call(route, undefined, 'GET')
      expect(result.text, route).not.toContain('Quokka')
    }
  })
})
