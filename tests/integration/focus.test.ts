import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { FocusService } from '../../electron/services/focus-service'
import { PlanningService } from '../../electron/services/planning-service'
import {
  DEFAULT_FOCUS_SETTINGS,
  type FocusState,
  type TimerStart,
  type WatchedProject
} from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id === 'focus-project' ? 'Website' : 'Garden',
    automationToken: token
  })
}

describe('focus routes (N3.5)', () => {
  const root = useTempDir('ostler-focus-http-')
  let planning: PlanningService
  let focus: FocusService
  let server: AutomationHttpServer
  const project = watched('focus-project', 'token-one')
  const other = watched('other-project', 'token-two')

  beforeEach(async () => {
    planning = new PlanningService(await createMigratedDatabase(root()), () => [
      project.id,
      other.id
    ])
    focus = new FocusService({
      time: planning.time,
      settings: () => DEFAULT_FOCUS_SETTINGS,
      rememberLength: () => {}
    })
    planning.time.setChangedListener(() => focus.timerChanged())
    server = new AutomationHttpServer(
      () => [project, other],
      path.join(root(), 'runtime'),
      undefined,
      planning
    )
    server.focus = focus
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
    focus?.dispose()
    planning?.close()
  })

  function call(method: string, urlPath: string, body?: unknown, token = 'token-one') {
    return fetch(`http://127.0.0.1:${PORT}/automation/${project.id}${urlPath}`, {
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
    expect(routes).toEqual(expect.arrayContaining(['GET /focus', 'POST /focus', 'DELETE /focus']))
  })

  it("starts, reads and stops a focus on this project's tasks only", async () => {
    const human = { kind: 'human' as const }
    const task = planning.createWorkItem(project.id, { title: 'Write the proposal' }, human)
    const theirs = planning.createWorkItem(other.id, { title: 'Theirs' }, human)

    expect(await value(await call('GET', '/focus'))).toBeNull()

    const started = await value<{ focus: FocusState; timer: TimerStart }>(
      await call('POST', '/focus', { workItemId: task.id, minutes: 25 })
    )
    expect(started.focus).toMatchObject({
      workItemId: task.id,
      workItemTitle: 'Write the proposal',
      phase: 'focus',
      minutes: 25
    })
    expect(started.focus.endsAt - started.focus.startedAt).toBe(25 * 60_000)
    expect(started.timer.started.workItemId).toBe(task.id)
    expect(planning.time.timerState().running?.id).toBe(started.timer.started.id)
    expect(focus.holdsNotifications()).toBe(true)

    const read = await value<FocusState>(await call('GET', '/focus'))
    expect(read.id).toBe(started.focus.id)

    // Another project's task, a bad length and no task are refused.
    const refused = await call('POST', '/focus', { workItemId: theirs.id, minutes: 25 })
    expect(refused.status).toBe(400)
    const short = await call('POST', '/focus', { workItemId: task.id, minutes: 2 })
    expect(short.status).toBe(400)
    expect(((await short.json()) as { error: string }).error).toContain('5 to 180')
    expect((await call('POST', '/focus', { minutes: 25 })).status).toBe(400)
    expect(focus.get()?.id).toBe(started.focus.id)

    expect(await value(await call('DELETE', '/focus'))).toBeNull()
    expect(focus.get()).toBeNull()
    // The timer stopped too (within its first second, so R2.3 keeps no entry).
    expect(planning.time.timerState().running).toBeNull()
  })

  it('stopping the timer through the API ends the focus', async () => {
    const task = planning.createWorkItem(project.id, { title: 'Write' }, { kind: 'human' })
    await value(await call('POST', '/focus', { workItemId: task.id, minutes: 50 }))
    await value(await call('POST', '/timer/stop'))
    expect(await value(await call('GET', '/focus'))).toBeNull()
  })

  it('needs the token', async () => {
    const response = await call('GET', '/focus', undefined, 'wrong')
    expect(response.status).toBe(401)
  })
})
