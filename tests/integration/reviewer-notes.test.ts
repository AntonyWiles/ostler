import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import simpleGit from 'simple-git'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { parseReportExtras } from '../../src/shared/agent-report-extras'
import type {
  HarnessSession,
  HarnessTask,
  ProjectAutoDispatchConfig,
  WatchedProject
} from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { initProjectRepository, startTaskSession } from '../helpers/harness'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let AUTOMATION_PORT = 0

/** Reviewer notes (N9.5b) over the automation API: asking for a review, its findings, the switch. */
describe('reviews over the automation API', { timeout: 60_000 }, () => {
  const root = useTempDir('ostler-reviewer-notes-http-')
  let project: WatchedProject
  let database: EventDatabase
  let planning: PlanningService
  let harnessService: HarnessService
  let server: AutomationHttpServer
  let settings: ProjectAutoDispatchConfig

  beforeEach(async () => {
    const projectPath = path.join(root(), 'project')
    await initProjectRepository(projectPath)
    settings = {
      projectId: 'review-api-project',
      enabled: false,
      maxConcurrentEmbeddedSessions: 0,
      aiOverrideEnabled: false,
      defaultProvider: '',
      defaultModel: '',
      defaultEffort: '',
      autoArchiveDoneAfterDays: 0,
      agentsPlanFirst: false,
      reviewBeforeMe: false
    }
    project = makeWatchedProject({
      id: 'review-api-project',
      name: 'Review API project',
      path: projectPath,
      addedAt: Date.now(),
      automationToken: 'automation-token',
      autoDispatch: settings
    })
    const dbPath = await createMigratedDatabase(root())
    database = new EventDatabase(dbPath)
    planning = new PlanningService(dbPath, () => [project.id])
    harnessService = new HarnessService(path.join(root(), 'data'), database)
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
    AUTOMATION_PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(async () => {
    server.stop()
    await harnessService.settleReviewEnds()
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

  /** A session in review whose change added a line to README.md. */
  async function sessionInReview(): Promise<HarnessSession> {
    const session = await startTaskSession(harnessService, project, 'Add a line')
    const worktree = session.workspace!.worktreePath
    fs.writeFileSync(path.join(worktree, 'README.md'), 'x\nmore\n')
    await simpleGit(worktree).add('.')
    await simpleGit(worktree).commit('more')
    await harnessService.completeSessionWithAutoContinuation(
      project,
      session.id,
      'done',
      session.taskId!,
      {
        filesChanged: ['README.md'],
        summary: 'Added a line.',
        submittedAt: new Date().toISOString()
      }
    )
    return session
  }

  type Listed = HarnessSession & { openFindings: { id: string; severity: string }[] }

  it('POST /sessions/:sessionId/review starts a review, and GET /sessions returns its state and findings', async () => {
    const session = await sessionInReview()
    const review = await value<HarnessTask>(
      await automation('POST', `/sessions/${session.id}/review`)
    )
    expect(review.reviewOf?.sessionId).toBe(session.id)
    // Only one at a time.
    const again = await automation('POST', `/sessions/${session.id}/review`)
    expect(again.status).toBe(400)

    let listed = await value<{ review: Listed[] }>(await automation('GET', '/sessions'))
    expect(listed.review.find((entry) => entry.id === session.id)?.review?.status).toBe('running')

    const reviewer = await harnessService.startSessionForTask(project, review.id)
    await harnessService.completeSessionWithAutoContinuation(
      project,
      reviewer.id,
      'Reviewed',
      review.id,
      {
        filesChanged: [],
        summary: 'One problem.',
        submittedAt: new Date().toISOString(),
        ...parseReportExtras({
          findings: [{ file: 'README.md', firstLine: 2, comment: 'Why?', severity: 'must-fix' }]
        })
      }
    )
    await harnessService.settleReviewEnds()

    listed = await value<{ review: Listed[] }>(await automation('GET', '/sessions'))
    const entry = listed.review.find((candidate) => candidate.id === session.id)!
    expect(entry.review?.status).toBe('reported')
    expect(entry.reviewerReports?.at(-1)?.findings[0]).toMatchObject({
      file: 'README.md',
      firstLine: 2,
      severity: 'must-fix',
      comment: 'Why?'
    })
    expect(entry.openFindings.map((finding) => finding.severity)).toEqual(['must-fix'])
    // The review run itself is never in review.
    expect(listed.review.some((candidate) => candidate.id === reviewer.id)).toBe(false)
  })

  it('refuses a review of a review run and of work not in review', async () => {
    const running = await startTaskSession(harnessService, project, 'Still going')
    const response = await automation('POST', `/sessions/${running.id}/review`)
    expect(response.status).toBe(400)
  })

  it('reads and sets reviewBeforeMe in /auto-dispatch, and lists the route in its help', async () => {
    expect(
      (await value<ProjectAutoDispatchConfig>(await automation('GET', '/auto-dispatch')))
        .reviewBeforeMe
    ).toBe(false)
    const updated = await value<ProjectAutoDispatchConfig>(
      await automation('PATCH', '/auto-dispatch', { reviewBeforeMe: true })
    )
    expect(updated.reviewBeforeMe).toBe(true)
    expect(project.autoDispatch?.reviewBeforeMe).toBe(true)

    const paths = HELP_ROUTES.map((route) => `${route.method} ${route.path}`)
    expect(paths).toContain('POST /sessions/:sessionId/review')
    const autoDispatchHelp = HELP_ROUTES.find(
      (route) => route.method === 'GET' && route.path === '/auto-dispatch'
    )!
    expect(autoDispatchHelp.description).toContain('reviewBeforeMe')
    const sessionsHelp = HELP_ROUTES.find(
      (route) => route.method === 'GET' && route.path === '/sessions'
    )!
    expect(sessionsHelp.description).toContain('reviewerReports')
  })
})
