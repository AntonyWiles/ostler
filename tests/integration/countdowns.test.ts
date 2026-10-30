import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type { PinView, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
const PROJECT = '0f8fad5b-d9cb-469f-a165-70867728950e'
/** A fixed today, a Monday: the words never depend on the real date. */
const TODAY = '2026-03-02'

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({ id, name: 'Website', automationToken: token, estimateUnit: 'hours' })
}

describe('countdowns over the automation API (N5.2b)', () => {
  const root = useTempDir('ostler-countdowns-http-')
  let planning: PlanningService
  let server: AutomationHttpServer
  const project = watched(PROJECT, 'token-one')
  const human = { kind: 'human' as const }

  beforeEach(async () => {
    const dbPath = await createMigratedDatabase(root())
    planning = new PlanningService(dbPath, () => [project.id])
    planning.pins.setCountdownContext(() => ({ today: TODAY, daysOff: [] }))
    server = new AutomationHttpServer(
      () => [project],
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

  function call(method: string, urlPath: string, body?: unknown) {
    return fetch(`http://127.0.0.1:${PORT}/automation/${PROJECT}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-one' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }

  async function value<T>(response: Response): Promise<T> {
    const body = (await response.json()) as { ok: boolean; value: T; error?: string }
    if (!body.ok) throw new Error(body.error)
    return body.value
  }

  const pinTask = async (title: string, targetDate: string | null) => {
    const task = planning.createWorkItem(PROJECT, { title, targetDate }, human)
    return value<PinView>(
      await call('POST', '/pins', { place: 'sidebar', kind: 'task', targetId: task.id })
    )
  }

  it('describes PATCH /pins/:pinId in help', async () => {
    const help = await value<{ routes: { method: string; path: string; description: string }[] }>(
      await call('GET', '/help')
    )
    const route = help.routes.find(
      (entry) => entry.method === 'PATCH' && entry.path === '/pins/:pinId'
    )
    expect(route?.description).toMatch(/countdown/)
  })

  it('reads and sets countdown, with the worded countdown', async () => {
    const pin = await pinTask('Launch', '2026-03-14')
    expect(pin).toMatchObject({ countdown: false, date: '2026-03-14', countdownText: null })

    const on = await value<PinView>(await call('PATCH', `/pins/${pin.id}`, { countdown: true }))
    expect(on).toMatchObject({
      countdown: true,
      countdownText: '12 days to Launch (9 working days)'
    })
    const listed = await value<{ sidebar: PinView[] }>(await call('GET', '/pins'))
    expect(listed.sidebar[0]).toMatchObject({ countdown: true, countdownText: on.countdownText })

    const off = await value<PinView>(await call('PATCH', `/pins/${pin.id}`, { countdown: false }))
    expect(off).toMatchObject({ countdown: false, countdownText: null })
  })

  it('refuses a fourth countdown unless one is named to turn off', async () => {
    const made: PinView[] = []
    for (const [index, title] of ['A', 'B', 'C', 'D'].entries())
      made.push(await pinTask(title, `2026-04-0${index + 1}`))
    for (const pin of made.slice(0, 3))
      await value(await call('PATCH', `/pins/${pin.id}`, { countdown: true }))

    const refused = await call('PATCH', `/pins/${made[3].id}`, { countdown: true })
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { error: string }).error).toMatch(/At most 3/)

    await value(
      await call('PATCH', `/pins/${made[3].id}`, { countdown: true, replacePinId: made[0].id })
    )
    const listed = await value<{ sidebar: PinView[] }>(await call('GET', '/pins'))
    expect(listed.sidebar.filter((pin) => pin.countdown).map((pin) => pin.title)).toEqual([
      'B',
      'C',
      'D'
    ])
  })

  it('refuses a bad body and an undated task', async () => {
    const pin = await pinTask('Someday', null)
    expect((await call('PATCH', `/pins/${pin.id}`, { countdown: 'yes' })).status).toBe(400)
    expect((await call('PATCH', `/pins/${pin.id}`, { countdown: true })).status).toBe(400)
  })
})
