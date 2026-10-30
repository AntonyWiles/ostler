import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import type { HarnessService } from '../../electron/services/harness-service'
import { PlanningService } from '../../electron/services/planning-service'
import type {
  HarnessProjectState,
  PlanningWorkItem,
  WatchedProject
} from '../../src/shared/ostler-api'
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

describe('a queued task leaving the queue on the automation API', () => {
  const root = useTempDir('ostler-automation-queue-exit-')
  let projects: WatchedProject[]
  let planning: PlanningService
  let server: AutomationHttpServer
  let task: { id: string; status: string; hold: boolean; claimedBy: null }
  let harness: Pick<HarnessService, 'getState' | 'cancelTask' | 'setTaskHold'>
  const onHarnessStateChange = vi.fn()

  beforeEach(async () => {
    projects = [watched('home-project', 'token-one')]
    planning = new PlanningService(await createMigratedDatabase(root()), () =>
      projects.map((project) => project.id)
    )
    task = { id: 'h1', status: 'pending', hold: false, claimedBy: null }
    harness = {
      getState: vi.fn(
        () =>
          ({
            taskQueue: [task],
            reviewSessions: [],
            activeSessions: []
          }) as unknown as HarnessProjectState
      ),
      cancelTask: vi.fn(() => {
        task.status = 'cancelled'
        return task as never
      }),
      setTaskHold: vi.fn((_project: WatchedProject, _id: string, hold: boolean) => {
        task.hold = hold
        return task as never
      })
    }
    server = new AutomationHttpServer(
      () => projects,
      path.join(root(), 'runtime'),
      undefined,
      planning,
      harness as HarnessService,
      onHarnessStateChange
    )
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
    planning?.close()
  })

  async function call<T = unknown>(route: string, body: unknown, method = 'PATCH') {
    const project = projects[0]
    const response = await fetch(`http://127.0.0.1:${PORT}/automation/${project.id}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${project.automationToken}`
      },
      body: JSON.stringify(body)
    })
    const json = (await response.json()) as { ok: boolean; value: T; error?: string }
    return { status: response.status, ...json }
  }

  const queued = () => {
    const item = planning.createWorkItem(
      'home-project',
      { title: 'Import', status: 'ready' },
      human
    )
    return planning.compareAndSetHarnessTaskId(item.id, null, 'h1')
  }

  it('PATCH someday takes a queued task out of the queue, as the app does', async () => {
    const item = queued()
    const result = await call<PlanningWorkItem>(`/work-items/${item.id}`, { someday: true })
    expect(result.status).toBe(200)
    expect(result.value).toMatchObject({
      someday: true,
      linkedHarnessTaskId: null,
      leftQueue: true
    })
    expect(harness.cancelTask).toHaveBeenCalledTimes(1)
    expect(onHarnessStateChange).toHaveBeenCalled()
  })

  it('a move out of Ready by /move takes it out of the queue', async () => {
    const item = queued()
    const moved = await call<PlanningWorkItem>(
      `/work-items/${item.id}/move`,
      { status: 'backlog', position: 'start' },
      'POST'
    )
    expect(moved.status).toBe(200)
    expect(moved.value).toMatchObject({ status: 'backlog', linkedHarnessTaskId: null })
    expect(harness.cancelTask).toHaveBeenCalledTimes(1)
  })

  it('refuses a task whose agent is running, and changes nothing', async () => {
    const item = queued()
    task.status = 'claimed'
    const result = await call(`/work-items/${item.id}`, { status: 'backlog' })
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/agent is working/)
    expect(planning.getWorkItem(item.id)).toMatchObject({
      status: 'ready',
      linkedHarnessTaskId: 'h1'
    })
  })
})
