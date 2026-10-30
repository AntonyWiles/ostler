import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type { WatchedProject } from '../../src/shared/ostler-api'
import type {
  Baseline,
  BaselineComparison,
  BaselineWithEntries
} from '../../src/shared/planning/baselines'
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
    name: id === PROJECT ? 'House' : 'Garden',
    automationToken: token
  })
}

describe('baselines over the automation API (N7.4)', () => {
  const root = useTempDir('ostler-baselines-http-')
  let planning: PlanningService
  let server: AutomationHttpServer
  let project: WatchedProject
  let other: WatchedProject

  beforeEach(async () => {
    project = watched(PROJECT, 'token-one')
    other = watched(OTHER, 'token-two')
    const dbPath = await createMigratedDatabase(root())
    planning = new PlanningService(dbPath, () => [project.id, other.id])
    server = new AutomationHttpServer(
      () => [project, other],
      path.join(root(), 'runtime'),
      undefined,
      planning
    )
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
    const help = await value<{ routes: { method: string; path: string }[] }>(
      await call('GET', '/help')
    )
    const routes = help.routes.map((route) => `${route.method} ${route.path}`)
    expect(routes).toEqual(
      expect.arrayContaining([
        'GET /baselines',
        'POST /baselines',
        'GET /baselines/:baselineId',
        'PATCH /baselines/:baselineId',
        'DELETE /baselines/:baselineId',
        'GET /baselines/:baselineId/compare'
      ])
    )
  })

  it('saves, lists, compares, renames and deletes', async () => {
    const paint = planning.createWorkItem(
      project.id,
      { title: 'Paint', startDate: '2026-10-20', targetDate: '2026-10-23' },
      planning.humanActor()
    )
    const saved = await value<Baseline>(
      await call('POST', '/baselines', { name: 'Plan agreed 3 October' })
    )
    expect(saved).toMatchObject({ name: 'Plan agreed 3 October', taskCount: 1, milestoneCount: 0 })
    expect(await value<Baseline[]>(await call('GET', '/baselines'))).toHaveLength(1)
    const full = await value<BaselineWithEntries>(await call('GET', `/baselines/${saved.id}`))
    expect(full.entries).toEqual([
      { kind: 'task', itemId: paint.id, start: '2026-10-20', due: '2026-10-23' }
    ])

    // Moved later through the API: the baseline stays, the comparison says so.
    await value(await call('PATCH', `/work-items/${paint.id}`, { targetDate: '2026-10-26' }))
    const fresh = await value<{ id: string }>(await call('POST', '/work-items', { title: 'Tile' }))
    const compared = await value<BaselineComparison>(
      await call('GET', `/baselines/${saved.id}/compare`)
    )
    expect(compared.changes).toEqual([
      expect.objectContaining({ itemId: paint.id, startDays: 0, dueDays: 3 })
    ])
    expect(compared.added).toEqual([{ kind: 'task', itemId: fresh.id }])
    expect(compared.summary).toEqual({ later: 1, earlier: 0, unchanged: 0, added: 1 })

    const renamed = await value<Baseline>(
      await call('PATCH', `/baselines/${saved.id}`, { name: 'Signed off' })
    )
    expect(renamed.name).toBe('Signed off')
    expect((await call('PATCH', `/baselines/${saved.id}`, { name: '' })).status).toBe(400)

    await value(await call('DELETE', `/baselines/${saved.id}`))
    expect(await value<Baseline[]>(await call('GET', '/baselines'))).toEqual([])
  })

  it('refuses an eleventh without replaceId, and keeps projects apart', async () => {
    const made: Baseline[] = []
    for (let i = 0; i < 10; i++)
      made.push(await value<Baseline>(await call('POST', '/baselines', { name: `Plan ${i}` })))
    expect((await call('POST', '/baselines', { name: 'Eleventh' })).status).toBe(400)
    await value(await call('POST', '/baselines', { name: 'Eleventh', replaceId: made[0].id }))
    expect(await value<Baseline[]>(await call('GET', '/baselines'))).toHaveLength(10)

    expect((await call('GET', `/baselines/${made[1].id}`, undefined, 'token-two')).status).toBe(400)
    expect(
      await value<Baseline[]>(await call('GET', '/baselines', undefined, 'token-two'))
    ).toEqual([])
  })
})
