import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type {
  GoalCheckIn,
  GoalCheckInResult,
  PlanningGoal,
  WatchedProject
} from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
const PROJECT = '6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b'
const OTHER = '3f333df6-90a4-4fda-8dd3-9485d27cee36'

const MEASURE = {
  unit: 'members',
  startValue: 0,
  targetValue: 200,
  startDate: '2026-10-01',
  targetDate: '2026-12-31'
}

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id === PROJECT ? 'Club' : 'Garden',
    automationToken: token
  })
}

describe('goal measures and check-ins over the automation API (N5.6a)', () => {
  const root = useTempDir('ostler-goal-http-')
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

  it('reads and writes measure on the goal routes', async () => {
    const created = await value<PlanningGoal>(
      await call('POST', '/goals', { title: 'Sign up members', measure: MEASURE })
    )
    expect(created.measure).toEqual({ ...MEASURE, direction: 'up' })
    const listed = await value<PlanningGoal[]>(await call('GET', '/goals'))
    expect(listed[0].measure).toEqual({ ...MEASURE, direction: 'up' })

    const refused = await call('PATCH', `/goals/${created.id}`, {
      measure: { ...MEASURE, direction: 'down' }
    })
    expect(refused.status).toBe(400)

    const cleared = await value<PlanningGoal>(
      await call('PATCH', `/goals/${created.id}`, { measure: null })
    )
    expect(cleared.measure).toBeNull()
  })

  it('records, replaces, lists and removes check-ins', async () => {
    const goal = await value<PlanningGoal>(
      await call('POST', '/goals', { title: 'Sign up members', measure: MEASURE })
    )
    const first = await value<GoalCheckInResult>(
      await call('POST', `/goals/${goal.id}/check-ins`, { date: '2026-10-10', value: 40 })
    )
    expect(first.replaced).toBeNull()
    const second = await value<GoalCheckInResult>(
      await call('POST', `/goals/${goal.id}/check-ins`, {
        date: '2026-10-10',
        value: 42,
        note: 'After the fair'
      })
    )
    expect(second.replaced?.value).toBe(40)
    await call('POST', `/goals/${goal.id}/check-ins`, { date: '2026-10-03', value: 12 })
    const listed = await value<GoalCheckIn[]>(await call('GET', `/goals/${goal.id}/check-ins`))
    expect(listed.map((entry) => [entry.date, entry.value])).toEqual([
      ['2026-10-03', 12],
      ['2026-10-10', 42]
    ])

    const removed = await value<GoalCheckIn>(
      await call('DELETE', `/goals/${goal.id}/check-ins/2026-10-03`)
    )
    expect(removed.value).toBe(12)
    expect(
      await value<GoalCheckIn[]>(await call('GET', `/goals/${goal.id}/check-ins`))
    ).toHaveLength(1)
    expect((await call('DELETE', `/goals/${goal.id}/check-ins/2026-10-03`)).status).toBe(400)
    expect(
      (await call('POST', `/goals/${goal.id}/check-ins`, { date: 'soon', value: 1 })).status
    ).toBe(400)
  })

  it("refuses another project's goal", async () => {
    const goal = await value<PlanningGoal>(await call('POST', '/goals', { title: 'Members' }))
    const response = await call('GET', `/goals/${goal.id}/check-ins`, undefined, 'token-two')
    expect(response.status).toBe(400)
  })

  it('describes the routes in help', async () => {
    const help = await value<{ routes: { method: string; path: string; request?: string }[] }>(
      await call('GET', '/help?full=1')
    )
    const routes = help.routes.map((route) => `${route.method} ${route.path}`)
    expect(routes).toEqual(
      expect.arrayContaining([
        'GET /goals/:goalId/check-ins',
        'POST /goals/:goalId/check-ins',
        'DELETE /goals/:goalId/check-ins/:date'
      ])
    )
    const create = help.routes.find((route) => route.method === 'POST' && route.path === '/goals')
    expect(create?.request).toMatch(/measure/)
  })
})
