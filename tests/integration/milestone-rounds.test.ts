import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type {
  PlanningMilestone,
  PlanningWorkItem,
  WatchedProject
} from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
const PROJECT = '1c3cbd0b-5f43-4a43-9d2a-6f6f2c1d0a71'
const OTHER = '8a7d0e52-3b1e-4c58-8f0e-2a9b7c6d5e41'
const RULE = { every: 'month', interval: 1, monthDay: 1 }

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id === PROJECT ? 'Books' : 'Garden',
    automationToken: token
  })
}

describe('repeating rounds over the automation API (N5.7a)', () => {
  const root = useTempDir('ostler-rounds-http-')
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
    const json = (await response.json()) as { ok: boolean; value: T; error?: string }
    if (!json.ok) throw new Error(json.error)
    return json.value
  }

  async function accounts() {
    const milestone = await value<PlanningMilestone>(
      await call('POST', '/milestones', { name: 'Accounts', targetDate: '2027-04-10' })
    )
    await call('POST', '/work-items', {
      title: 'Gather receipts',
      milestoneId: milestone.id,
      startDate: '2027-04-01',
      targetDate: '2027-04-03'
    })
    return milestone
  }

  it('sets the schedule, makes the next round and stops repeating', async () => {
    const milestone = await accounts()
    const repeating = await value<PlanningMilestone>(
      await call('PUT', `/milestones/${milestone.id}/repeat`, {
        rule: RULE,
        lengthDays: 10,
        nextStart: '2027-05-01'
      })
    )
    expect(repeating.repeat).toEqual({
      rule: RULE,
      lengthDays: 10,
      nextStart: '2027-05-01',
      on: true
    })

    const round = await value<PlanningMilestone>(
      await call('POST', `/milestones/${milestone.id}/next-round`)
    )
    expect(round).toMatchObject({
      name: 'Accounts · May 2027',
      targetDate: '2027-05-10',
      previousRoundId: milestone.id,
      roundStart: '2027-05-01',
      repeat: { nextStart: '2027-06-01', on: true }
    })
    const tasks = await value<PlanningWorkItem[]>(await call('GET', '/work-items'))
    const copy = tasks.find((task) => task.milestoneId === round.id)!
    const source = tasks.find((task) => task.milestoneId === milestone.id)!
    expect(copy).toMatchObject({
      title: 'Gather receipts',
      status: 'backlog',
      startDate: '2027-05-01',
      targetDate: '2027-05-03',
      roundSourceId: source.id
    })

    const listed = await value<PlanningMilestone[]>(await call('GET', '/milestones'))
    expect(listed.find((entry) => entry.id === milestone.id)?.repeat).toBeUndefined()

    const stopped = await value<PlanningMilestone>(
      await call('DELETE', `/milestones/${round.id}/repeat`)
    )
    expect(stopped.repeat?.on).toBe(false)
    const refused = await call('POST', `/milestones/${round.id}/next-round`)
    expect(refused.status).toBe(400)
  })

  it('refuses a bad schedule, an earlier round and another project’s milestone', async () => {
    const milestone = await accounts()
    const bad = await call('PUT', `/milestones/${milestone.id}/repeat`, {
      rule: RULE,
      lengthDays: 0,
      nextStart: '2027-05-01'
    })
    expect(bad.status).toBe(400)
    await call('PUT', `/milestones/${milestone.id}/repeat`, {
      rule: RULE,
      lengthDays: 10,
      nextStart: '2027-05-01'
    })
    await call('POST', `/milestones/${milestone.id}/next-round`)
    const earlier = await call('PUT', `/milestones/${milestone.id}/repeat`, {
      rule: RULE,
      lengthDays: 10,
      nextStart: '2027-07-01'
    })
    expect(earlier.status).toBe(400)
    const elsewhere = await call(
      'POST',
      `/milestones/${milestone.id}/next-round`,
      undefined,
      'token-two'
    )
    expect(elsewhere.ok).toBe(false)
  })

  it('describes the routes in its help', async () => {
    const help = (await (await call('GET', '/help')).json()) as {
      value: { routes: { method: string; path: string }[] }
    }
    const routes = help.value.routes.map((route) => `${route.method} ${route.path}`)
    expect(routes).toEqual(
      expect.arrayContaining([
        'PUT /milestones/:milestoneId/repeat',
        'DELETE /milestones/:milestoneId/repeat',
        'POST /milestones/:milestoneId/next-round'
      ])
    )
  })
})
