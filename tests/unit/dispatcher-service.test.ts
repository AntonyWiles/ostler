import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import simpleGit from 'simple-git'
import { ConfigStore } from '../../electron/config-store'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { OpenCodeRunnerService } from '../../electron/services/opencode-runner-service'
import { PlanningService } from '../../electron/services/planning-service'
import { DispatcherService } from '../../electron/services/dispatcher-service'
import { queueWorkItemForHarness } from '../../electron/services/task-intake'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

function fakeFetch(): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.endsWith('/doc')) {
      return new Response(null, { status: 200 })
    }
    if (method === 'POST' && url.endsWith('/session')) {
      return new Response(JSON.stringify({ id: 'oc-session-1' }), { status: 200 })
    }
    if (method === 'POST' && url.endsWith('/message')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    if (method === 'GET' && url.endsWith('/message')) {
      return new Response(JSON.stringify([]), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`)
  }) as unknown as typeof fetch
}

describe('dispatcher-service.ts', { timeout: 30_000 }, () => {
  const tempDir = useTempDir('ostler-dispatcher-test-')
  let projectDir: string
  let database: EventDatabase
  let configStore: ConfigStore
  let harnessService: HarnessService
  let openCodeRunnerService: OpenCodeRunnerService
  let planningService: PlanningService
  let dispatcherService: DispatcherService
  let project: WatchedProject

  beforeEach(async () => {
    projectDir = path.join(tempDir(), 'project')
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'app.ts'), 'console.log("hello")\n')
    const git = simpleGit(projectDir)
    await git.init()
    await git.addConfig('user.email', 'test@example.com')
    await git.addConfig('user.name', 'Test')
    await git.add('.')
    await git.commit('initial commit')

    const dbPath = await createMigratedDatabase(tempDir())
    database = new EventDatabase(dbPath)
    configStore = new ConfigStore(path.join(tempDir(), 'config.json'))
    // Agents on: the dispatcher does nothing at all while they are off.
    configStore.update({ harness: { ...configStore.get().harness, enabled: true } })
    project = configStore.registerProject({ folder: projectDir, name: 'Test project' })

    harnessService = new HarnessService(path.join(tempDir(), 'data'), database)
    planningService = new PlanningService(dbPath, () => configStore.getProjects().map((p) => p.id))

    openCodeRunnerService = new OpenCodeRunnerService(
      harnessService,
      () => configStore.get(),
      path.join(tempDir(), 'data'),
      {
        launch: vi.fn().mockResolvedValue({ pid: 1234 }),
        fetchImpl: fakeFetch(),
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess: vi.fn().mockResolvedValue(undefined),
        choosePort: async () => 43001,
        pollIntervalMs: 100000,
        idleStablePolls: 10,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000
      }
    )
    vi.spyOn(openCodeRunnerService, 'start').mockResolvedValue(undefined)

    dispatcherService = new DispatcherService(
      harnessService,
      openCodeRunnerService,
      planningService,
      configStore,
      () => {}
    )
  })

  afterEach(async () => {
    try {
      const state = harnessService.getState(project)
      for (const session of state.activeSessions) {
        await openCodeRunnerService.stop(session.id)
      }
    } catch {
      // Best-effort cleanup
    }
    database.close()
    planningService.close()
  })

  /**
   * One dispatch pass once the queued tasks' copies are ready: Ostler makes a
   * copy when a task is queued (simplify pass §2.2), and only a ready copy is
   * started.
   */
  async function evaluateWhenReady() {
    await harnessService.prepareCopies(project, 10)
    return dispatcherService.evaluate(project.id)
  }

  it('auto-queue skips tasks in Someday and tasks shown from a later day (N1.1a)', async () => {
    const queued: string[] = []
    const dispatcher = new DispatcherService(
      harnessService,
      openCodeRunnerService,
      planningService,
      configStore,
      () => {},
      (_project, workItemId) => queued.push(workItemId)
    )
    const human = { kind: 'human' as const }
    const ready = (title: string, extra: object = {}) =>
      planningService.createWorkItem(project.id, { title, status: 'ready', ...extra }, human)
    const shown = ready('Shown')
    ready('In Someday', { someday: true })
    ready('Later', { showFrom: '2999-01-01' })
    const past = ready('Shown since 2020', { showFrom: '2020-01-01' })

    await dispatcher.evaluate(project.id)

    expect(queued.sort()).toEqual([shown.id, past.id].sort())
  })

  it('queues a cancelled task again at once while it is in Ready and agents are on', async () => {
    // What Cancel's confirmation says: the task stays in Ready, and Ready work is queued.
    const dispatcher = new DispatcherService(
      harnessService,
      openCodeRunnerService,
      planningService,
      configStore,
      () => {},
      (queueProject, workItemId) =>
        queueWorkItemForHarness(planningService, harnessService, queueProject, workItemId, {
          allowUnmetDependencies: true
        })
    )
    const human = { kind: 'human' as const }
    const item = planningService.createWorkItem(
      project.id,
      { title: 'Tidy the logs', status: 'ready' },
      human
    )
    await dispatcher.evaluate(project.id)
    // Queuing makes the task's copy: let it finish, so nothing is left running.
    await harnessService.prepareCopies(project, 10)
    const first = planningService.getWorkItem(item.id).linkedHarnessTaskId!
    expect(first).toBeTruthy()

    // Cancel, as the queue's Cancel does it.
    harnessService.cancelTask(project, first, item.id)
    planningService.clearHarnessHandoff(project.id, item.id, first)
    expect(planningService.getWorkItem(item.id)).toMatchObject({
      status: 'ready',
      linkedHarnessTaskId: null
    })

    await dispatcher.evaluate(project.id)
    await harnessService.prepareCopies(project, 10)
    const again = planningService.getWorkItem(item.id).linkedHarnessTaskId
    expect(again).toBeTruthy()
    expect(again).not.toBe(first)
    const queue = harnessService.getState(project).taskQueue
    expect(queue.find((task) => task.id === first)?.status).toBe('cancelled')
    expect(queue.find((task) => task.id === again)?.status).toBe('pending')
  })

  it('defaults to disabled (off) and concurrency 0 for every project', () => {
    const config = configStore.getProjectAutoDispatchConfig(project.id)
    expect(config.enabled).toBe(false)
    expect(config.maxConcurrentEmbeddedSessions).toBe(0)
    expect(config.projectId).toBe(project.id)
  })

  it('does not dispatch when auto-dispatch is disabled', async () => {
    harnessService.addTask(project, 'Task 1', 'Details 1')
    const dispatched = await evaluateWhenReady()
    expect(dispatched).toHaveLength(0)

    const state = harnessService.getState(project)
    expect(state.activeSessions).toHaveLength(0)
    expect(state.taskQueue[0].status).toBe('pending')
    expect(state.taskQueue[0].claimedBy).toBeNull()
  })

  it('dispatches one eligible task when enabled with concurrency 1', async () => {
    configStore.updateProjectAutoDispatchConfig(project.id, {
      enabled: true,
      maxConcurrentEmbeddedSessions: 1
    })

    const task = harnessService.addTask(project, 'Auto task 1', 'Details')
    const dispatched = await evaluateWhenReady()

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0].provenance).toBe('embedded')

    const state = harnessService.getState(project)
    expect(state.activeSessions).toHaveLength(1)
    expect(state.activeSessions[0].id).toBe(dispatched[0].id)
    expect(state.taskQueue.find((t) => t.id === task.id)?.claimedBy).toBe(dispatched[0].id)
  })

  it('respects concurrency limit: does not start a second session while first is active', async () => {
    configStore.updateProjectAutoDispatchConfig(project.id, {
      enabled: true,
      maxConcurrentEmbeddedSessions: 1
    })

    const task1 = harnessService.addTask(project, 'Task 1', 'Details 1')
    const task2 = harnessService.addTask(project, 'Task 2', 'Details 2')

    const firstRun = await evaluateWhenReady()
    expect(firstRun).toHaveLength(1)
    expect(firstRun[0].provenance).toBe('embedded')

    const stateAfterFirst = harnessService.getState(project)
    expect(stateAfterFirst.activeSessions).toHaveLength(1)
    expect(stateAfterFirst.taskQueue.find((t) => t.id === task1.id)?.claimedBy).toBe(firstRun[0].id)
    expect(stateAfterFirst.taskQueue.find((t) => t.id === task2.id)?.claimedBy).toBeNull()

    // Second evaluation while first session is still active: no new session
    const secondRun = await evaluateWhenReady()
    expect(secondRun).toHaveLength(0)

    // Complete the first session to free capacity
    await harnessService.completeSessionWithAutoContinuation(
      project,
      firstRun[0].id,
      'Done with task 1',
      task1.id
    )

    // Third evaluation after capacity freed: dispatches task 2
    const thirdRun = await evaluateWhenReady()
    expect(thirdRun).toHaveLength(1)
    expect(thirdRun[0].provenance).toBe('embedded')

    const stateAfterThird = harnessService.getState(project)
    expect(stateAfterThird.taskQueue.find((t) => t.id === task2.id)?.claimedBy).toBe(thirdRun[0].id)
  })

  it('skips tasks on hold (task.hold === true) and dispatches them once resumed', async () => {
    configStore.updateProjectAutoDispatchConfig(project.id, {
      enabled: true,
      maxConcurrentEmbeddedSessions: 2
    })

    const heldTask = harnessService.addTask(project, 'Held task', 'Paused details')
    harnessService.setTaskHold(project, heldTask.id, true)

    const normalTask = harnessService.addTask(project, 'Normal task', 'Normal details')

    const dispatched = await evaluateWhenReady()
    expect(dispatched).toHaveLength(1)

    const state = harnessService.getState(project)
    expect(state.taskQueue.find((t) => t.id === normalTask.id)?.claimedBy).toBe(dispatched[0].id)
    expect(state.taskQueue.find((t) => t.id === heldTask.id)?.claimedBy).toBeNull()

    // Release hold on heldTask
    harnessService.setTaskHold(project, heldTask.id, false)
    const secondDispatch = await evaluateWhenReady()
    expect(secondDispatch).toHaveLength(1)

    const updatedState = harnessService.getState(project)
    expect(updatedState.taskQueue.find((t) => t.id === heldTask.id)?.claimedBy).toBe(
      secondDispatch[0].id
    )
  })

  it('gates dispatch on PlanningService dependency completion for linked tasks', async () => {
    configStore.updateProjectAutoDispatchConfig(project.id, {
      enabled: true,
      maxConcurrentEmbeddedSessions: 2
    })

    // Create prerequisite work item A
    const itemA = planningService.createWorkItem(
      project.id,
      {
        title: 'Prerequisite item A',
        status: 'ready'
      },
      { kind: 'human' }
    )

    // Create dependent work item B that depends on A
    const itemB = planningService.createWorkItem(
      project.id,
      {
        title: 'Dependent item B',
        status: 'ready',
        dependencyIds: [itemA.id]
      },
      { kind: 'human' }
    )

    // Add harness task linked to B
    const harnessTaskB = harnessService.addTask(
      project,
      itemB.title,
      'details',
      undefined,
      'medium',
      itemB.id
    )

    // Evaluate: item B is blocked because dependency item A is not 'done'
    expect(planningService.isWorkItemEligibleForDispatch(project.id, itemB.id)).toBe(false)
    const dispatchedBlocked = await evaluateWhenReady()
    expect(dispatchedBlocked).toHaveLength(0)

    // Complete dependency item A in planning
    planningService.updateWorkItem(itemA.id, { status: 'done' }, { kind: 'human' })
    expect(planningService.isWorkItemEligibleForDispatch(project.id, itemB.id)).toBe(true)

    // Evaluate again: now eligible and dispatched
    const dispatchedReady = await evaluateWhenReady()
    expect(dispatchedReady).toHaveLength(1)

    const state = harnessService.getState(project)
    expect(state.taskQueue.find((t) => t.id === harnessTaskB.id)?.claimedBy).toBe(
      dispatchedReady[0].id
    )
  })

  it('allows manual trigger to start embedded session independently of auto-dispatch setting', async () => {
    // Auto-dispatch is disabled
    expect(configStore.getProjectAutoDispatchConfig(project.id).enabled).toBe(false)

    const task = harnessService.addTask(project, 'Manual trigger task', 'Details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    harnessService.touchSessionConnection(project, session.id)

    expect(session.provenance).toBe('embedded')
    const state = harnessService.getState(project)
    expect(state.activeSessions).toHaveLength(1)
    expect(state.taskQueue.find((t) => t.id === task.id)?.claimedBy).toBe(session.id)
  })
})
