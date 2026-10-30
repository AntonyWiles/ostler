import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { DaysOffService } from '../../electron/services/days-off-service'
import { PeopleService } from '../../electron/services/people-service'
import type { DayOff, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

const project: WatchedProject = makeWatchedProject({
  id: 'home-project',
  name: 'Home',
  automationToken: 'token-one',
  estimateUnit: 'hours'
})

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:xmas',
  'SUMMARY:Christmas Day',
  'DTSTART;VALUE=DATE:20261225',
  'DTEND;VALUE=DATE:20261226',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'SUMMARY:Meeting',
  'DTSTART:20261224T090000Z',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n')

describe('automation-http-server.ts /days-off routes (N3.2)', () => {
  const root = useTempDir('ostler-automation-days-off-')
  let people: PeopleService
  let daysOff: DaysOffService
  let server: AutomationHttpServer
  let notified = 0

  beforeEach(async () => {
    notified = 0
    const databasePath = await createMigratedDatabase(root())
    people = new PeopleService(databasePath)
    daysOff = new DaysOffService(databasePath, { personExists: (id) => people.exists(id) })
    server = new AutomationHttpServer(() => [project], path.join(root(), 'runtime'))
    server.daysOff = { service: daysOff, notify: () => notified++ }
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
    daysOff?.close()
    people?.close()
  })

  async function call<T = unknown>(
    route: string,
    body?: unknown,
    method = 'POST'
  ): Promise<{ status: number; ok: boolean; value: T; error?: string }> {
    const response = await fetch(`http://127.0.0.1:${PORT}/automation/${project.id}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${project.automationToken}`
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const json = (await response.json()) as { ok: boolean; value: T; error?: string }
    return { status: response.status, ...json }
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
        'GET /days-off',
        'POST /days-off',
        'PATCH /days-off/:dayOffId',
        'DELETE /days-off/:dayOffId',
        'DELETE /days-off',
        'POST /days-off/import'
      ])
    )
  })

  it('adds, lists by range and person, changes and removes a day off', async () => {
    const sam = people.create({ name: 'Sam' })
    const added = await call<DayOff>('/days-off', {
      firstDate: '2026-08-03',
      lastDate: '2026-08-14',
      name: 'Leave',
      personId: sam.id
    })
    expect(added.status).toBe(200)
    await call('/days-off', { firstDate: '2026-12-25', name: 'Christmas Day' })
    const august = await call<DayOff[]>('/days-off?from=2026-08-10&to=2026-08-31', undefined, 'GET')
    expect(august.value.map((day) => day.name)).toEqual(['Leave'])
    const forSam = await call<DayOff[]>(`/days-off?personId=${sam.id}`, undefined, 'GET')
    expect(forSam.value).toHaveLength(2)

    const patched = await call<DayOff>(`/days-off/${added.value.id}`, { name: 'Summer' }, 'PATCH')
    expect(patched.value.name).toBe('Summer')
    expect((await call(`/days-off/${added.value.id}`, {}, 'PATCH')).status).toBe(400)
    const removed = await call<DayOff>(`/days-off/${added.value.id}`, undefined, 'DELETE')
    expect(removed.value.name).toBe('Summer')
    expect(notified).toBe(4)
    expect((await call('/days-off', { firstDate: 'soon', name: 'X' })).status).toBe(400)
  })

  it('previews an import with dryRun=1, imports it, and removes the file’s days', async () => {
    const preview = await call<{ days: unknown[]; skipped: unknown[]; added: unknown[] }>(
      '/days-off/import?dryRun=1',
      { fileName: 'holidays.ics', text: ICS }
    )
    expect(preview.status).toBe(200)
    expect(preview.value.days).toEqual([
      { firstDate: '2026-12-25', lastDate: '2026-12-25', name: 'Christmas Day' }
    ])
    expect(preview.value.skipped).toEqual([{ name: 'Meeting', reason: 'timed' }])
    expect(daysOff.list()).toEqual([])
    expect(notified).toBe(0)

    const imported = await call<{ added: DayOff[] }>('/days-off/import', {
      fileName: 'holidays.ics',
      text: ICS
    })
    expect(imported.value.added[0]).toMatchObject({ sourceFile: 'holidays.ics', personId: null })
    const again = await call<{ replacedCount: number }>('/days-off/import', {
      fileName: 'holidays.ics',
      text: ICS
    })
    expect(again.value.replacedCount).toBe(1)
    expect(daysOff.list()).toHaveLength(1)

    const removed = await call<DayOff[]>('/days-off?sourceFile=holidays.ics', undefined, 'DELETE')
    expect(removed.value).toHaveLength(1)
    expect(daysOff.list()).toEqual([])
    expect((await call('/days-off', undefined, 'DELETE')).status).toBe(400)

    // The same file for a person and for everyone: two loads, each removed on its own.
    const sam = people.create({ name: 'Sam' })
    await call('/days-off/import', { fileName: 'holidays.ics', text: ICS, personId: sam.id })
    const forEveryone = await call<{ replacedCount: number }>('/days-off/import', {
      fileName: 'holidays.ics',
      text: ICS
    })
    expect(forEveryone.value.replacedCount).toBe(0)
    expect(daysOff.list()).toHaveLength(2)
    const everyones = await call<DayOff[]>(
      '/days-off?sourceFile=holidays.ics&personId=everyone',
      undefined,
      'DELETE'
    )
    expect(everyones.value.map((day) => day.personId)).toEqual([null])
    const sams = await call<DayOff[]>(
      `/days-off?sourceFile=holidays.ics&personId=${sam.id}`,
      undefined,
      'DELETE'
    )
    expect(sams.value.map((day) => day.personId)).toEqual([sam.id])
    expect(daysOff.list()).toEqual([])
    expect((await call('/days-off/import', { fileName: 'x.ics', text: 'nope' })).status).toBe(400)
  })
})
