import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import simpleGit from 'simple-git'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { buildHelp } from '../../electron/services/harness-http-server'
import {
  OpenCodeRunnerService,
  buildTaskPrompt
} from '../../electron/services/opencode-runner-service'
import {
  generateOstlerAgentInstructionsMd,
  generateOstlerCompleteTaskToolTs,
  generateOstlerPluginJs
} from '../../electron/services/opencode/ostler-plugin-template'
import type {
  HarnessSession,
  HarnessTaskReport,
  OstlerConfig,
  WatchedProject
} from '../../src/shared/ostler-api'
import { DEFAULT_CONFIG } from '../../src/shared/ostler-api'
import { parseReportExtras } from '../../src/shared/agent-report-extras'
import { REVIEWER_DID_NOT_REPORT } from '../../src/shared/reviewer-runs'
import { createMigratedDatabase } from '../helpers/database'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

/** Reviewer runs (N9.5a) turned on, as N9.5b will ship them. */
vi.mock('../../src/shared/reviewer-runs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/shared/reviewer-runs')>()),
  REVIEWER_RUNS_AVAILABLE: true
}))
vi.mock('../../electron/services/sandbox-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../electron/services/sandbox-service')>()),
  isSandboxSupported: true
}))

const ORIGINAL = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'

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

describe('reviewer runs, with reviews available', { timeout: 60_000 }, () => {
  const tempDir = useTempDir('ostler-reviewer-')
  let projectDir: string
  let database: EventDatabase
  let service: HarnessService
  let project: WatchedProject
  const config: OstlerConfig = { ...DEFAULT_CONFIG, ai: { ...DEFAULT_CONFIG.ai, apiKey: '' } }

  beforeEach(async () => {
    projectDir = path.join(tempDir(), 'project')
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'src', 'app.ts'), ORIGINAL)
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

  afterEach(async () => {
    await service.settleReviewEnds()
    service.stopAll()
    database.close()
  })

  /** A session in review whose change rewrote lines 10 and 11 of src/app.ts. */
  async function sessionInReview(): Promise<{ session: HarnessSession; taskId: string }> {
    const task = service.addTask(
      project,
      'Change the greeting',
      'Say hello.\nAcceptance: lines 10 and 11 greet.'
    )
    const session = await service.startSessionForTask(project, task.id)
    const file = path.join(session.workspace!.worktreePath, 'src', 'app.ts')
    fs.writeFileSync(file, ORIGINAL.replace('line 10\nline 11', 'hello 10\nhello 11'))
    const copyGit = simpleGit(session.workspace!.worktreePath)
    await copyGit.add('.')
    await copyGit.commit('greet')
    await service.completeSessionWithAutoContinuation(project, session.id, 'done', task.id, {
      filesChanged: ['src/app.ts'],
      summary: 'Changed the greeting.',
      submittedAt: new Date().toISOString()
    })
    return { session, taskId: task.id }
  }

  async function startReviewer(
    reviewedId: string,
    provenance: 'external' | 'embedded' = 'external'
  ) {
    const review = await service.startReview(project, reviewedId)
    const reviewer =
      provenance === 'embedded'
        ? await service.startEmbeddedSessionForTask(project, review.id)
        : await service.startSessionForTask(project, review.id)
    return { review, reviewer }
  }

  function storedSession(id: string): HarnessSession {
    const state = JSON.parse(
      fs.readFileSync(path.join(service.getProjectDataDir(project.id), 'state.json'), 'utf8')
    ) as { sessions: HarnessSession[] }
    return state.sessions.find((session) => session.id === id)!
  }

  function reviewedSession(id: string): HarnessSession {
    return storedSession(id)
  }

  function findingsReport(findings: unknown[], model?: string): HarnessTaskReport {
    return {
      filesChanged: [],
      summary: 'Two problems.',
      submittedAt: new Date().toISOString(),
      ...(model ? { usage: { inputTokens: 1, model } } : {}),
      ...parseReportExtras({ findings })
    }
  }

  describe('starting a review', () => {
    it('queues one review of a session in review, ahead of ordinary work, with its details', async () => {
      const { session } = await sessionInReview()
      const ordinary = service.addTask(project, 'Ordinary work', '')
      const head = (
        await simpleGit(projectDir).raw(['rev-parse', session.workspace!.branchName])
      ).trim()
      const base = (await simpleGit(projectDir).raw(['rev-parse', 'main'])).trim()

      const review = await service.startReview(project, session.id)
      expect(review.reviewOf).toEqual({ sessionId: session.id, baseCommit: base, headCommit: head })
      const pending = service.getState(project).taskQueue.filter((t) => t.status === 'pending')
      expect(pending.map((task) => task.id)).toEqual([review.id, ordinary.id])
      expect(review.details).toContain('Change the greeting')
      expect(review.details).toContain('Acceptance: lines 10 and 11 greet.')
      expect(review.details).toContain('Changed the greeting.')
      expect(review.details).toContain('src/app.ts')
      expect(review.details).toContain(`git diff ${base}..${head}`)
      expect(review.details).toContain('Change nothing')

      await expect(service.startReview(project, session.id)).rejects.toThrow(/already has a review/)
    })

    it('refuses work that is not waiting for review, and a review of a review', async () => {
      const task = service.addTask(project, 'Running', '')
      const running = await service.startSessionForTask(project, task.id)
      await expect(service.startReview(project, running.id)).rejects.toThrow(/waiting for review/)

      const { session } = await sessionInReview()
      const { reviewer } = await startReviewer(session.id)
      await expect(service.startReview(project, reviewer.id)).rejects.toThrow(/cannot itself/)
    })
  })

  describe("the reviewer's copy", () => {
    it('is detached at the head commit, with no version of its own, and counts with the copies prepared ahead', async () => {
      const { session } = await sessionInReview()
      const review = await service.startReview(project, session.id)
      await service.prepareCopies(project, 1)
      const queued = service.getState(project).taskQueue.find((t) => t.id === review.id)!
      expect(queued.copy).toMatchObject({ state: 'ready', detached: true, branchName: '' })

      const reviewer = await service.startSessionForTask(project, review.id)
      expect(reviewer.reviewOf?.sessionId).toBe(session.id)
      expect(reviewer.workspace).toMatchObject({ detached: true, branchName: '' })
      const copyGit = simpleGit(reviewer.workspace!.worktreePath)
      expect((await copyGit.raw(['rev-parse', 'HEAD'])).trim()).toBe(review.reviewOf!.headCommit)
      expect((await copyGit.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('HEAD')
      expect(
        fs.readFileSync(path.join(reviewer.workspace!.worktreePath, 'src', 'app.ts'), 'utf8')
      ).toContain('hello 10')
      const branches = await simpleGit(projectDir).raw(['branch', '--list', 'ostler/review*'])
      expect(branches.trim()).toBe('')
    })
  })

  describe('findings', () => {
    it('are checked, excerpted, capped and stored with the reviewed session as the reviewer’s; edits are thrown away', async () => {
      const { session } = await sessionInReview()
      const { review, reviewer } = await startReviewer(session.id)
      // The reviewer edits and commits anyway: none of it may land.
      fs.writeFileSync(path.join(reviewer.workspace!.worktreePath, 'src', 'app.ts'), 'mine\n')
      const copyGit = simpleGit(reviewer.workspace!.worktreePath)
      await copyGit.add('.')
      await copyGit.commit('reviewer edit')

      const findings = [
        {
          file: 'src/app.ts',
          side: 'new',
          firstLine: 10,
          lastLine: 11,
          comment: 'Say hi',
          severity: 'must-fix'
        },
        { file: 'src/app.ts', side: 'old', firstLine: 10, comment: 'Kept?', severity: 'nit' },
        {
          file: 'src/other.ts',
          side: 'new',
          firstLine: 1,
          comment: 'Missing test',
          severity: 'should-fix'
        },
        {
          file: 'src/app.ts',
          side: 'new',
          firstLine: 1,
          comment: 'Bad severity',
          severity: 'blocker'
        },
        ...Array.from({ length: 49 }, () => ({
          file: 'src/app.ts',
          firstLine: 10,
          comment: 'More',
          severity: 'nit'
        }))
      ]
      const result = await service.completeSessionWithAutoContinuation(
        project,
        reviewer.id,
        'Reviewed',
        review.id,
        findingsReport(findings, 'reviewer-model')
      )
      expect(result.nextTask).toBeNull()
      expect(result.session.status).toBe('done')
      expect(fs.existsSync(reviewer.workspace!.worktreePath)).toBe(false)

      const reports = reviewedSession(session.id).reviewerReports!
      expect(reports).toHaveLength(1)
      const record = reports[0]
      expect(record).toMatchObject({
        reviewerSessionId: reviewer.id,
        reviewTaskId: review.id,
        provenance: 'external',
        model: 'reviewer-model',
        outcome: 'reported',
        summary: 'Two problems.',
        findingsLeftOut: 3
      })
      expect(record.findings).toHaveLength(50)
      expect(record.findings[0]).toMatchObject({ severity: 'must-fix', side: 'new' })
      expect(record.findings[0].excerpt).toContain('+hello 10')
      expect(record.findings[0].general).toBeUndefined()
      expect(record.findings[1].excerpt).toContain('-line 10')
      expect(record.findings[2]).toMatchObject({ general: true, excerpt: '' })
      expect(new Set(record.findings.map((finding) => finding.id)).size).toBe(50)

      // The reviewed work is untouched, still in review; the review run is not.
      const state = service.getState(project)
      expect(state.reviewSessions.map((item) => item.id)).toEqual([session.id])
      const diff = await service.getSessionDiff(project, session.id)
      expect(diff.patch).toContain('hello 10')
      expect(diff.patch).not.toContain('mine')
      const reviewTask = state.taskQueue.find((task) => task.id === review.id)!
      expect(reviewTask.status).toBe('complete')
      expect(reviewTask.report?.findingRequests).toBeUndefined()
      expect(
        service.getRecentRuns(project).find((run) => run.sessionId === reviewer.id)
      ).toBeDefined()

      // A review run is never applied, discarded or sent back.
      await expect(service.applyTaskWork(project, reviewer.id)).rejects.toThrow()
      await expect(service.discardTaskWork(project, reviewer.id)).rejects.toThrow()

      // Applying the reviewed work records its own entry; the review shows nowhere in History.
      await service.applyTaskWork(project, session.id)
      const history = await service.getProjectHistory(project)
      expect(history.entries.some((entry) => /Review:/.test(entry.title))).toBe(false)
      expect(fs.readFileSync(path.join(projectDir, 'src', 'app.ts'), 'utf8')).not.toContain('mine')
      expect(fs.readFileSync(path.join(projectDir, 'src', 'app.ts'), 'utf8')).toContain('hello 10')
    })

    it('a review that ends without a report says the reviewer did not report', async () => {
      const { session } = await sessionInReview()
      const { reviewer } = await startReviewer(session.id)
      service.failSession(project, reviewer.id, 'Went quiet')
      await service.settleReviewEnds()
      const record = reviewedSession(session.id).reviewerReports![0]
      expect(record).toMatchObject({ outcome: 'not-reported', summary: REVIEWER_DID_NOT_REPORT })
      expect(record.findings).toEqual([])
      expect(storedSession(reviewer.id)).toMatchObject({ status: 'done' })
      expect(service.getState(project).reviewSessions.map((item) => item.id)).toEqual([session.id])
      // The review task is not handed back to the queue to run again.
      expect(
        service.getState(project).taskQueue.filter((task) => task.status === 'pending')
      ).toEqual([])
    })
  })

  describe('when the reviewed task ends', () => {
    it('a queued review is cancelled and its copy removed', async () => {
      const { session } = await sessionInReview()
      const review = await service.startReview(project, session.id)
      await service.prepareCopies(project, 1)
      const copyPath = service.getState(project).taskQueue.find((t) => t.id === review.id)!.copy!
        .worktreePath
      expect(fs.existsSync(copyPath)).toBe(true)

      await service.discardTaskWork(project, session.id)
      const task = service.getState(project).taskQueue.find((t) => t.id === review.id)!
      expect(task.status).toBe('cancelled')
      expect(fs.existsSync(copyPath)).toBe(false)
    })

    it('a running review is stopped, its agent stopped and its copy removed', async () => {
      const stopper = vi.fn().mockResolvedValue(undefined)
      service.setRunStopper(stopper)
      const { session } = await sessionInReview()
      const { reviewer } = await startReviewer(session.id)

      await service.sendBackTaskWork(project, session.id, 'Try again', 'retry')
      expect(stopper).toHaveBeenCalledWith(reviewer.id)
      expect(storedSession(reviewer.id)).toMatchObject({ status: 'done', endedAs: 'stopped' })
      expect(fs.existsSync(reviewer.workspace!.worktreePath)).toBe(false)
      expect(reviewedSession(session.id).reviewerReports![0].outcome).toBe('stopped')
    })

    it('Stop on the reviewed task stops its review too', async () => {
      const { session } = await sessionInReview()
      const { reviewer } = await startReviewer(session.id)
      await service.stopSession(project, session.id)
      expect(storedSession(reviewer.id).status).toBe('done')
      expect(fs.existsSync(reviewer.workspace!.worktreePath)).toBe(false)
    })
  })

  describe('the embedded reviewer', () => {
    it('is told how to review, and its file-editing tools are refused', async () => {
      const { session } = await sessionInReview()
      const { review, reviewer } = await startReviewer(session.id, 'embedded')
      const task = service.getState(project).taskQueue.find((t) => t.id === review.id)!

      const prompt = buildTaskPrompt(task, reviewer.workspace)
      expect(prompt).toContain(
        `git diff ${review.reviewOf!.baseCommit}..${review.reviewOf!.headCommit}`
      )
      expect(prompt).toContain('change nothing')
      expect(prompt).not.toContain('commit your changes')

      const launch = vi.fn().mockResolvedValue({ pid: 7301 })
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
          choosePort: async () => 43201,
          pollIntervalMs: 100000,
          idleStablePolls: 100,
          maxPolls: 50,
          healthCheckTimeoutMs: 1000
        }
      )
      const active = service.getState(project).activeSessions.find((s) => s.id === reviewer.id)!
      await runner.start(project, active, task)
      const env = launch.mock.calls[0][3].environment
      const toolCall = async (tool: string) =>
        (await (
          await fetch(`http://127.0.0.1:${env.OSTLER_BRIDGE_PORT}/tool-call`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${env.OSTLER_BRIDGE_SECRET}`
            },
            body: JSON.stringify({ sessionId: reviewer.id, projectId: project.id, tool, args: {} })
          })
        ).json()) as { ok: boolean; reviewRefused?: string }
      expect((await toolCall('read')).reviewRefused).toBeUndefined()
      expect((await toolCall('edit')).reviewRefused).toContain('review run')
      expect((await toolCall('write')).reviewRefused).toBeDefined()

      await runner.stop(reviewer.id)
      await service.settleReviewEnds()
      expect(storedSession(reviewer.id).status).toBe('done')
      expect(fs.existsSync(reviewer.workspace!.worktreePath)).toBe(false)
      expect(reviewedSession(session.id).reviewerReports).toHaveLength(1)
    })

    it('the plugin, the completion tool, the instructions and the help explain review runs', () => {
      const plugin = generateOstlerPluginJs('C:/slot', 1, 'secret', 's', 'p')
      expect(plugin).toContain("'Ostler review run: ' + data.reviewRefused")
      expect(plugin).toContain("e.message.startsWith('Ostler review run:')")
      const tool = generateOstlerCompleteTaskToolTs(1, 'secret', 's', 'p')
      expect(tool).toContain('findings: args.findings')
      expect(tool).toContain('"must-fix", "should-fix", "nit"')
      expect(generateOstlerAgentInstructionsMd('C:/slot', 'main', 'abc')).toContain(
        '## Review runs'
      )
      const help = buildHelp(project.id) as { instructions: string }
      expect(help.instructions).toContain('Review runs:')
      expect(help.instructions).toContain('reviewOf')
      expect(help.instructions).toContain('nothing to fix')
    })
  })
})
