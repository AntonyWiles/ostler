import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import type { WatchedProject } from '../../src/shared/ostler-api'
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

describe('PATCH /work-items/:workItemId moveDependents (N7.1)', () => {
  const root = useTempDir('ostler-automation-move-dependents-')
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

  // Monday 12 to Friday 16 October 2026.
  const chain = () => {
    const a = planning.createWorkItem(
      'home-project',
      { title: 'A', targetDate: '2026-10-12' },
      human
    )
    const b = planning.createWorkItem(
      'home-project',
      { title: 'B', startDate: '2026-10-13', targetDate: '2026-10-14', dependencyIds: [a.id] },
      human
    )
    const c = planning.createWorkItem(
      'home-project',
      { title: 'C', targetDate: '2026-10-14', dependencyIds: [b.id] },
      human
    )
    return { a, b, c }
  }

  it('documents moveDependents in /help', async () => {
    const help = await call<{ routes: Array<{ method: string; path: string; request?: string }> }>(
      '/help?full=1',
      undefined,
      { method: 'GET' }
    )
    const patch = help.value.routes.find(
      (entry) => entry.method === 'PATCH' && entry.path === '/work-items/:workItemId'
    )
    expect(patch?.request).toContain('moveDependents')
  })

  it('"preview" returns the plan and changes nothing', async () => {
    const { a, b, c } = chain()
    const preview = await call<DependentMovePlan>(
      `/work-items/${a.id}`,
      { targetDate: '2026-10-14', moveDependents: 'preview' },
      { method: 'PATCH' }
    )
    expect(preview.status).toBe(200)
    expect(preview.value.entries.map((entry) => [entry.id, entry.toStart, entry.toDue])).toEqual([
      [b.id, '2026-10-15', '2026-10-16'],
      [c.id, null, '2026-10-16']
    ])
    expect(planning.getWorkItem(a.id).targetDate).toBe('2026-10-12')
    expect(planning.getWorkItem(b.id).targetDate).toBe('2026-10-14')
  })

  it('true moves the task and what waits on it together, and returns the moved tasks', async () => {
    const { a, b, c } = chain()
    const moved = await call<{
      workItem: { id: string; targetDate: string }
      dependents: {
        changed: Array<{ id: string; toDue: string }>
        skipped: unknown[]
        left: unknown[]
      }
    }>(
      `/work-items/${a.id}`,
      { targetDate: '2026-10-14', moveDependents: true },
      { method: 'PATCH' }
    )
    expect(moved.status).toBe(200)
    expect(moved.value.workItem).toMatchObject({ id: a.id, targetDate: '2026-10-14' })
    expect(moved.value.dependents.changed.map((change) => [change.id, change.toDue])).toEqual([
      [b.id, '2026-10-16'],
      [c.id, '2026-10-16']
    ])
    expect(planning.getWorkItem(b.id)).toMatchObject({
      startDate: '2026-10-15',
      targetDate: '2026-10-16'
    })
    expect(planning.getWorkItem(c.id).targetDate).toBe('2026-10-16')
  })

  it('moves nothing else without it, or when the task moves earlier', async () => {
    const { a, b } = chain()
    await call(`/work-items/${a.id}`, { targetDate: '2026-10-14' }, { method: 'PATCH' })
    expect(planning.getWorkItem(b.id).targetDate).toBe('2026-10-14')
    const earlier = await call<{ dependents: { changed: unknown[] } }>(
      `/work-items/${a.id}`,
      { targetDate: '2026-10-10', moveDependents: true },
      { method: 'PATCH' }
    )
    expect(earlier.value.dependents.changed).toEqual([])
    expect(planning.getWorkItem(b.id).targetDate).toBe('2026-10-14')
  })

  it('refuses a bad moveDependents and changes nothing', async () => {
    const { a } = chain()
    const bad = await call(
      `/work-items/${a.id}`,
      { targetDate: '2026-10-14', moveDependents: 'yes' },
      { method: 'PATCH' }
    )
    expect(bad.status).toBe(400)
    expect(planning.getWorkItem(a.id).targetDate).toBe('2026-10-12')
  })
})
