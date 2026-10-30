import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type {
  PersonalGoalCheckIn,
  PersonalGoalView,
  PinView,
  PlanningGoal,
  SetCountsTowardsResult,
  WatchedProject
} from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

const PROJECT = '0f4c8f43-5ac0-4b6b-9f5a-2a3c1c8e5d11'
const OTHER = 'a8d3f0e2-7c41-4f2b-9b3e-6d5e4c3b2a10'

const POUNDS = {
  unit: '£',
  startValue: 0,
  targetValue: 5000,
  startDate: '2026-01-01',
  targetDate: '2026-12-31'
}

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id === PROJECT ? 'Side business' : 'House',
    automationToken: token
  })
}

describe('goals of one’s own over the automation API (N5.6b)', () => {
  const root = useTempDir('ostler-personal-goals-http-')
  let planning: PlanningService
  let server: AutomationHttpServer
  let project: WatchedProject
  let other: WatchedProject
  let port: number

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
    port = await startOnFreePort((free) => server.start(free))
  })

  afterEach(() => {
    server?.stop()
    planning?.close()
  })

  function call(method: string, urlPath: string, body?: unknown, token = 'token-one') {
    const id = token === 'token-one' ? project.id : other.id
    return fetch(`http://127.0.0.1:${port}/automation/${id}${urlPath}`, {
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

  async function failure(response: Response): Promise<string> {
    const body = (await response.json()) as { ok: boolean; error?: string }
    expect(body.ok).toBe(false)
    return body.error ?? ''
  }

  it('creates, lists, changes and deletes goals of one’s own with any project’s token', async () => {
    expect(await value<PersonalGoalView[]>(await call('GET', '/personal-goals'))).toEqual([])
    const created = await value<PersonalGoalView>(
      await call('POST', '/personal-goals', { title: 'Save £5,000', measure: POUNDS })
    )
    expect(created).toMatchObject({ title: 'Save £5,000', status: 'active', fromLinks: false })
    expect(created.measure?.direction).toBe('up')

    // Shared by every project, as people are.
    const seen = await value<PersonalGoalView[]>(
      await call('GET', '/personal-goals', undefined, 'token-two')
    )
    expect(seen.map((goal) => goal.id)).toEqual([created.id])
    const one = await value<PersonalGoalView>(
      await call('GET', `/personal-goals/${created.id}`, undefined, 'token-two')
    )
    expect(one.title).toBe('Save £5,000')

    const changed = await value<PersonalGoalView>(
      await call('PATCH', `/personal-goals/${created.id}`, { status: 'achieved' }, 'token-two')
    )
    expect(changed.status).toBe('achieved')
    expect(
      await failure(await call('PATCH', `/personal-goals/${created.id}`, { status: 'archived' }))
    ).toMatch(/active, achieved or dropped/)
    expect(await failure(await call('POST', '/personal-goals', { title: '' }))).toMatch(
      /needs a title/
    )

    expect(await value(await call('DELETE', `/personal-goals/${created.id}`))).toEqual({
      id: created.id,
      deleted: true
    })
    expect(await failure(await call('GET', `/personal-goals/${created.id}`))).toMatch(
      /Goal not found/
    )
  })

  it('records, lists and removes check-ins under a goal of one’s own', async () => {
    const goal = await value<PersonalGoalView>(
      await call('POST', '/personal-goals', { title: 'Save £5,000', measure: POUNDS })
    )
    const first = await value<{ checkIn: PersonalGoalCheckIn; replaced: null }>(
      await call('POST', `/personal-goals/${goal.id}/check-ins`, { date: '2026-03-01', value: 800 })
    )
    expect(first.checkIn).toMatchObject({ date: '2026-03-01', value: 800, note: '' })
    const second = await value<{ checkIn: PersonalGoalCheckIn; replaced: PersonalGoalCheckIn }>(
      await call('POST', `/personal-goals/${goal.id}/check-ins`, {
        date: '2026-03-01',
        value: 900,
        note: 'Bonus'
      })
    )
    expect(second.replaced.value).toBe(800)
    const listed = await value<PersonalGoalCheckIn[]>(
      await call('GET', `/personal-goals/${goal.id}/check-ins`)
    )
    expect(listed.map((entry) => entry.value)).toEqual([900])
    const removed = await value<PersonalGoalCheckIn>(
      await call('DELETE', `/personal-goals/${goal.id}/check-ins/2026-03-01`)
    )
    expect(removed.note).toBe('Bonus')
    expect(
      await failure(await call('DELETE', `/personal-goals/${goal.id}/check-ins/2026-03-01`))
    ).toMatch(/Check-in not found/)
  })

  it('lets a project goal count towards one through PUT counts-towards, and refuses a unit that differs', async () => {
    const save = await value<PersonalGoalView>(
      await call('POST', '/personal-goals', { title: 'Save £5,000', measure: POUNDS })
    )
    const side = await value<PlanningGoal>(
      await call('POST', '/goals', {
        title: 'Side income',
        measure: { ...POUNDS, targetValue: 2000 }
      })
    )
    await call('POST', `/goals/${side.id}/check-ins`, { date: '2026-04-01', value: 700 })
    const linked = await value<SetCountsTowardsResult>(
      await call('PUT', `/goals/${side.id}/counts-towards`, { personalGoalId: save.id })
    )
    expect(linked).toEqual({ goalId: side.id, personalGoalId: save.id, previous: null })
    const [view] = await value<PersonalGoalView[]>(await call('GET', '/personal-goals'))
    expect(view.fromLinks).toBe(true)
    expect(view.progress?.latest).toBe(700)
    expect(view.links.map((link) => [link.goalId, link.projectId, link.latest])).toEqual([
      [side.id, PROJECT, 700]
    ])

    // Another project's token cannot change this project's goal.
    expect(
      await failure(
        await call('PUT', `/goals/${side.id}/counts-towards`, { personalGoalId: null }, 'token-two')
      )
    ).toMatch(/another project/)

    const km = await value<PlanningGoal>(
      await call('POST', '/goals', { title: 'Run', measure: { ...POUNDS, unit: 'km' } })
    )
    expect(
      await failure(
        await call('PUT', `/goals/${km.id}/counts-towards`, { personalGoalId: save.id })
      )
    ).toMatch(/Only goals with the same unit count towards it/)
    expect(await failure(await call('PUT', `/goals/${km.id}/counts-towards`, {}))).toMatch(
      /Send personalGoalId/
    )

    const unlinked = await value<SetCountsTowardsResult>(
      await call('PUT', `/goals/${side.id}/counts-towards`, { personalGoalId: null })
    )
    expect(unlinked.previous).toBe(save.id)
    const [after] = await value<PersonalGoalView[]>(await call('GET', '/personal-goals'))
    expect(after.links).toEqual([])
    // Removing the link left the project goal's check-ins alone.
    const checkIns = await value<unknown[]>(await call('GET', `/goals/${side.id}/check-ins`))
    expect(checkIns).toHaveLength(1)
  })

  it('pins a goal of one’s own to the sidebar, listed under personal for every token', async () => {
    const save = await value<PersonalGoalView>(
      await call('POST', '/personal-goals', {
        title: 'Save £5,000',
        measure: { ...POUNDS, targetDate: '2026-11-21' }
      })
    )
    const pin = await value<PinView>(
      await call('POST', '/pins', { place: 'sidebar', kind: 'personal-goal', targetId: save.id })
    )
    expect(pin.projectId).toBe('')
    const listed = await value<{ personal: PinView[]; sidebar: PinView[] }>(
      await call('GET', '/pins', undefined, 'token-two')
    )
    expect(listed.personal.map((entry) => entry.id)).toEqual([pin.id])
    expect(listed.sidebar).toEqual([])
    const counting = await value<PinView>(
      await call('PATCH', `/pins/${pin.id}`, { countdown: true }, 'token-two')
    )
    expect(counting.countdown).toBe(true)
    expect(counting.countdownText).toMatch(/to Save £5,000/)
  })

  it('describes the routes in its help', async () => {
    const response = await call('GET', '/help')
    const text = JSON.stringify(await response.json())
    for (const route of [
      '/personal-goals',
      '/personal-goals/:personalGoalId',
      '/personal-goals/:personalGoalId/check-ins',
      '/personal-goals/:personalGoalId/check-ins/:date',
      '/goals/:goalId/counts-towards'
    ])
      expect(text).toContain(route)
  })
})
