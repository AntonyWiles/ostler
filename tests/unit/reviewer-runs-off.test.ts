import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { buildHelp } from '../../electron/services/harness-http-server'
import { buildTaskPrompt } from '../../electron/services/opencode-runner-service'
import {
  generateOstlerAgentInstructionsMd,
  generateOstlerCompleteTaskToolTs
} from '../../electron/services/opencode/ostler-plugin-template'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { parseReportExtras } from '../../src/shared/agent-report-extras'
import { REVIEWER_RUNS_AVAILABLE } from '../../src/shared/reviewer-runs'
import { createMigratedDatabase } from '../helpers/database'
import { initProjectRepository, startTaskSession } from '../helpers/harness'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

/** Reviewer runs turned off, as N9.5a shipped them before N9.5b turned them on. */
vi.mock('../../src/shared/reviewer-runs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/shared/reviewer-runs')>()),
  REVIEWER_RUNS_AVAILABLE: false
}))

/**
 * Reviewer runs (N9.5a) as they shipped until N9.5b: hidden. Nothing starts a
 * review, and nothing tells people or agents about reviews.
 */
describe('reviewer runs, while reviews are unavailable', { timeout: 30_000 }, () => {
  const tempDir = useTempDir('ostler-reviewer-off-')
  let database: EventDatabase
  let service: HarnessService
  let project: WatchedProject

  beforeEach(async () => {
    const projectDir = path.join(tempDir(), 'project')
    await initProjectRepository(projectDir)
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
    service.stopAll()
    database.close()
  })

  it('is off', () => {
    expect(REVIEWER_RUNS_AVAILABLE).toBe(false)
  })

  it('nothing starts a review', async () => {
    const session = await startTaskSession(service, project, 'Task')
    fs.writeFileSync(path.join(session.workspace!.worktreePath, 'a.txt'), 'a\n')
    await service.completeSessionWithAutoContinuation(
      project,
      session.id,
      'done',
      session.taskId!,
      {
        filesChanged: ['a.txt'],
        summary: 'Added a.',
        submittedAt: new Date().toISOString()
      }
    )
    await expect(service.startReview(project, session.id)).rejects.toThrow(/not available/)
    expect(service.getState(project).taskQueue.some((task) => task.reviewOf)).toBe(false)
  })

  it('the instructions, the prompt, the tools and the help do not mention reviews', () => {
    const instructions = generateOstlerAgentInstructionsMd('C:/slot', 'main', 'abc')
    expect(instructions).not.toMatch(/review run|findings/i)
    expect(generateOstlerCompleteTaskToolTs(1, 'secret', 's', 'p')).not.toContain('findings')

    // Even a task carrying reviewOf (from a later version's state) is not told to review.
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
        reviewOf: { sessionId: 'x', baseCommit: 'a', headCommit: 'b' }
      },
      null
    )
    expect(prompt).not.toMatch(/review run|git diff a\.\.b/)
    expect(prompt).toContain('Start now.')

    const help = buildHelp(project.id) as {
      instructions: string
      routes: { description: string }[]
    }
    expect(help.instructions).not.toMatch(/review run|reviewOf|findings/i)
    expect(help.routes.some((route) => /findings|reviewOf/.test(route.description))).toBe(false)
  })

  it('a report keeps no findings', () => {
    expect(
      parseReportExtras({ findings: [{ file: 'a', firstLine: 1, comment: 'x', severity: 'nit' }] })
    ).toEqual({})
  })
})
