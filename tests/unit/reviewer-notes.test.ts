import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import simpleGit from 'simple-git'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../electron/safe-storage', () => ({
  isEncryptionAvailable: () => true,
  isEncryptedSecret: (value: string) => value.startsWith('ostler-secure:v1:'),
  encryptApiKey: (key: string) => key,
  decryptApiKey: (value: string) => value,
  sealSecret: (token: string) => token,
  openSecret: (value: string) => value
}))

import { CONFIG_MIGRATIONS, ConfigStore } from '../../electron/config-store'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { agentSources, reviewsNeedingYou } from '../../electron/services/inbox-sources'
import { parseReportExtras } from '../../src/shared/agent-report-extras'
import type { HarnessSession, WatchedProject } from '../../src/shared/ostler-api'
import {
  countFindings,
  openFindings,
  projectReviewBeforeMe,
  REVIEW_WAIT_MS,
  REVIEWER_RUNS_AVAILABLE,
  reviewWait,
  waitingForReviewer
} from '../../src/shared/reviewer-runs'
import { createMigratedDatabase } from '../helpers/database'
import { makeWatchedProject } from '../helpers/projects'

const ORIGINAL = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'

/** Reviewer notes in Review changes (N9.5b): the switch, starting reviews, waiting for them. */
describe('Review agent work before me (N9.5b)', () => {
  it('reviewer runs are on', () => {
    expect(REVIEWER_RUNS_AVAILABLE).toBe(true)
  })

  describe('the config migration', () => {
    let tempDir: string
    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-review-before-me-'))
    })
    afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }))

    it("turns every project's switch off, keeps its other settings, and saves it", () => {
      const configPath = path.join(tempDir, 'config.json')
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          configVersion: 38,
          projects: [
            {
              id: 'a',
              name: 'A',
              path: null,
              color: '#fff',
              enabled: true,
              autoDispatch: { enabled: true, maxConcurrentEmbeddedSessions: 2 }
            },
            { id: 'b', name: 'B', path: null, color: '#fff', enabled: true }
          ]
        })
      )
      const store = new ConfigStore(configPath)
      expect(store.getProjectAutoDispatchConfig('a')).toMatchObject({
        enabled: true,
        maxConcurrentEmbeddedSessions: 2,
        reviewBeforeMe: false
      })
      expect(store.getProjectAutoDispatchConfig('b').reviewBeforeMe).toBe(false)
      const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      expect(onDisk.configVersion).toBeGreaterThanOrEqual(39)
      expect(onDisk.projects[0].autoDispatch.reviewBeforeMe).toBe(false)
      expect(
        store.updateProjectAutoDispatchConfig('b', { reviewBeforeMe: true }).reviewBeforeMe
      ).toBe(true)
      expect(store.getProjectAutoDispatchConfig('b').agentsPlanFirst).toBe(false)
      expect(projectReviewBeforeMe(store.getProjects().find((p) => p.id === 'b')!)).toBe(true)

      const migration = CONFIG_MIGRATIONS.find((entry) => entry.version === 39)!
      expect(migration.name).toBe('review-before-me')
      const config: Record<string, unknown> = {
        projects: [{ id: 'c', autoDispatch: { reviewBeforeMe: true } }, { id: 'd' }]
      }
      migration.up(config, { newInstall: false })
      expect(config.projects).toEqual([
        { id: 'c', autoDispatch: { reviewBeforeMe: true } },
        { id: 'd' }
      ])
    })
  })

  describe('waiting for the reviewer', () => {
    const now = Date.parse('2026-10-18T12:00:00Z')
    const report = (outcome: 'reported' | 'not-reported' | 'stopped') => ({
      reviewerSessionId: 'r',
      reviewTaskId: 'rt',
      provenance: 'embedded' as const,
      startedAt: '2026-10-18T11:00:00Z',
      endedAt: '2026-10-18T11:10:00Z',
      outcome,
      summary: 'ok',
      findings: [
        {
          id: 'f1',
          file: 'a.ts',
          side: 'new' as const,
          firstLine: 1,
          lastLine: 1,
          comment: 'x',
          severity: 'must-fix' as const,
          excerpt: ''
        },
        {
          id: 'f2',
          file: 'a.ts',
          side: 'new' as const,
          firstLine: 2,
          lastLine: 2,
          comment: 'y',
          severity: 'nit' as const,
          excerpt: ''
        }
      ]
    })

    it('is running for 30 minutes, then overdue; then reported or failed', () => {
      const requestedAt = new Date(now - REVIEW_WAIT_MS + 1000).toISOString()
      expect(reviewWait({ reviewRequestedAt: requestedAt }, true, now)?.status).toBe('running')
      expect(reviewWait({ reviewRequestedAt: requestedAt }, true, now + 1000)?.status).toBe(
        'overdue'
      )
      expect(reviewWait({}, false, now)).toBeNull()
      expect(reviewWait({ reviewerReports: [report('reported')] }, false, now)?.status).toBe(
        'reported'
      )
      expect(reviewWait({ reviewerReports: [report('not-reported')] }, false, now)?.status).toBe(
        'failed'
      )
    })

    it('keeps a session out of Needs you and the Inbox only while its review runs', () => {
      const session = (id: string, review?: HarnessSession['review']) =>
        ({
          id,
          title: id,
          lastUpdate: '2026-10-18T11:00:00Z',
          ...(review ? { review } : {})
        }) as HarnessSession
      const reviews = reviewsNeedingYou(
        [
          session('plain'),
          session('running', { status: 'running', requestedAt: null }),
          session('overdue', { status: 'overdue', requestedAt: null }),
          session('reported', { status: 'reported', requestedAt: null }),
          session('failed', { status: 'failed', requestedAt: null })
        ],
        () => null
      )
      expect(reviews.map((review) => [review.id, review.reviewer])).toEqual([
        ['plain', undefined],
        ['overdue', 'overdue'],
        ['reported', 'reported'],
        ['failed', 'failed']
      ])
      expect(waitingForReviewer({ review: { status: 'running', requestedAt: null } })).toBe(true)

      const project = { id: 'p', name: 'Shop', enabled: true } as WatchedProject
      const inbox = agentSources(
        () => [project],
        () => true,
        () => ({ questions: [], reviews })
      ).reviews()
      const bodies = inbox.map((item) => item.body)
      expect(bodies[1]).toBe('The reviewer has not finished after 30 minutes · Shop')
      expect(bodies[2]).toBe('Reviewed, ready for you · Shop')
      expect(bodies[3]).toBe('The reviewer did not finish its review · Shop')
    })

    it('counts open findings, leaving out dismissed ones', () => {
      const session = { reviewerReports: [report('reported')], dismissedFindingIds: ['f1'] }
      expect(openFindings(session).map((finding) => finding.id)).toEqual(['f2'])
      expect(countFindings(openFindings({ reviewerReports: [report('reported')] }))).toEqual({
        'must-fix': 1,
        'should-fix': 0,
        nit: 1
      })
    })
  })

  describe('starting reviews in a project', { timeout: 60_000 }, () => {
    let tempDir: string
    let database: EventDatabase
    let service: HarnessService
    let project: WatchedProject
    let switchOn: boolean

    beforeEach(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-reviewer-notes-'))
      const projectDir = path.join(tempDir, 'project')
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
      database = new EventDatabase(await createMigratedDatabase(tempDir))
      service = new HarnessService(path.join(tempDir, 'data'), database)
      project = makeWatchedProject({
        id: 'project-1',
        name: 'Test project',
        path: projectDir,
        color: '#fff',
        addedAt: Date.now()
      })
      switchOn = true
      service.setReviewBeforeMe((projectId) =>
        switchOn && projectId === project.id ? project : null
      )
    })

    afterEach(async () => {
      await service.settleReviewEnds()
      service.stopAll()
      database.close()
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    })

    /** Finishes a task's run, with a change to src/app.ts or none. */
    async function finishRun(
      withChange: boolean,
      provenance: 'external' | 'embedded' = 'external'
    ) {
      const task = service.addTask(project, 'Change the greeting', 'Say hello.')
      const session =
        provenance === 'embedded'
          ? await service.startEmbeddedSessionForTask(project, task.id)
          : await service.startSessionForTask(project, task.id)
      if (withChange) {
        const file = path.join(session.workspace!.worktreePath, 'src', 'app.ts')
        fs.writeFileSync(file, ORIGINAL.replace('line 10', 'hello 10'))
        const copyGit = simpleGit(session.workspace!.worktreePath)
        await copyGit.add('.')
        await copyGit.commit('greet')
      }
      await service.completeSessionWithAutoContinuation(project, session.id, 'done', task.id, {
        filesChanged: withChange ? ['src/app.ts'] : [],
        summary: 'Done.',
        submittedAt: new Date().toISOString()
      })
      return session
    }

    /** Waits for the review started after the write that put a session in review. */
    async function reviewTasks(sessionId: string) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const tasks = service
          .getState(project)
          .taskQueue.filter((task) => task.reviewOf?.sessionId === sessionId)
        if (tasks.length > 0) return tasks
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      return []
    }

    it('starts a review when a session enters review with changes', async () => {
      const session = await finishRun(true)
      const tasks = await reviewTasks(session.id)
      expect(tasks).toHaveLength(1)
      const inReview = service.getState(project).reviewSessions.find((s) => s.id === session.id)!
      expect(inReview.review?.status).toBe('running')
      expect(inReview.reviewRequestedAt).toBeTruthy()
    })

    it('starts none for a session without changes, or with the switch off', async () => {
      const unchanged = await finishRun(false)
      expect(await reviewTasks(unchanged.id)).toEqual([])
      switchOn = false
      const changed = await finishRun(true)
      expect(await reviewTasks(changed.id)).toEqual([])
      expect(
        service.getState(project).reviewSessions.find((s) => s.id === changed.id)?.review
      ).toBeUndefined()
    })

    it('never reviews a review; its findings can be dismissed; reviewer runs count towards usage', async () => {
      const session = await finishRun(true)
      const [review] = await reviewTasks(session.id)
      const reviewer = await service.startEmbeddedSessionForTask(project, review.id)
      service.setEmbeddedRuntime(project, reviewer.id, {
        ...reviewer.embeddedRuntime!,
        usage: { inputTokens: 700, outputTokens: 300 }
      })
      expect(service.getAgentUsage(project).day.used).toBeGreaterThanOrEqual(1000)
      await service.completeSessionWithAutoContinuation(
        project,
        reviewer.id,
        'Reviewed',
        review.id,
        {
          filesChanged: [],
          summary: 'One problem.',
          submittedAt: new Date().toISOString(),
          ...parseReportExtras({
            findings: [
              { file: 'src/app.ts', firstLine: 10, comment: 'Say hi', severity: 'must-fix' }
            ]
          })
        }
      )
      await service.settleReviewEnds()
      // The reviewer's run never enters review, so it starts no review of its own.
      await new Promise((resolve) => setTimeout(resolve, 100))
      const state = service.getState(project)
      expect(state.taskQueue.filter((task) => task.reviewOf?.sessionId === reviewer.id)).toEqual([])
      const reviewed = state.reviewSessions.find((s) => s.id === session.id)!
      expect(reviewed.review?.status).toBe('reported')
      const [finding] = reviewed.reviewerReports!.at(-1)!.findings
      expect(finding.severity).toBe('must-fix')
      expect(openFindings(reviewed)).toHaveLength(1)

      const dismissed = service.dismissReviewFinding(project, session.id, finding.id)
      expect(dismissed.dismissedFindingIds).toEqual([finding.id])
      expect(openFindings(dismissed)).toEqual([])
      expect(() => service.dismissReviewFinding(project, session.id, 'nope')).toThrow(
        'No such reviewer finding'
      )
      expect(
        service.dismissReviewFinding(project, session.id, finding.id, false).dismissedFindingIds ??
          []
      ).toEqual([])
    })
  })
})
