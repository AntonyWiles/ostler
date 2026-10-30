import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as path from 'path'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { TaskPlansService } from '../../electron/services/task-plans-service'
import { mcpToolsFromRoutes } from '../../electron/services/mcp/mcp-tools'
import type {
  HarnessPlan,
  HarnessTask,
  PlanningWorkItem,
  ProjectAutoDispatchConfig,
  SessionPlanView,
  WatchedProject
} from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { initProjectRepository } from '../helpers/harness'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let AUTOMATION_PORT = 0

const PLAN = {
  steps: ['Read src/app.ts', 'Change the greeting'],
  files: ['src/app.ts'],
  risks: ''
}

/** Approve the plan (N9.3b) over the automation API: the plan routes, planFirst and agentsPlanFirst. */
describe('plans over the automation API', { timeout: 30_000 }, () => {
  const root = useTempDir('ostler-approve-plan-http-')
  let project: WatchedProject
  let database: EventDatabase
  let planning: PlanningService
  let harnessService: HarnessService
  let plans: TaskPlansService
  let server: AutomationHttpServer
  let settings: ProjectAutoDispatchConfig

  beforeEach(async () => {
    const projectPath = path.join(root(), 'project')
    await initProjectRepository(projectPath)
    settings = {
      projectId: 'plan-api-project',
      enabled: false,
      maxConcurrentEmbeddedSessions: 0,
      aiOverrideEnabled: false,
      defaultProvider: '',
      defaultModel: '',
      defaultEffort: '',
      autoArchiveDoneAfterDays: 0,
      agentsPlanFirst: false
    }
    project = makeWatchedProject({
      id: 'plan-api-project',
      name: 'Plan API project',
      path: projectPath,
      addedAt: Date.now(),
      automationToken: 'automation-token',
      autoDispatch: settings
    })
    const dbPath = await createMigratedDatabase(root())
    database = new EventDatabase(dbPath)
    planning = new PlanningService(dbPath, () => [project.id])
    harnessService = new HarnessService(path.join(root(), 'data'), database)
    plans = new TaskPlansService(planning.database)
    harnessService.setPlanListener((source, plan) => plans.record(source, plan))
    server = new AutomationHttpServer(
      () => [project],
      path.join(root(), 'data'),
      undefined,
      planning,
      harnessService,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => {},
      {
        get: () => settings,
        update: (_projectId, updates) => {
          settings = { ...settings, ...updates }
          project.autoDispatch = settings
          return settings
        }
      }
    )
    server.taskPlans = plans
    AUTOMATION_PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server.stop()
    harnessService.stopAll()
    planning.close()
    database.close()
  })

  function automation(method: string, urlPath: string, body?: unknown) {
    return fetch(`http://127.0.0.1:${AUTOMATION_PORT}/automation/${project.id}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${project.automationToken}`
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }

  async function value<T>(response: Response): Promise<T> {
    const body = (await response.json()) as { ok: boolean; value: T; error?: string }
    if (!body.ok) throw new Error(`${response.status}: ${body.error}`)
    return body.value
  }

  async function queued(planFirst?: 'default' | 'yes' | 'no') {
    const item = await value<PlanningWorkItem>(
      await automation('POST', '/work-items', {
        title: 'Change the greeting',
        status: 'ready',
        ...(planFirst ? { planFirst } : {})
      })
    )
    const task = await value<HarnessTask>(
      await automation('POST', '/tasks', { workItemId: item.id })
    )
    return { item, task }
  }

  it('sets planFirst on work items and agentsPlanFirst in /auto-dispatch, and queuing follows them', async () => {
    expect(
      (await value<ProjectAutoDispatchConfig>(await automation('GET', '/auto-dispatch')))
        .agentsPlanFirst
    ).toBe(false)
    const plain = await queued()
    expect(plain.item.planFirst).toBe('default')
    expect(plain.task.planFirst).toBeUndefined()

    const updated = await value<ProjectAutoDispatchConfig>(
      await automation('PATCH', '/auto-dispatch', { agentsPlanFirst: true })
    )
    expect(updated.agentsPlanFirst).toBe(true)
    expect((await queued()).task.planFirst).toBe(true)
    expect((await queued('no')).task.planFirst).toBeUndefined()

    await automation('PATCH', '/auto-dispatch', { agentsPlanFirst: false })
    const yes = await queued('yes')
    expect(yes.task.planFirst).toBe(true)

    const patched = await value<PlanningWorkItem>(
      await automation('PATCH', `/work-items/${plain.item.id}`, { planFirst: 'yes' })
    )
    expect(patched.planFirst).toBe('yes')
    const refused = await automation('PATCH', `/work-items/${plain.item.id}`, {
      planFirst: 'always'
    })
    expect(refused.status).toBe(400)
  })

  it('reads, sends back and approves a plan, and a second decision returns the first', async () => {
    const { task } = await queued('yes')
    const session = await harnessService.startSessionForTask(project, task.id)

    const none = await value<SessionPlanView>(
      await automation('GET', `/sessions/${session.id}/plan`)
    )
    expect(none).toMatchObject({ sessionId: session.id, plan: null, history: [] })

    harnessService.submitPlan(project, session.id, PLAN)
    const waiting = await value<SessionPlanView>(
      await automation('GET', `/sessions/${session.id}/plan`)
    )
    expect(waiting.plan).toMatchObject({ version: 1, status: 'pending', steps: PLAN.steps })

    const noNote = await automation('POST', `/sessions/${session.id}/plan/changes`, {})
    expect(noNote.status).toBe(400)
    const sentBack = await value<{ plan: HarnessPlan; alreadyDecided: boolean }>(
      await automation('POST', `/sessions/${session.id}/plan/changes`, { note: 'Also the docs' })
    )
    expect(sentBack).toMatchObject({
      plan: { status: 'changes-requested', changesNote: 'Also the docs' },
      alreadyDecided: false
    })

    harnessService.submitPlan(project, session.id, { ...PLAN, files: ['src/app.ts', 'README.md'] })
    const [first, second] = await Promise.all([
      automation('POST', `/sessions/${session.id}/plan/approve`),
      automation('POST', `/sessions/${session.id}/plan/approve`)
    ])
    const results = [
      await value<{ plan: HarnessPlan; alreadyDecided: boolean }>(first),
      await value<{ plan: HarnessPlan; alreadyDecided: boolean }>(second)
    ]
    expect(results.map((result) => result.plan.status)).toEqual(['approved', 'approved'])
    expect(results.every((result) => result.plan.version === 2)).toBe(true)

    const again = await value<{ plan: HarnessPlan; alreadyDecided: boolean }>(
      await automation('POST', `/sessions/${session.id}/plan/approve`)
    )
    expect(again.alreadyDecided).toBe(true)
    const late = await value<{ plan: HarnessPlan; alreadyDecided: boolean }>(
      await automation('POST', `/sessions/${session.id}/plan/changes`, { note: 'Too late' })
    )
    expect(late).toMatchObject({ plan: { status: 'approved' }, alreadyDecided: true })

    const kept = await value<SessionPlanView>(
      await automation('GET', `/sessions/${session.id}/plan`)
    )
    expect(kept.history.map((entry) => [entry.version, entry.status])).toEqual([
      [1, 'changes-requested'],
      [2, 'approved']
    ])
  })

  it('cancels a run at its plan through /stop', async () => {
    const { task } = await queued('yes')
    const session = await harnessService.startSessionForTask(project, task.id)
    harnessService.submitPlan(project, session.id, PLAN)
    await value(await automation('POST', `/sessions/${session.id}/stop`))
    expect(plans.listForSession(session.id)[0].status).toBe('cancelled')
  })

  it('lists the plan routes in its help, and keeps them and planFirst away from MCP', () => {
    const paths = HELP_ROUTES.map((route) => `${route.method} ${route.path}`)
    expect(paths).toEqual(
      expect.arrayContaining([
        'GET /sessions/:sessionId/plan',
        'POST /sessions/:sessionId/plan/approve',
        'POST /sessions/:sessionId/plan/changes'
      ])
    )
    const tools = mcpToolsFromRoutes(HELP_ROUTES).map((tool) => tool.title)
    expect(tools.some((title) => title.includes('/plan'))).toBe(false)
  })
})
