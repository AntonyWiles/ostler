import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { ReportService } from '../../electron/services/report-service'
import type { StatusUpdate, WatchedProject } from '../../src/shared/ostler-api'
import { normalizeUpdateReminder, parseUpdateReminder } from '../../src/shared/status-updates'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
const PROJECT = '0f8fad5b-d9cb-469f-a165-70867728950e'
const OTHER = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id === PROJECT ? 'Website' : 'Garden',
    automationToken: token
  })
}

describe('status updates over the automation API (N5.5)', () => {
  const root = useTempDir('ostler-status-http-')
  let planning: PlanningService
  let server: AutomationHttpServer
  let project: WatchedProject
  let other: WatchedProject

  beforeEach(async () => {
    project = watched(PROJECT, 'token-one')
    other = watched(OTHER, 'token-two')
    const dbPath = await createMigratedDatabase(root())
    planning = new PlanningService(dbPath, () => [project.id, other.id])
    const reports = new ReportService({ planning, listPeople: () => [] })
    server = new AutomationHttpServer(
      () => [project, other],
      path.join(root(), 'runtime'),
      undefined,
      planning,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      reports
    )
    // As main does: saved on the project, checked by the one rule.
    server.updateReminder = {
      update: (projectId, reminder) => {
        const target = projectId === project.id ? project : other
        target.updateReminder = parseUpdateReminder(
          reminder,
          normalizeUpdateReminder(target.updateReminder),
          '2026-10-17'
        )
        return target.updateReminder
      }
    }
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
    planning?.close()
  })

  function call(method: string, urlPath: string, body?: unknown, token = 'token-one') {
    const id = token === 'token-one' ? project.id : other.id
    return fetch(`http://127.0.0.1:${PORT}/automation/${id}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }

  async function value<T>(response: Response): Promise<T> {
    const body = (await response.json()) as { ok: boolean; value: T; error?: string }
    if (!body.ok) throw new Error(body.error)
    return body.value
  }

  it('describes the routes in help', async () => {
    const help = await value<{ routes: { method: string; path: string; description: string }[] }>(
      await call('GET', '/help?full=1')
    )
    const routes = help.routes.map((route) => `${route.method} ${route.path}`)
    for (const route of [
      'GET /updates',
      'POST /updates',
      'PATCH /updates/:updateId',
      'DELETE /updates/:updateId',
      'GET /update-reminder',
      'PUT /update-reminder'
    ]) {
      expect(routes).toContain(route)
    }
    const exportRoute = help.routes.find((route) => route.path === '/export')!
    expect(exportRoute.description).toContain('?statusUpdate=true')
  })

  it('posts as the automation API, lists, edits and deletes', async () => {
    const posted = await value<StatusUpdate>(
      await call('POST', '/updates', { health: 'at-risk', note: 'Review slipped' })
    )
    expect(posted).toMatchObject({
      projectId: PROJECT,
      health: 'at-risk',
      authorKind: 'automation',
      authorName: 'Automation API'
    })
    expect((await value<StatusUpdate[]>(await call('GET', '/updates'))).map((u) => u.id)).toEqual([
      posted.id
    ])
    const feed = planning.listProjectActivity(PROJECT).entries
    expect(feed[0].summary).toBe('Automation API posted a status update: At risk')

    const edited = await value<StatusUpdate>(
      await call('PATCH', `/updates/${posted.id}`, { health: 'on-track', note: 'Caught up' })
    )
    expect(edited).toMatchObject({ health: 'on-track', note: 'Caught up' })
    expect(edited.editedAt).not.toBeNull()

    // Another project's token cannot reach it.
    expect((await call('DELETE', `/updates/${posted.id}`, undefined, 'token-two')).status).toBe(400)
    await value(await call('DELETE', `/updates/${posted.id}`))
    expect(await value<StatusUpdate[]>(await call('GET', '/updates'))).toEqual([])
  })

  it('refuses a bad health or a note over 2,000 characters', async () => {
    expect((await call('POST', '/updates', { health: 'green', note: '' })).status).toBe(400)
    const long = await call('POST', '/updates', { health: 'on-track', note: 'x'.repeat(2001) })
    expect(long.status).toBe(400)
    expect(((await long.json()) as { error: string }).error).toMatch(/at most 2000/)
  })

  it('reads and sets the reminder', async () => {
    expect(await value(await call('GET', '/update-reminder'))).toEqual({
      cadence: 'off',
      weekday: 1,
      since: null
    })
    expect(
      await value(await call('PUT', '/update-reminder', { cadence: 'fortnightly', weekday: 5 }))
    ).toEqual({ cadence: 'fortnightly', weekday: 5, since: '2026-10-17' })
    expect(await value(await call('GET', '/update-reminder'))).toMatchObject({
      cadence: 'fortnightly'
    })
    expect((await call('PUT', '/update-reminder', { cadence: 'daily' })).status).toBe(400)
    expect((await call('PUT', '/update-reminder', { weekday: 8 })).status).toBe(400)
  })

  it('includes the latest update in the web page only with statusUpdate=true', async () => {
    await value(await call('POST', '/updates', { health: 'off-track', note: 'Supplier **late**' }))
    const page = (query: string) =>
      fetch(`http://127.0.0.1:${PORT}/automation/${PROJECT}/export?format=html${query}`, {
        headers: { Authorization: 'Bearer token-one' }
      }).then((response) => response.text())
    expect(await page('')).not.toContain('Supplier')
    const withUpdate = await page('&statusUpdate=true')
    expect(withUpdate).toContain('Off track')
    expect(withUpdate).toContain('Supplier <strong>late</strong>')
  })
})
