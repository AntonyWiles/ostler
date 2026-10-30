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
const OTHER = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id === PROJECT ? 'Website' : 'Garden',
    automationToken: token,
    estimateUnit: 'hours'
  })
}

describe('pins over the automation API (N5.2a)', () => {
  const root = useTempDir('ostler-pins-http-')
  let planning: PlanningService
  let server: AutomationHttpServer
  const project = watched(PROJECT, 'token-one')
  const other = watched(OTHER, 'token-two')
  const human = { kind: 'human' as const }

  beforeEach(async () => {
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

  it('describes the pin routes in help', async () => {
    const help = await value<{ routes: { method: string; path: string }[] }>(
      await call('GET', '/help')
    )
    const routes = help.routes.map((route) => `${route.method} ${route.path}`)
    for (const route of [
      'GET /pins',
      'POST /pins',
      'DELETE /pins/:pinId',
      'POST /pins/:pinId/move'
    ])
      expect(routes).toContain(route)
  })

  it('pins, lists, moves and unpins, leaving the items alone', async () => {
    const a = planning.createWorkItem(project.id, { title: 'Fix the header' }, human)
    const milestone = planning.createMilestone(project.id, { name: 'Launch' })

    const first = await value<PinView>(
      await call('POST', '/pins', { place: 'sidebar', kind: 'task', targetId: a.id })
    )
    expect(first).toMatchObject({ title: 'Fix the header', exists: true, place: 'sidebar' })
    const second = await value<PinView>(
      await call('POST', '/pins', { place: 'sidebar', kind: 'milestone', targetId: milestone.id })
    )
    const shortcut = await value<PinView>(
      await call('POST', '/pins', { place: 'overview', kind: 'project-view', targetId: 'board' })
    )
    expect(shortcut.projectId).toBe(project.id)

    let listed = await value<{ overview: PinView[]; sidebar: PinView[] }>(
      await call('GET', '/pins')
    )
    expect(listed.sidebar.map((pin) => pin.title)).toEqual(['Fix the header', 'Launch'])
    expect(listed.overview.map((pin) => pin.targetId)).toEqual(['board'])

    await value(await call('POST', `/pins/${second.id}/move`, { beforeId: first.id }))
    listed = await value(await call('GET', '/pins'))
    expect(listed.sidebar.map((pin) => pin.title)).toEqual(['Launch', 'Fix the header'])

    const removed = await value<{ id: string }>(await call('DELETE', `/pins/${first.id}`))
    expect(removed.id).toBe(first.id)
    expect(planning.getWorkItem(a.id).title).toBe('Fix the header')
    listed = await value(await call('GET', '/pins'))
    expect(listed.sidebar).toHaveLength(1)
  })

  it("refuses another project's items and pins, and bad input", async () => {
    const theirs = planning.createWorkItem(other.id, { title: 'Weed the beds' }, human)
    const refused = await call('POST', '/pins', {
      place: 'sidebar',
      kind: 'task',
      targetId: theirs.id
    })
    expect(refused.status).toBe(400)
    const bad = await call('POST', '/pins', { place: 'desk', kind: 'task', targetId: theirs.id })
    expect(bad.status).toBe(400)

    const theirPin = await value<PinView>(
      await call(
        'POST',
        '/pins',
        { place: 'sidebar', kind: 'task', targetId: theirs.id },
        'token-two'
      )
    )
    expect((await call('DELETE', `/pins/${theirPin.id}`)).status).toBe(400)
    // This project's GET lists only sidebar pins pointing at its own items.
    const listed = await value<{ sidebar: PinView[] }>(await call('GET', '/pins'))
    expect(listed.sidebar).toEqual([])
  })
})
