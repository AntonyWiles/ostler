import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import simpleGit from 'simple-git'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { harnessStateEvents } from '../../electron/services/harness/state-events'
import { buildHelp } from '../../electron/services/harness-http-server'
import {
  OpenCodeRunnerService,
  buildTaskPrompt,
  type OpenCodeRunnerDeps
} from '../../electron/services/opencode-runner-service'
import {
  generateOstlerAgentInstructionsMd,
  generateOstlerPluginJs,
  generateOstlerSubmitPlanToolTs
} from '../../electron/services/opencode/ostler-plugin-template'
import type { OstlerConfig, WatchedProject } from '../../src/shared/ostler-api'
import { DEFAULT_CONFIG } from '../../src/shared/ostler-api'
import { MAX_PLAN_FILES, MAX_PLAN_STEP_LENGTH, MAX_PLAN_STEPS } from '../../src/shared/plan-first'
import { createMigratedDatabase } from '../helpers/database'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

/**
 * Plan first (N9.3a) with plans turned on, as N9.3b will ship them: the
 * harness side for embedded and external agents.
 */
vi.mock('../../src/shared/plan-first', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/shared/plan-first')>()),
  PLAN_FIRST_AVAILABLE: true
}))
vi.mock('../../electron/services/sandbox-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../electron/services/sandbox-service')>()),
  isSandboxSupported: true
}))

const PLAN = {
  steps: ['Read src/app.ts', 'Change the greeting', 'Run the tests'],
  files: ['src/app.ts', 'src\\other.ts'],
  risks: 'The greeting is used in a snapshot.'
}

function fakeFetch(): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.endsWith('/doc')) return new Response(null, { status: 200 })
    if (method === 'POST' && url.endsWith('/session')) {
      return new Response(JSON.stringify({ id: 'oc-session-1' }), { status: 200 })
    }
    if (method === 'POST' && url.endsWith('/message')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    if (method === 'GET' && url.endsWith('/message')) {
      return new Response(JSON.stringify([{}]), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`)
  }) as unknown as typeof fetch
}

describe('plan first, with plans available', { timeout: 30_000 }, () => {
  const tempDir = useTempDir('ostler-plan-first-')
  let projectDir: string
  let database: EventDatabase
  let service: HarnessService
  let project: WatchedProject
  const config: OstlerConfig = { ...DEFAULT_CONFIG, ai: { ...DEFAULT_CONFIG.ai, apiKey: '' } }

  beforeEach(async () => {
    projectDir = path.join(tempDir(), 'project')
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'src', 'app.ts'), 'original\n')
    const git = simpleGit(projectDir)
    await git.init()
    await git.addConfig('user.email', 'test@example.com')
    await git.addConfig('user.name', 'Test')
    await git.addConfig('core.autocrlf', 'false')
    await git.raw(['checkout', '-B', 'main'])
    await git.add('.')
    await git.commit('initial commit')
    database = new EventDatabase(await createMigratedDatabase(tempDir()))
    service = new HarnessService(path.join(tempDir(), 'data'), database)
    project = makeWatchedProject({
      id: 'project-1',
      name: 'Test project',
      path: projectDir,
      color: '#fff',
      addedAt: Date.now()
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    service.stopAll()
    database.close()
  })

  async function planFirstSession(provenance: 'external' | 'embedded' = 'external') {
    const task = service.addTask(project, 'Change the greeting', 'Say hello')
    service.setTaskPlanFirst(project, task.id, true)
    const session =
      provenance === 'embedded'
        ? await service.startEmbeddedSessionForTask(project, task.id)
        : await service.startSessionForTask(project, task.id)
    return { task, session }
  }

  describe('asking for a plan', () => {
    it('marks a queued task plan-first, and only a queued one', async () => {
      const task = service.addTask(project, 'Task', '')
      expect(service.setTaskPlanFirst(project, task.id, true).planFirst).toBe(true)
      expect(service.getState(project).taskQueue[0].planFirst).toBe(true)
      expect(service.setTaskPlanFirst(project, task.id, false).planFirst).toBeUndefined()

      service.setTaskPlanFirst(project, task.id, true)
      const session = await service.startSessionForTask(project, task.id)
      expect(service.sessionPlanFirst(project, session.id)).toBe(true)
      expect(() => service.setTaskPlanFirst(project, task.id, false)).toThrow(
        /waiting in the queue/
      )
    })

    it('tells an embedded session to plan in its opening prompt, and the standing instructions explain plans', () => {
      const prompt = buildTaskPrompt(
        {
          id: 't',
          title: 'Task',
          details: '',
          status: 'claimed',
          claimedBy: 's',
          priority: 'medium',
          planningWorkItemId: null,
          autoContinue: false,
          planFirst: true
        },
        null
      )
      expect(prompt).toContain('ostler_submit_plan')
      expect(prompt).not.toContain('Start now.')

      const instructions = generateOstlerAgentInstructionsMd('C:/slot', 'main', 'abc')
      expect(instructions).toContain('## Plan first')
      expect(instructions).toContain('ostler_submit_plan')
      expect(instructions).toContain(`up to ${MAX_PLAN_STEPS}`)
      expect(generateOstlerSubmitPlanToolTs(1234, 'secret', 's', 'p')).toContain('/plan')
    })

    it('a task that does not ask for a plan is not told to plan', () => {
      const prompt = buildTaskPrompt(
        {
          id: 't',
          title: 'Task',
          details: '',
          status: 'claimed',
          claimedBy: 's',
          priority: 'medium',
          planningWorkItemId: null,
          autoContinue: false
        },
        null
      )
      expect(prompt).not.toContain('ostler_submit_plan')
    })

    it('the harness help explains plans and lists the plan route', () => {
      const help = buildHelp(project.id) as { instructions: string; routes: { path: string }[] }
      expect(help.routes.map((route) => route.path)).toContain('/session/:sessionId/plan')
      expect(help.instructions).toContain('Plan first:')
      expect(help.instructions).toContain('plan.decided')
    })
  })

  describe('submitting', () => {
    it('stores the plan with a version, sets the session waiting and records an event', async () => {
      const { session } = await planFirstSession()
      const plan = service.submitPlan(project, session.id, PLAN)

      expect(plan).toMatchObject({
        version: 1,
        status: 'pending',
        steps: PLAN.steps,
        files: ['src/app.ts', 'src/other.ts'],
        risks: PLAN.risks
      })
      const stored = service.getState(project).activeSessions[0]
      expect(stored.blocked).toBe(true)
      expect(stored.plan?.version).toBe(1)
      expect(database.getHarnessEvents(project.id, 10).map((event) => event.event_type)).toContain(
        'plan_submitted'
      )
    })

    it('sending the same plan again while it waits keeps the version; a different one is the next', async () => {
      const { session } = await planFirstSession()
      service.submitPlan(project, session.id, PLAN)
      expect(service.submitPlan(project, session.id, PLAN).version).toBe(1)
      expect(service.submitPlan(project, session.id, { ...PLAN, risks: 'None' }).version).toBe(2)
    })

    it('refuses plans over the limits, and a plan for a task that did not ask for one', async () => {
      const { session } = await planFirstSession()
      expect(() => service.submitPlan(project, session.id, { ...PLAN, steps: [] })).toThrow(
        /at least one step/
      )
      expect(() =>
        service.submitPlan(project, session.id, {
          ...PLAN,
          steps: Array.from({ length: MAX_PLAN_STEPS + 1 }, (_, i) => `Step ${i}`)
        })
      ).toThrow(/at most 30 steps/)
      expect(() =>
        service.submitPlan(project, session.id, {
          ...PLAN,
          steps: ['x'.repeat(MAX_PLAN_STEP_LENGTH + 1)]
        })
      ).toThrow(/at most 500/)
      expect(() =>
        service.submitPlan(project, session.id, {
          ...PLAN,
          files: Array.from({ length: MAX_PLAN_FILES + 1 }, (_, i) => `f${i}.ts`)
        })
      ).toThrow(/at most 200 files/)
      expect(() =>
        service.submitPlan(project, session.id, { ...PLAN, risks: 'r'.repeat(4001) })
      ).toThrow(/at most 4000/)
      expect(() =>
        service.submitPlan(project, session.id, { ...PLAN, files: ['../outside.ts'] })
      ).toThrow(/relative to the project/)

      const other = service.addTask(project, 'Plain task', '')
      const plain = await service.startSessionForTask(project, other.id)
      expect(() => service.submitPlan(project, plain.id, PLAN)).toThrow(/does not ask for a plan/)
    })

    it('a session waiting on its plan is waiting, not stale', async () => {
      const { session } = await planFirstSession()
      service.submitPlan(project, session.id, PLAN)
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000)
      const report = service.getReport(project)
      expect(report.metrics.staleSessions).toBe(0)
      expect(report.alerts.map((alert) => alert.code)).not.toContain('stale_sessions')
    })

    it('raises plan.submitted and plan.decided for the event stream', async () => {
      const { session } = await planFirstSession()
      const before = structuredClone(
        service.getState(project).activeSessions.find((s) => s.id === session.id)!
      )
      service.submitPlan(project, session.id, PLAN)
      const pending = service.getState(project).activeSessions.find((s) => s.id === session.id)!
      const asStored = (s: typeof before) =>
        ({
          version: 1,
          updatedAt: '',
          sessions: [{ ...s, overview: '', assignedTaskId: null }],
          tasks: [],
          questions: [],
          guidance: [],
          watcherRunning: false
        }) as Parameters<typeof harnessStateEvents>[1]
      expect(
        harnessStateEvents(asStored(before), asStored(pending)).map((event) => event.type)
      ).toContain('plan.submitted')
      const approved = { ...pending, plan: { ...pending.plan!, status: 'approved' as const } }
      expect(
        harnessStateEvents(asStored(pending), asStored(approved)).map((event) => event.type)
      ).toContain('plan.decided')
    })
  })

  describe('deciding', () => {
    it('approve lets the run carry on and keeps the approved plan', async () => {
      const { session } = await planFirstSession()
      service.submitPlan(project, session.id, PLAN)
      expect(service.sessionMayChangeFiles(project, session.id)).toBe(false)

      const plan = await service.approvePlan(project, session.id)
      expect(plan).toMatchObject({ status: 'approved', version: 1 })
      expect(plan.changedBeforeApproval).toBeUndefined()
      const stored = service.getState(project).activeSessions[0]
      expect(stored.blocked).toBe(false)
      expect(stored.plan?.status).toBe('approved')
      expect(service.sessionMayChangeFiles(project, session.id)).toBe(true)
      expect(() => service.submitPlan(project, session.id, PLAN)).toThrow(/already approved/)
    })

    it('records the files changed before the plan was approved, committed or not', async () => {
      const { session } = await planFirstSession()
      const copy = session.workspace!.worktreePath
      fs.writeFileSync(path.join(copy, 'src', 'app.ts'), 'changed early\n')
      const git = simpleGit(copy)
      await git.add('.')
      await git.commit('early commit')
      fs.writeFileSync(path.join(copy, 'src', 'new.ts'), 'uncommitted\n')
      service.submitPlan(project, session.id, PLAN)

      const plan = await service.approvePlan(project, session.id)
      expect(plan.changedBeforeApproval?.files).toEqual(['src/app.ts', 'src/new.ts'])
      expect(
        database
          .getHarnessEvents(project.id, 10)
          .find((event) => event.event_type === 'plan_decided')?.details
      ).toContain('2 files changed before the plan was approved')
    })

    it('ask for changes hands the note back; the next plan is a new version', async () => {
      const { session } = await planFirstSession()
      service.submitPlan(project, session.id, PLAN)
      expect(() => service.requestPlanChanges(project, session.id, '  ')).toThrow()

      const sentBack = service.requestPlanChanges(project, session.id, 'Leave the tests alone')
      expect(sentBack).toMatchObject({
        status: 'changes-requested',
        changesNote: 'Leave the tests alone'
      })
      expect(service.getState(project).activeSessions[0].blocked).toBe(false)
      expect(service.sessionMayChangeFiles(project, session.id)).toBe(false)

      const revised = service.submitPlan(project, session.id, { ...PLAN, steps: ['Change it'] })
      expect(revised).toMatchObject({ version: 2, status: 'pending', changesNote: null })
      expect(service.getState(project).activeSessions[0].blocked).toBe(true)
    })

    it('cancel ends the run as Stop does: work kept aside and the task back in the queue', async () => {
      const { task, session } = await planFirstSession()
      fs.writeFileSync(path.join(session.workspace!.worktreePath, 'src', 'app.ts'), 'early\n')
      service.submitPlan(project, session.id, PLAN)

      const stopped = await service.cancelPlan(project, session.id)
      expect(stopped.status).toBe('done')
      expect(stopped.plan?.status).toBe('cancelled')
      const state = service.getState(project)
      expect(state.activeSessions).toEqual([])
      expect(state.taskQueue.find((item) => item.id === task.id)).toMatchObject({
        status: 'pending',
        claimedBy: null,
        planFirst: true
      })
    })

    it('there is nothing to decide without a pending plan', async () => {
      const { session } = await planFirstSession()
      await expect(service.approvePlan(project, session.id)).rejects.toThrow(/no plan waiting/)
      expect(() => service.requestPlanChanges(project, session.id, 'x')).toThrow(/no plan waiting/)
    })

    it('answering a question does not release a session still waiting on its plan', async () => {
      const { session } = await planFirstSession()
      const question = service.askQuestion(project, session.id, 'Which file?')
      service.submitPlan(project, session.id, PLAN)
      service.answerQuestion(project, question.id, 'app.ts')
      expect(service.getState(project).activeSessions[0].blocked).toBe(true)
    })
  })

  describe('the embedded agent', () => {
    async function startWithBridge(
      sessionId: string,
      taskId: string,
      port: number,
      deps: Partial<OpenCodeRunnerDeps> = {}
    ) {
      const launch = vi.fn().mockResolvedValue({ pid: 7000 + (port % 100) })
      const runner = new OpenCodeRunnerService(
        service,
        () => config,
        path.join(tempDir(), 'data'),
        {
          launch,
          fetchImpl: fakeFetch(),
          resolveBinary: () => 'C:\\fake\\opencode.exe',
          killProcess: vi.fn().mockResolvedValue(undefined),
          stopWorkspaceProcesses: vi.fn().mockResolvedValue(undefined),
          choosePort: async () => port,
          pollIntervalMs: 100000,
          idleStablePolls: 100,
          maxPolls: 50,
          healthCheckTimeoutMs: 1000,
          planPollMs: 10,
          ...deps
        }
      )
      const session = service.getState(project).activeSessions.find((s) => s.id === sessionId)!
      const task = service.getState(project).taskQueue.find((t) => t.id === taskId)!
      await runner.start(project, session, task)
      const env = launch.mock.calls[0][3].environment
      return {
        runner,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OSTLER_BRIDGE_SECRET}`
        },
        bridgeUrl: `http://127.0.0.1:${env.OSTLER_BRIDGE_PORT}`,
        slotPath: session.workspace!.worktreePath
      }
    }

    it('writes the plan tool, refuses edits before approval, and allows them after', async () => {
      const { task, session } = await planFirstSession('embedded')
      const { runner, headers, bridgeUrl } = await startWithBridge(session.id, task.id, 43101)
      const toolCall = async (tool: string) =>
        (await (
          await fetch(`${bridgeUrl}/tool-call`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ sessionId: session.id, projectId: project.id, tool, args: {} })
          })
        ).json()) as { ok: boolean; refused?: string }

      expect((await toolCall('read')).refused).toBeUndefined()
      expect((await toolCall('edit')).refused).toContain('plan first')
      expect((await toolCall('write')).refused).toContain('ostler_submit_plan')

      service.submitPlan(project, session.id, PLAN)
      expect((await toolCall('edit')).refused).toBeDefined()
      await service.approvePlan(project, session.id)
      expect((await toolCall('edit')).refused).toBeUndefined()

      await runner.stop(session.id)
    })

    it('the plugin hook turns a refusal into an error the agent reads', () => {
      const plugin = generateOstlerPluginJs('C:/slot', 1, 'secret', 's', 'p')
      expect(plugin).toContain("'Ostler plan first: ' + data.refused")
      expect(plugin).toContain("e.message.startsWith('Ostler plan first:')")
    })

    /** Waits until `check` holds: the plan has reached the harness state. */
    async function until(check: () => boolean): Promise<void> {
      for (let tries = 0; tries < 500 && !check(); tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(check()).toBe(true)
    }

    function submitter(bridgeUrl: string, headers: Record<string, string>, sessionId: string) {
      return async (plan: typeof PLAN) =>
        (await (
          await fetch(`${bridgeUrl}/plan`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ sessionId, projectId: project.id, ...plan })
          })
        ).json()) as { ok: boolean; message: string }
    }

    it('a plan call nobody decides on tells the agent to call again, never to proceed', async () => {
      const { task, session } = await planFirstSession('embedded')
      const { runner, headers, bridgeUrl } = await startWithBridge(session.id, task.id, 43105, {
        planWaitMs: 60
      })
      const waiting = await submitter(bridgeUrl, headers, session.id)(PLAN)
      expect(waiting.message).toContain('STILL WAITING')
      expect(waiting.message).toContain('Do not change files')
      expect(service.getSessionPlan(project, session.id)?.status).toBe('pending')
      expect(runner.isRunning(session.id)).toBe(true)
      // Calling again with the same plan keeps waiting on the same version.
      expect((await submitter(bridgeUrl, headers, session.id)(PLAN)).message).toContain('version 1')
      await runner.stop(session.id)
    })

    it('a plan call waits for the decision: changes asked for, then approval', async () => {
      const { task, session } = await planFirstSession('embedded')
      const { runner, headers, bridgeUrl } = await startWithBridge(session.id, task.id, 43102, {
        planWaitMs: 20_000
      })
      const submit = submitter(bridgeUrl, headers, session.id)
      const planAt = (version: number) => () => {
        const plan = service.getSessionPlan(project, session.id)
        return plan?.version === version && plan.status === 'pending'
      }

      const pendingCall = submit(PLAN)
      await until(planAt(1))
      service.requestPlanChanges(project, session.id, 'Fewer steps')
      const changes = await pendingCall
      expect(changes.message).toContain('CHANGES REQUESTED')
      expect(changes.message).toContain('Fewer steps')

      const approvedCall = submit({ ...PLAN, steps: ['Change the greeting'] })
      await until(planAt(2))
      await service.approvePlan(project, session.id)
      const approved = await approvedCall
      expect(approved.message).toContain('APPROVED')
      expect(approved.message).toContain('version 2')

      await runner.stop(session.id)
    })

    it('a plan call answers that the task was cancelled', async () => {
      const { task, session } = await planFirstSession('embedded')
      const { runner, headers, bridgeUrl } = await startWithBridge(session.id, task.id, 43103, {
        planWaitMs: 20_000
      })
      const call = submitter(bridgeUrl, headers, session.id)(PLAN)
      await until(() => service.getSessionPlan(project, session.id)?.status === 'pending')
      // As Stop does: the agent's process first, then the run.
      await runner.stop(session.id)
      expect((await call).message).toContain('CANCELLED')
    })

    it('refuses a bad plan with the reason', async () => {
      const { task, session } = await planFirstSession('embedded')
      const { runner, headers, bridgeUrl } = await startWithBridge(session.id, task.id, 43104)
      const res = await fetch(`${bridgeUrl}/plan`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId: session.id, projectId: project.id, steps: [] })
      })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toMatch(/at least one step/)
      await runner.stop(session.id)
    })
  })
})
