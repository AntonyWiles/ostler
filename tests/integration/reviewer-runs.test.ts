import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import simpleGit from 'simple-git'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { HarnessHttpServer } from '../../electron/services/harness-http-server'
import type { HarnessReviewOf, HarnessSession, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { initProjectRepository } from '../helpers/harness'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

/** Reviewer runs (N9.5a), on as N9.5b will ship them: an external reviewer over the harness API. */
vi.mock('../../src/shared/reviewer-runs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/shared/reviewer-runs')>()),
  REVIEWER_RUNS_AVAILABLE: true
}))

let HARNESS_PORT = 0

describe('reviewer runs over the harness API', { timeout: 30_000 }, () => {
  const root = useTempDir('ostler-reviewer-http-')
  let project: WatchedProject
  let database: EventDatabase
  let harnessService: HarnessService
  let server: HarnessHttpServer

  beforeEach(async () => {
    const projectPath = path.join(root(), 'project')
    fs.mkdirSync(projectPath, { recursive: true })
    fs.writeFileSync(path.join(projectPath, 'app.ts'), 'one\ntwo\nthree\n')
    await initProjectRepository(projectPath)
    project = makeWatchedProject({
      id: 'review-project',
      name: 'Review project',
      path: projectPath,
      addedAt: Date.now()
    })
    database = new EventDatabase(await createMigratedDatabase(root()))
    harnessService = new HarnessService(path.join(root(), 'data'), database)
    server = new HarnessHttpServer(
      () => [project],
      harnessService,
      () => {},
      path.join(root(), 'data')
    )
    HARNESS_PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(async () => {
    server.stop()
    await harnessService.settleReviewEnds()
    harnessService.stopAll()
    database.close()
  })

  function harness(method: string, urlPath: string, token: string, body?: unknown) {
    return fetch(`http://127.0.0.1:${HARNESS_PORT}/harness/${project.id}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }

  async function value<T>(response: Response): Promise<T> {
    const body = (await response.json()) as { ok: boolean; value: T; error?: string }
    if (!body.ok) throw new Error(`${response.status}: ${body.error}`)
    return body.value
  }

  async function sessionInReview(): Promise<HarnessSession> {
    const task = harnessService.addTask(project, 'Count to three', 'Spell the numbers.')
    const session = await harnessService.startSessionForTask(project, task.id)
    fs.writeFileSync(path.join(session.workspace!.worktreePath, 'app.ts'), 'one\n2\nthree\n')
    const copyGit = simpleGit(session.workspace!.worktreePath)
    await copyGit.add('.')
    await copyGit.commit('two')
    await value(
      await harness('POST', `/tasks/${task.id}/complete`, session.token, {
        sessionId: session.id,
        report: { filesChanged: ['app.ts'], summary: 'Changed two.' }
      })
    )
    return session
  }

  it('an external agent claims a review, reads reviewOf, and reports findings', async () => {
    const reviewed = await sessionInReview()
    const review = await harnessService.startReview(project, reviewed.id)
    const reviewer = await harnessService.startSessionForTask(project, review.id)

    const read = await value<{ reviewOf?: HarnessReviewOf; reviewInstructions?: string }>(
      await harness('GET', `/session/${reviewer.id}`, reviewer.token)
    )
    expect(read.reviewOf).toEqual(review.reviewOf)
    expect(read.reviewInstructions).toContain('Change nothing')

    await value(
      await harness('POST', `/tasks/${review.id}/release`, reviewer.token, {
        sessionId: reviewer.id
      })
    )
    const claim = await value<{ reviewOf?: HarnessReviewOf; details: string }>(
      await harness('POST', `/tasks/${review.id}/claim`, reviewer.token, { sessionId: reviewer.id })
    )
    expect(claim.reviewOf?.sessionId).toBe(reviewed.id)
    expect(claim.details).toContain(`git diff ${claim.reviewOf!.baseCommit}..`)

    const help = await value<{ instructions: string }>(
      await harness('GET', '/help', reviewer.token)
    )
    expect(help.instructions).toContain('Review runs:')

    // No commits, nothing edited: a review still completes.
    const completed = await value<{ session: HarnessSession; nextAssignment: unknown }>(
      await harness('POST', `/tasks/${review.id}/complete`, reviewer.token, {
        sessionId: reviewer.id,
        report: {
          filesChanged: [],
          summary: 'One thing to fix.',
          usage: { outputTokens: 10, model: 'external-model' },
          findings: [
            {
              file: 'app.ts',
              side: 'new',
              firstLine: 2,
              lastLine: 2,
              comment: 'Spell it out',
              severity: 'should-fix'
            },
            { file: 'missing.ts', firstLine: 1, comment: 'Add a test', severity: 'nit' }
          ]
        }
      })
    )
    expect(completed.session.status).toBe('done')
    expect(completed.nextAssignment).toBeNull()
    expect(fs.existsSync(reviewer.workspace!.worktreePath)).toBe(false)

    // The reviewer's token stops working once the review ends.
    const after = await harness('GET', `/session/${reviewer.id}`, reviewer.token)
    expect(after.ok).toBe(false)

    const state = JSON.parse(
      fs.readFileSync(path.join(harnessService.getProjectDataDir(project.id), 'state.json'), 'utf8')
    ) as { sessions: HarnessSession[] }
    const record = state.sessions.find((session) => session.id === reviewed.id)!.reviewerReports![0]
    expect(record).toMatchObject({
      reviewerSessionId: reviewer.id,
      provenance: 'external',
      model: 'external-model',
      outcome: 'reported',
      summary: 'One thing to fix.'
    })
    expect(record.findings[0]).toMatchObject({ severity: 'should-fix', comment: 'Spell it out' })
    expect(record.findings[0].excerpt).toContain('+2')
    expect(record.findings[1]).toMatchObject({ general: true, severity: 'nit' })
    expect(harnessService.getState(project).reviewSessions.map((s) => s.id)).toEqual([reviewed.id])
  })
})
