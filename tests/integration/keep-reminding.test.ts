import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type { PlanningReminder, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({ id, name: id, addedAt: Date.now(), automationToken: token })
}

describe('automation-http-server.ts reminders that keep reminding (N1.7)', () => {
  const root = useTempDir('ostler-automation-keep-reminding-')
  let projects: WatchedProject[]
  let planning: PlanningService
  let server: AutomationHttpServer

  beforeEach(async () => {
    projects = [watched('home-project', 'token-one')]
    const databasePath = await createMigratedDatabase(root())
    planning = new PlanningService(databasePath, () => projects.map((project) => project.id))
    server = new AutomationHttpServer(
      () => projects,
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

  async function call<T = unknown>(
    method: string,
    route: string,
    body?: unknown
  ): Promise<{ status: number; ok: boolean; value: T; error?: string }> {
    const project = projects[0]
    const response = await fetch(`http://127.0.0.1:${PORT}/automation/${project.id}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${project.automationToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const json = (await response.json()) as { ok: boolean; value: T; error?: string }
    return { status: response.status, ...json }
  }

  it('lists the stop route in /help', async () => {
    const help = await call<{ routes: Array<{ method: string; path: string }> }>('GET', '/help')
    expect(
      help.value.routes.some(
        (r) =>
          r.method === 'POST' && r.path === '/work-items/:workItemId/reminders/:reminderId/stop'
      )
    ).toBe(true)
  })

  it('adds a reminder that keeps reminding, and stops it', async () => {
    const task = planning.createWorkItem('home-project', { title: 'Call' }, { kind: 'human' })
    const remindAt = Date.now() + 60 * 60 * 1000
    const added = await call<PlanningReminder>('POST', `/work-items/${task.id}/reminders`, {
      remindAt,
      keepReminding: true,
      intervalMinutes: 30
    })
    expect(added.status).toBe(200)
    expect(added.value).toMatchObject({ keepReminding: true, intervalMinutes: 30, stoppedAt: null })

    // The default interval when none is given.
    const fallback = await call<PlanningReminder>('POST', `/work-items/${task.id}/reminders`, {
      remindAt,
      keepReminding: true
    })
    expect(fallback.value.intervalMinutes).toBe(15)

    const refused = await call('POST', `/work-items/${task.id}/reminders`, {
      remindAt,
      keepReminding: true,
      intervalMinutes: 10
    })
    expect(refused.ok).toBe(false)

    const stopped = await call<PlanningReminder>(
      'POST',
      `/work-items/${task.id}/reminders/${added.value.id}/stop`
    )
    expect(stopped.status).toBe(200)
    expect(stopped.value.stoppedAt).toEqual(expect.any(Number))
    expect(planning.reminders.get(added.value.id)!.stoppedAt).toBe(stopped.value.stoppedAt)

    const plain = await call<PlanningReminder>('POST', `/work-items/${task.id}/reminders`, {
      remindAt
    })
    expect(plain.value.keepReminding).toBe(false)
    const notKeeping = await call('POST', `/work-items/${task.id}/reminders/${plain.value.id}/stop`)
    expect(notKeeping.ok).toBe(false)
    expect(notKeeping.error).toMatch(/does not keep reminding/)
  })
})
