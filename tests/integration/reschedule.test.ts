import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import type { WatchedProject } from '../../src/shared/ostler-api'
import type { ReschedulePlan, RescheduleResult } from '../../src/shared/planning/reschedule'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
const human = { kind: 'human' as const }
const today = '2026-10-15'

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id,
    addedAt: Date.now(),
    automationToken: token,
    estimateUnit: 'hours'
  })
}

describe('automation-http-server.ts reschedule routes (N1.3)', () => {
  const root = useTempDir('ostler-automation-reschedule-')
  let projects: WatchedProject[]
  let planning: PlanningService
  let people: PeopleService
  let server: AutomationHttpServer
  let meId: string

  beforeEach(async () => {
    projects = [watched('home-project', 'token-one'), watched('other-project', 'token-two')]
    const databasePath = await createMigratedDatabase(root())
    planning = new PlanningService(databasePath, () => projects.map((project) => project.id))
    people = new PeopleService(databasePath)
    meId = people.ensureMe('Jordan').id
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

  it('lists both routes in /help', async () => {
    const help = await call<{ routes: Array<{ method: string; path: string }> }>(
      '/help',
      undefined,
      { method: 'GET' }
    )
    for (const route of ['/reschedule/preview', '/reschedule/apply'])
      expect(
        help.value.routes.some((entry) => entry.method === 'POST' && entry.path === route)
      ).toBe(true)
  })

  it("previews the token's project's overdue tasks without changing them, then applies", async () => {
    const mine = planning.createWorkItem(
      'home-project',
      { title: 'Mine', targetDate: '2026-10-01', startDate: '2026-09-30', assigneeId: meId },
      human
    )
    const nobody = planning.createWorkItem(
      'home-project',
      { title: 'Nobody', targetDate: '2026-10-05' },
      human
    )
    const elsewhere = planning.createWorkItem(
      'other-project',
      { title: 'Elsewhere', targetDate: '2026-10-01' },
      human
    )

    const preview = await call<ReschedulePlan>('/reschedule/preview', { mode: 'tomorrow', today })
    expect(preview.status).toBe(200)
    expect(preview.value.entries.map((entry) => entry.id).sort()).toEqual(
      [mine.id, nobody.id].sort()
    )
    expect(preview.value.entries.find((entry) => entry.id === mine.id)).toMatchObject({
      toDue: '2026-10-16',
      toStart: '2026-10-15'
    })
    expect(planning.getWorkItem(mine.id).targetDate).toBe('2026-10-01')

    const applied = await call<RescheduleResult>('/reschedule/apply', {
      mode: 'date',
      date: '2026-10-20',
      today,
      workItemIds: [nobody.id]
    })
    expect(applied.status).toBe(200)
    expect(applied.value.changed).toEqual([
      { id: nobody.id, fromDue: '2026-10-05', toDue: '2026-10-20', fromStart: null, toStart: null }
    ])
    expect(planning.getWorkItem(nobody.id).targetDate).toBe('2026-10-20')
    expect(planning.getWorkItem(mine.id).targetDate).toBe('2026-10-01')
    expect(planning.getWorkItem(elsewhere.id).targetDate).toBe('2026-10-01')
  })

  it("refuses another project's task and a bad mode", async () => {
    const elsewhere = planning.createWorkItem(
      'other-project',
      { title: 'Elsewhere', targetDate: '2026-10-01' },
      human
    )
    const foreign = await call('/reschedule/apply', {
      mode: 'today',
      today,
      workItemIds: [elsewhere.id]
    })
    expect(foreign.status).toBe(400)
    expect(planning.getWorkItem(elsewhere.id).targetDate).toBe('2026-10-01')
    const bad = await call('/reschedule/preview', { mode: 'someday' })
    expect(bad.status).toBe(400)
  })
})
