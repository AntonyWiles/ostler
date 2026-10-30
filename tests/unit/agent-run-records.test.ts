import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import simpleGit from 'simple-git'
import Database from 'better-sqlite3'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import {
  OpenCodeRunnerService,
  assistantMessageTokens,
  type OpenCodeRunnerDeps
} from '../../electron/services/opencode-runner-service'
import type { AgentRunRecord, OstlerConfig, WatchedProject } from '../../src/shared/ostler-api'
import { DEFAULT_CONFIG } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

// The Low-IL launcher is faked below, so the Windows-only platform gate is the
// only thing stopping these tests running on Linux and macOS.
vi.mock('../../electron/services/sandbox-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../electron/services/sandbox-service')>()),
  isSandboxSupported: true
}))

/** The opencode HTTP surface the runner calls, with turn aborts recorded. */
function fakeFetch(): { fetchImpl: typeof fetch; aborts: () => number } {
  let aborts = 0
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.endsWith('/doc')) return new Response(null, { status: 200 })
    if (method === 'POST' && url.endsWith('/session')) {
      return new Response(JSON.stringify({ id: 'oc-session-1' }), { status: 200 })
    }
    if (method === 'POST' && url.endsWith('/abort')) {
      aborts += 1
      return new Response('true', { status: 200 })
    }
    if (method === 'POST' && url.endsWith('/message')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    if (method === 'GET' && url.endsWith('/message')) {
      return new Response(JSON.stringify([{}]), { status: 200 })
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`)
  }) as unknown as typeof fetch
  return { fetchImpl, aborts: () => aborts }
}

// Each test drives real Git repositories, which can take longer than the default under a full run.
describe('the run history (R5.3, D43)', { timeout: 20_000 }, () => {
  const tempDir = useTempDir('ostler-run-records-')
  let projectDir: string
  let database: EventDatabase
  let harnessService: HarnessService
  let project: WatchedProject
  let config: OstlerConfig
  let nextPort = 42100

  beforeEach(async () => {
    projectDir = path.join(tempDir(), 'project')
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'app.ts'), 'original\n')
    const git = simpleGit(projectDir)
    await git.init()
    await git.addConfig('user.email', 'test@example.com')
    await git.addConfig('user.name', 'Test')
    await git.add('.')
    await git.commit('initial')

    database = new EventDatabase(await createMigratedDatabase(tempDir()))
    harnessService = new HarnessService(path.join(tempDir(), 'data'), database)
    project = makeWatchedProject({
      id: 'project-1',
      name: 'Test project',
      path: projectDir,
      color: '#fff',
      addedAt: Date.now()
    })
    config = { ...DEFAULT_CONFIG, ai: { ...DEFAULT_CONFIG.ai, apiKey: '' } }
  })

  afterEach(() => {
    database.close()
  })

  const record = (sessionId: string): AgentRunRecord | undefined =>
    database.agentRuns.list(project.id).find((run) => run.sessionId === sessionId)

  /** Starts a built-in run for a new task, with the bridge to talk to it. */
  async function startRun(depsOverride: Partial<OpenCodeRunnerDeps> = {}) {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const worktree = session.workspace!.worktreePath
    await simpleGit(worktree).addConfig('user.email', 'agent@example.com')
    await simpleGit(worktree).addConfig('user.name', 'Agent')
    const launch = vi.fn().mockResolvedValue({ pid: 7000 })
    const killProcess = vi.fn().mockResolvedValue(undefined)
    const { fetchImpl, aborts } = fakeFetch()
    const port = nextPort++
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch,
        fetchImpl,
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess,
        stopWorkspaceProcesses: vi.fn().mockResolvedValue([]),
        choosePort: async () => port,
        pollIntervalMs: 100000,
        idleStablePolls: 100,
        maxPolls: 50,
        healthCheckTimeoutMs: 1000,
        maxContinuationNudges: 0,
        ...depsOverride
      }
    )
    harnessService.touchSessionConnection(project, session.id)
    const claimed = harnessService.getState(project).taskQueue.find((item) => item.id === task.id)!
    await runner.start(project, session, claimed)
    const env = launch.mock.calls[0][3].environment
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OSTLER_BRIDGE_SECRET}`
    }
    const bridgeUrl = `http://127.0.0.1:${env.OSTLER_BRIDGE_PORT}`
    const bridge = (route: string, body: Record<string, unknown>) =>
      fetch(`${bridgeUrl}/${route}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId: session.id, projectId: project.id, ...body })
      })
    const event = (type: string, properties: Record<string, unknown> = {}) =>
      bridge('event', { event: { id: `evt_${Math.random()}`, type, properties } })
    const tokens = (id: string, input: number, output: number, reasoning = 0) =>
      event('message.updated', {
        info: { id, role: 'assistant', tokens: { input, output, reasoning } }
      })
    return { task, session, worktree, runner, killProcess, aborts, bridge, event, tokens }
  }

  it("reads each assistant message's tokens, reasoning counted as output", () => {
    expect(
      assistantMessageTokens({
        info: { id: 'm1', role: 'assistant', tokens: { input: 10, output: 4, reasoning: 2 } }
      })
    ).toEqual({ id: 'm1', input: 10, output: 6 })
    expect(assistantMessageTokens({ info: { id: 'u1', role: 'user', tokens: {} } })).toBeNull()
    expect(assistantMessageTokens(undefined)).toBeNull()
  })

  it('records a finished run with its usage summed across turns, and the review verdict', async () => {
    const run = await startRun()
    // A message's tokens grow while it streams: the latest count for each
    // message counts once, and the run's usage is the sum over messages.
    await run.tokens('m1', 100, 10)
    await run.tokens('m1', 120, 20)
    await run.tokens('m2', 300, 40, 5)
    fs.writeFileSync(path.join(run.worktree, 'app.ts'), 'agent work\n')
    await simpleGit(run.worktree).add('.')
    await simpleGit(run.worktree).commit('Agent work')
    await run.bridge('complete', {
      summary: 'Did it',
      filesChanged: ['app.ts'],
      verification: 'Not run: test',
      blockers: 'None'
    })
    await run.event('session.idle')
    expect(run.runner.isRunning(run.session.id)).toBe(false)

    const ended = record(run.session.id)!
    expect(ended).toMatchObject({
      provenance: 'embedded',
      taskId: run.task.id,
      outcome: 'in_review',
      endedAs: 'in_review',
      inputTokens: 420,
      outputTokens: 65,
      usageReported: false,
      filesChanged: 1
    })
    expect(ended.endedAt).toBeGreaterThanOrEqual(ended.startedAt)

    // The history reads the branch's commits while it is in review.
    const history = await harnessService.getRunHistory(project)
    expect(history.runs[0]).toMatchObject({ commits: 1, filesChanged: 1 })

    await harnessService.applyTaskWork(project, run.session.id)
    expect(record(run.session.id)).toMatchObject({
      outcome: 'accepted',
      endedAs: 'in_review',
      commits: 1,
      inputTokens: 420
    })
  })

  it('records a run the person stopped as stopped', async () => {
    const run = await startRun()
    await run.tokens('m1', 50, 5)
    await run.runner.stop(run.session.id, 'Stopped: force-released by human.')
    expect(record(run.session.id)).toMatchObject({
      outcome: 'stopped',
      endedAs: 'stopped',
      detail: 'Stopped: force-released by human.',
      inputTokens: 50,
      outputTokens: 5
    })
  })

  it('records every run Stop all AI ended as stopped', async () => {
    const first = await startRun()
    const second = await startRun()
    await first.runner.stopAll('Stopped: the emergency stop was pressed.')
    await second.runner.stopAll('Stopped: the emergency stop was pressed.')
    for (const run of [first, second]) {
      expect(record(run.session.id)).toMatchObject({ outcome: 'stopped', endedAs: 'stopped' })
    }
  })

  it('records a run whose stall the watchdog could not recover as failed, with the stall', async () => {
    const run = await startRun({
      stallCheckIntervalMs: 20,
      noProgressStallMs: 50,
      toolStallGraceMs: 50,
      maxStallAborts: 1
    })
    await vi.waitFor(() => expect(run.runner.isRunning(run.session.id)).toBe(false), {
      timeout: 5000,
      interval: 20
    })
    expect(record(run.session.id)).toMatchObject({
      outcome: 'failed',
      endedAs: 'failed',
      stalls: 1
    })
  })

  it('records a run that failed partway as failed', async () => {
    const run = await startRun()
    await run.event('message.updated', {
      info: { role: 'assistant', error: { name: 'APIError', data: { message: 'Overloaded' } } }
    })
    await run.event('session.idle')
    expect(run.runner.isRunning(run.session.id)).toBe(false)
    // Nothing was produced: the copy went back to its task, so nothing was discarded.
    expect(record(run.session.id)).toMatchObject({ outcome: 'failed', endedAs: 'failed' })
  })

  it('records a run that failed to start as failed', async () => {
    const task = harnessService.addTask(project, 'Task', 'details')
    const session = await harnessService.startEmbeddedSessionForTask(project, task.id)
    const runner = new OpenCodeRunnerService(
      harnessService,
      () => config,
      path.join(tempDir(), 'data'),
      {
        launch: vi.fn().mockRejectedValue(new Error('opencode.exe is missing')),
        fetchImpl: fakeFetch().fetchImpl,
        resolveBinary: () => 'C:\\fake\\opencode.exe',
        killProcess: vi.fn().mockResolvedValue(undefined),
        stopWorkspaceProcesses: vi.fn().mockResolvedValue([]),
        choosePort: async () => nextPort++,
        healthCheckTimeoutMs: 1000
      }
    )
    harnessService.touchSessionConnection(project, session.id)
    const claimed = harnessService.getState(project).taskQueue.find((item) => item.id === task.id)!
    // Every start path fails the session this way when the runner throws.
    await runner.start(project, session, claimed).catch((error: Error) => {
      harnessService.failSession(project, session.id, `Failed to start: ${error.message}`)
    })
    expect(record(session.id)).toMatchObject({ outcome: 'failed', endedAs: 'failed' })
  })

  it('keeps the record across a restart, and backfills runs from before the history', async () => {
    const run = await startRun()
    await run.runner.stop(run.session.id)
    database.close()
    database = new EventDatabase(path.join(tempDir(), 'ostler.db'))
    const reopened = new HarnessService(path.join(tempDir(), 'data'), database)
    expect((await reopened.getRunHistory(project)).runs.map((entry) => entry.sessionId)).toEqual([
      run.session.id
    ])

    // A run that ended before the history existed is recorded once, at start-up.
    expect(reopened.backfillRunHistory(project)).toBe(0)
    const raw = new Database(path.join(tempDir(), 'ostler.db'))
    raw.prepare('DELETE FROM agent_runs').run()
    raw.close()
    expect(reopened.backfillRunHistory(project)).toBe(1)
    expect(record(run.session.id)).toMatchObject({ outcome: 'stopped', endedAs: 'stopped' })
  })

  describe('token limits', () => {
    it('refuses a new built-in run at a limit, in plain words', async () => {
      const run = await startRun()
      await run.tokens('m1', 900, 200)
      await run.runner.stop(run.session.id)
      project = { ...project, agentLimits: { tokensPerDay: 1000, tokensPerMonth: null } }
      const task = harnessService.addTask(project, 'Another', 'details')
      await expect(harnessService.startEmbeddedSessionForTask(project, task.id)).rejects.toThrow(
        /daily token limit \(1,100 of 1,000 tokens\)/
      )
      expect(harnessService.getAgentUsage(project).day).toMatchObject({
        used: 1100,
        limit: 1000,
        reached: true
      })
    })

    it('stops a running run at its next turn boundary, never mid-call, with its work kept', async () => {
      project = { ...project, agentLimits: { tokensPerDay: 1000, tokensPerMonth: null } }
      const run = await startRun()
      await run.bridge('tool-call', { tool: 'bash', args: { command: 'npm test' } })
      fs.writeFileSync(path.join(run.worktree, 'app.ts'), 'half done\n')
      await run.tokens('m1', 900, 200)

      // A call is in flight: nothing is aborted until it returns.
      expect(run.aborts()).toBe(0)
      expect(run.runner.isRunning(run.session.id)).toBe(true)
      await run.bridge('tool-result', { tool: 'bash', output: 'ok' })
      await vi.waitFor(() => expect(run.aborts()).toBe(1))

      // The aborted turn ends; the run ends through the end path, not a nudge.
      await run.event('session.idle')
      expect(run.runner.isRunning(run.session.id)).toBe(false)
      const ended = record(run.session.id)!
      expect(ended.outcome).toBe('stopped')
      expect(ended.detail).toContain('daily token limit')
      // Its work was swept onto its branch and waits for review.
      expect((await simpleGit(run.worktree).status()).isClean()).toBe(true)
      expect(
        harnessService.getState(project).reviewSessions.some((s) => s.id === run.session.id)
      ).toBe(true)
    })
  })
})
