import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type { TimeBlock, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id === 'blocks-project' ? 'Website' : 'Garden',
    automationToken: token,
    estimateUnit: 'hours'
  })
}

describe('time block routes (N3.4a)', () => {
  const root = useTempDir('ostler-time-blocks-http-')
  let planning: PlanningService
  let server: AutomationHttpServer
  const project = watched('blocks-project', 'token-one')
  const other = watched('other-project', 'token-two')

  beforeEach(async () => {
    planning = new PlanningService(await createMigratedDatabase(root()), () => [
      project.id,
      other.id
    ])
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
    expect(routes).toEqual(
      expect.arrayContaining([
        'GET /time-blocks',
        'POST /time-blocks',
        'PATCH /time-blocks/:blockId',
        'DELETE /time-blocks/:blockId'
      ])
    )
  })

  it("blocks, lists, moves and removes time for this project's tasks only", async () => {
    const human = { kind: 'human' as const }
    const task = planning.createWorkItem(project.id, { title: 'Write', estimate: 2 }, human)
    const theirs = planning.createWorkItem(other.id, { title: 'Theirs' }, human)

    const created = await call('POST', '/time-blocks', {
      workItemId: task.id,
      date: '2026-10-20',
      startMinute: 540
    })
    expect(created.status).toBe(201)
    const block = await value<TimeBlock>(created)
    expect(block).toMatchObject({ date: '2026-10-20', startMinute: 540, lengthMinutes: 120 })

    const listed = await value<TimeBlock[]>(
      await call('GET', '/time-blocks?from=2026-10-19&to=2026-10-25')
    )
    expect(listed.map((entry) => entry.id)).toEqual([block.id])
    expect((await call('GET', '/time-blocks')).status).toBe(400)

    const moved = await value<TimeBlock>(
      await call('PATCH', `/time-blocks/${block.id}`, { startMinute: 600, lengthMinutes: 45 })
    )
    expect(moved).toMatchObject({ startMinute: 600, lengthMinutes: 45 })
    expect(
      (await call('PATCH', `/time-blocks/${block.id}`, { startMinute: 601 })).status
    ).toBeGreaterThanOrEqual(400)

    // Another project's task, and this block from another project's token, are out of reach.
    expect(
      (
        await call('POST', '/time-blocks', {
          workItemId: theirs.id,
          date: '2026-10-20',
          startMinute: 540
        })
      ).status
    ).toBeGreaterThanOrEqual(400)
    const wrongToken = await fetch(
      `http://127.0.0.1:${PORT}/automation/${other.id}/time-blocks/${block.id}`,
      { method: 'DELETE', headers: { Authorization: 'Bearer token-two' } }
    )
    expect(wrongToken.status).toBeGreaterThanOrEqual(400)

    const removed = await value<TimeBlock>(await call('DELETE', `/time-blocks/${block.id}`))
    expect(removed.id).toBe(block.id)
    expect(
      await value<TimeBlock[]>(await call('GET', '/time-blocks?from=2026-10-19&to=2026-10-25'))
    ).toEqual([])
    // The task itself did not change.
    expect(planning.getWorkItem(task.id).targetDate ?? null).toBeNull()
  })

  it('puts blocks in the calendar file only with blocks=true', async () => {
    const human = { kind: 'human' as const }
    const task = planning.createWorkItem(
      project.id,
      { title: 'Write', targetDate: '2026-10-23' },
      human
    )
    const block = await value<TimeBlock>(
      await call('POST', '/time-blocks', {
        workItemId: task.id,
        date: '2026-10-20',
        startMinute: 540
      })
    )
    const plain = await (await call('GET', '/export?format=ics')).text()
    expect(plain).not.toContain(`block-${block.id}@`)
    const withBlocks = await (await call('GET', '/export?format=ics&blocks=true')).text()
    expect(withBlocks).toContain(`UID:block-${block.id}@`)
    // In UTC, from 09:00 on the computer's own clock.
    const start = new Date(2026, 9, 20, 9, 0).toISOString().replace(/[-:]/g, '').slice(0, 15)
    expect(withBlocks).toContain(`DTSTART:${start}Z`)
  })
})
