import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as path from 'path'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { queueWorkItemForHarness } from '../../electron/services/task-intake'
import { queueDueScheduledTasks } from '../../electron/services/scheduled-agent-tasks'
import { DEFAULT_CONFIG } from '../../src/shared/ostler-api'
import type {
  HarnessTask,
  OstlerConfig,
  PlanningRecurrence,
  PlanningWorkItem,
  WatchedProject
} from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { initProjectRepository } from '../helpers/harness'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let AUTOMATION_PORT = 0

/** Scheduled agent tasks (N9.7) over the automation API: goToAgents and scheduled: true. */
describe('scheduled agent tasks over the automation API', { timeout: 30_000 }, () => {
  const root = useTempDir('ostler-scheduled-http-')
  let project: WatchedProject
  let database: EventDatabase
  let planning: PlanningService
  let harnessService: HarnessService
  let server: AutomationHttpServer
  let config: OstlerConfig

  beforeEach(async () => {
    const projectPath = path.join(root(), 'project')
    await initProjectRepository(projectPath)
    project = makeWatchedProject({
      id: 'scheduled-project',
      name: 'Scheduled project',
      path: projectPath,
      addedAt: Date.now(),
      automationToken: 'automation-token'
    })
    config = { ...DEFAULT_CONFIG, harness: { ...DEFAULT_CONFIG.harness, enabled: true } }
    const dbPath = await createMigratedDatabase(root())
    database = new EventDatabase(dbPath)
    planning = new PlanningService(dbPath, () => [project.id])
    harnessService = new HarnessService(path.join(root(), 'data'), database)
    server = new AutomationHttpServer(
      () => [project],
      path.join(root(), 'data'),
      undefined,
      planning,
      harnessService
    )
    server.getConfig = () => config
    AUTOMATION_PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server.stop()
    harnessService.stopAll()
    planning.close()
    database.close()
  })

  async function call<T>(method: string, urlPath: string, body?: unknown) {
    const response = await fetch(
      `http://127.0.0.1:${AUTOMATION_PORT}/automation/${project.id}${urlPath}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.automationToken}`
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      }
    )
    return {
      status: response.status,
      json: (await response.json()) as { ok: boolean; value: T; error: string }
    }
  }

  it('reads and writes goToAgents through the recurrence routes', async () => {
    const made = await call<PlanningWorkItem>('POST', '/work-items', {
      title: 'Update the dependencies',
      targetDate: '2026-10-19'
    })
    const id = made.json.value.id
    const plain = await call<PlanningRecurrence>('POST', `/work-items/${id}/recurrence`, {
      rule: { every: 'week' }
    })
    expect(plain.json.value.goToAgents).toBe(false)
    const on = await call<PlanningRecurrence>('POST', `/work-items/${id}/recurrence`, {
      rule: { every: 'week' },
      goToAgents: true
    })
    expect(on.status).toBe(200)
    expect(on.json.value.goToAgents).toBe(true)
    // Left out, it stays as it was.
    await call('POST', `/work-items/${id}/recurrence`, { rule: { every: 'week', interval: 2 } })
    const read = await call<PlanningRecurrence>('GET', `/work-items/${id}/recurrence`)
    expect(read.json.value).toMatchObject({ goToAgents: true, rule: { interval: 2 } })
    const refused = await call('POST', `/work-items/${id}/recurrence`, {
      rule: { every: 'week' },
      goToAgents: 'yes'
    })
    expect(refused.status).toBe(400)
    expect(refused.json.error).toBe('goToAgents must be true or false')
  })

  it('says on GET /tasks and the work item that the schedule queued it', async () => {
    const made = await call<PlanningWorkItem>('POST', '/work-items', {
      title: 'Check the links',
      targetDate: '2026-10-01'
    })
    const id = made.json.value.id
    await call('POST', `/work-items/${id}/recurrence`, {
      rule: { every: 'month' },
      goToAgents: true
    })
    // The hourly check, with the day fixed; the real queue path and harness.
    const results = queueDueScheduledTasks(
      {
        planning,
        getProjects: () => [project],
        agentsOn: () => config.harness.enabled,
        queuedTasks: (target) => harnessService.getState(target).taskQueue,
        queue: (target, workItemId) => {
          queueWorkItemForHarness(planning, harnessService, target, workItemId, {
            allowUnmetDependencies: true,
            scheduled: true
          })
        }
      },
      '2026-10-02'
    )
    expect(results.map((result) => result.outcome)).toEqual(['queued'])
    const tasks = await call<HarnessTask[]>('GET', '/tasks')
    expect(tasks.json.value).toEqual([
      expect.objectContaining({ planningWorkItemId: id, status: 'pending', scheduled: true })
    ])
    const items = await call<PlanningWorkItem[]>('GET', '/work-items')
    expect(items.json.value.find((entry) => entry.id === id)).toMatchObject({
      status: 'ready',
      scheduledQueue: { outcome: 'queued' }
    })
  })

  it('documents goToAgents and scheduled in HELP_ROUTES', () => {
    const recurrence = HELP_ROUTES.filter(
      (route) => route.path === '/work-items/:workItemId/recurrence'
    )
    expect(recurrence.find((route) => route.method === 'GET')?.description).toContain('goToAgents')
    expect(recurrence.find((route) => route.method === 'POST')?.request).toContain('goToAgents')
    expect(
      HELP_ROUTES.find((route) => route.method === 'GET' && route.path === '/tasks')?.description
    ).toContain('scheduled: true')
  })
})
