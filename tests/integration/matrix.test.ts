import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
const human = { kind: 'human' as const }
const today = '2026-10-16'

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id,
    addedAt: Date.now(),
    automationToken: token,
    estimateUnit: 'hours'
  })
}

describe('automation-http-server.ts GET /matrix (N7.5)', () => {
  const root = useTempDir('ostler-automation-matrix-')
  let projects: WatchedProject[]
  let planning: PlanningService
  let people: PeopleService
  let server: AutomationHttpServer

  beforeEach(async () => {
    projects = [watched('home-project', 'token-one'), watched('other-project', 'token-two')]
    const databasePath = await createMigratedDatabase(root())
    planning = new PlanningService(databasePath, () => projects.map((project) => project.id))
    people = new PeopleService(databasePath)
    people.ensureMe('Jordan')
    server = new AutomationHttpServer(
      () => projects,
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
      { service: people, notify: () => {} }
    )
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
    planning?.close()
    people?.close()
  })

  async function call<T = unknown>(
    route: string,
    body?: unknown,
    { method = 'POST', project = projects[0] } = {}
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

  it('lists the route in /help', async () => {
    const help = await call<{ routes: Array<{ method: string; path: string }> }>(
      '/help',
      undefined,
      { method: 'GET' }
    )
    expect(help.value.routes.some((r) => r.method === 'GET' && r.path === '/matrix')).toBe(true)
  })

  it("sorts the token's project's open tasks into the four boxes, in order", async () => {
    const make = (title: string, extra: Record<string, unknown> = {}, project = 'home-project') =>
      planning.createWorkItem(project, { title, ...extra }, human)
    const urgentImportant = make('Fix outage', { priority: 'critical', targetDate: today })
    const overdueHigh = make('Pay invoice', { priority: 'high', targetDate: '2026-10-10' })
    const important = make('Plan launch', { priority: 'high', targetDate: '2026-10-20' })
    const undatedHigh = make('Write strategy', { priority: 'high' })
    const urgent = make('Reply to email', { priority: 'low', targetDate: '2026-10-19' })
    const neither = make('Tidy files', { priority: 'medium' })
    make('Shipped', { priority: 'critical', targetDate: today, status: 'done' })
    make('Parked', { priority: 'critical', targetDate: today, someday: true })
    make('Later', { priority: 'critical', targetDate: today, showFrom: '2026-10-18' })
    const archived = make('Archived', { priority: 'critical', targetDate: today })
    planning.archiveWorkItem(archived.id, human)
    make('Elsewhere', { priority: 'critical', targetDate: today }, 'other-project')

    const matrix = await call<{
      date: string
      urgentWithinDays: number
      boxes: Record<string, string[]>
    }>(`/matrix?date=${today}`, undefined, { method: 'GET' })
    expect(matrix.status).toBe(200)
    expect(matrix.value).toEqual({
      date: today,
      urgentWithinDays: 3,
      boxes: {
        urgentImportant: [overdueHigh.id, urgentImportant.id],
        important: [important.id, undatedHigh.id],
        urgent: [urgent.id],
        neither: [neither.id]
      }
    })
  })

  it('refuses a date that is not a calendar date', async () => {
    const matrix = await call('/matrix?date=tomorrow', undefined, { method: 'GET' })
    expect(matrix.status).toBe(400)
    expect(matrix.ok).toBe(false)
  })
})
