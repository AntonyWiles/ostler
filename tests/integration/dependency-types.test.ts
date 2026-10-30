import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import type { PlanningWorkItem, WatchedProject } from '../../src/shared/ostler-api'
import type { DependentMovePlan } from '../../src/shared/planning/move-dependents'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
const human = { kind: 'human' as const }

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id,
    addedAt: Date.now(),
    automationToken: token,
    estimateUnit: 'hours'
  })
}

describe('waits-on types and lag on the automation API (N7.2a)', () => {
  const root = useTempDir('ostler-automation-dependency-types-')
  let projects: WatchedProject[]
  let planning: PlanningService
  let people: PeopleService
  let server: AutomationHttpServer

  beforeEach(async () => {
    projects = [watched('home-project', 'token-one')]
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
    method = 'POST'
  ): Promise<{ status: number; ok: boolean; value: T; error?: string }> {
    const project = projects[0]
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

  const plaster = () =>
    planning.createWorkItem(
      'home-project',
      { title: 'Plastering', startDate: '2026-10-12', targetDate: '2026-10-14' },
      human
    )

  it('documents dependencyLinks, types and lag in /help', async () => {
    const help = await call<{
      routes: Array<{ method: string; path: string; request?: string; response?: string }>
    }>('/help', undefined, 'GET')
    const create = help.value.routes.find(
      (entry) => entry.method === 'POST' && entry.path === '/work-items'
    )
    expect(create?.request).toContain('dependencyLinks')
    expect(create?.request).toContain('start-to-start')
    expect(create?.request).toContain('lagDays')
    const conflicts = help.value.routes.find((entry) => entry.path === '/dependency-conflicts')
    expect(conflicts?.response).toContain('earliest')
  })

  it('writes and reads dependencyLinks on POST and PATCH /work-items', async () => {
    const first = plaster()
    const created = await call<PlanningWorkItem>('/work-items', {
      title: 'Painting',
      startDate: '2026-10-14',
      targetDate: '2026-10-15',
      dependencyLinks: [{ id: first.id, type: 'start-to-start', lagDays: 2 }]
    })
    expect(created.status).toBe(200)
    expect(created.value.dependencyIds).toEqual([first.id])
    expect(created.value.dependencyLinks).toEqual([
      { id: first.id, type: 'start-to-start', lagDays: 2 }
    ])

    const listed = await call<PlanningWorkItem[]>('/work-items', undefined, 'GET')
    expect(listed.value.find((item) => item.id === created.value.id)?.dependencyLinks).toEqual([
      { id: first.id, type: 'start-to-start', lagDays: 2 }
    ])

    const patched = await call<PlanningWorkItem>(
      `/work-items/${created.value.id}`,
      { dependencyLinks: [{ id: first.id, type: 'finish-to-finish', lagDays: -1 }] },
      'PATCH'
    )
    expect(patched.value.dependencyLinks).toEqual([
      { id: first.id, type: 'finish-to-finish', lagDays: -1 }
    ])
    // The change is in the task's activity, as the app's would be.
    const activity = await call<{ entries: { field?: string; summary: string }[] }>(
      `/work-items/${created.value.id}/activity`,
      undefined,
      'GET'
    )
    expect(activity.value.entries.filter((entry) => entry.field === 'dependencyLink').length).toBe(
      1
    )

    const refused = await call(
      `/work-items/${created.value.id}`,
      { dependencyLinks: [{ id: first.id, type: 'start-to-finish' }] },
      'PATCH'
    )
    expect(refused.status).toBe(400)
    const tooLong = await call(
      `/work-items/${created.value.id}`,
      { dependencyLinks: [{ id: first.id, lagDays: 400 }] },
      'PATCH'
    )
    expect(tooLong.status).toBe(400)
  })

  it('lets old clients use dependencyIds: finish to start, 0 days, keeping a link’s type', async () => {
    const first = plaster()
    const second = planning.createWorkItem('home-project', { title: 'Data' }, human)
    const created = await call<PlanningWorkItem>('/work-items', {
      title: 'Painting',
      dependencyIds: [first.id]
    })
    expect(created.value.dependencyLinks).toEqual([
      { id: first.id, type: 'finish-to-start', lagDays: 0 }
    ])
    planning.updateWorkItem(
      created.value.id,
      { dependencyLinks: [{ id: first.id, type: 'start-to-start', lagDays: 3 }] },
      human
    )
    const patched = await call<PlanningWorkItem>(
      `/work-items/${created.value.id}`,
      { dependencyIds: [first.id, second.id] },
      'PATCH'
    )
    expect(patched.value.dependencyLinks).toEqual([
      { id: first.id, type: 'start-to-start', lagDays: 3 },
      { id: second.id, type: 'finish-to-start', lagDays: 0 }
    ])
  })

  it('judges /dependency-conflicts and moveDependents by each link’s type and lag', async () => {
    const first = plaster()
    // Starts on the day Plastering is due: fine finish to start, too early with a lag of 1.
    const painting = planning.createWorkItem(
      'home-project',
      {
        title: 'Painting',
        startDate: '2026-10-14',
        targetDate: '2026-10-15',
        dependencyLinks: [{ id: first.id, type: 'finish-to-start', lagDays: 1 }]
      },
      human
    )
    const conflicts = await call<unknown[]>('/dependency-conflicts', undefined, 'GET')
    expect(conflicts.value).toEqual([
      {
        taskId: painting.id,
        dependencyId: first.id,
        start: '2026-10-14',
        dependencyDue: '2026-10-14',
        type: 'finish-to-start',
        lagDays: 1,
        earliest: '2026-10-15'
      }
    ])

    // Start to start, two days after: Plastering starting a day later pushes Painting a day.
    planning.updateWorkItem(
      painting.id,
      {
        startDate: '2026-10-14',
        dependencyLinks: [{ id: first.id, type: 'start-to-start', lagDays: 2 }]
      },
      human
    )
    expect((await call<unknown[]>('/dependency-conflicts', undefined, 'GET')).value).toEqual([])
    const preview = await call<DependentMovePlan>(
      `/work-items/${first.id}`,
      { startDate: '2026-10-13', moveDependents: 'preview' },
      'PATCH'
    )
    expect(preview.status).toBe(200)
    expect(preview.value.entries.map((entry) => [entry.id, entry.days, entry.toStart])).toEqual([
      [painting.id, 1, '2026-10-15']
    ])
  })
})
