import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { buildHelp } from '../../electron/services/harness-http-server'
import { buildTaskPrompt } from '../../electron/services/opencode-runner-service'
import { generateOstlerAgentInstructionsMd } from '../../electron/services/opencode/ostler-plugin-template'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { PLAN_FIRST_AVAILABLE } from '../../src/shared/plan-first'
import { createMigratedDatabase } from '../helpers/database'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

// N9.3b turned plans on; this file keeps checking the hidden state the
// constant still guards, so it turns the constant off.
vi.mock('../../src/shared/plan-first', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/shared/plan-first')>()),
  PLAN_FIRST_AVAILABLE: false
}))

/**
 * Plan first (N9.3a) as it ships until N9.3b: hidden. Nothing tells agents
 * about plans, and nothing can make a task plan-first.
 */
describe('plan first, while plans are unavailable', () => {
  const tempDir = useTempDir('ostler-plan-first-off-')
  let database: EventDatabase
  let service: HarnessService
  let project: WatchedProject

  beforeEach(async () => {
    database = new EventDatabase(await createMigratedDatabase(tempDir()))
    service = new HarnessService(path.join(tempDir(), 'data'), database)
    project = makeWatchedProject({
      id: 'project-1',
      name: 'Test project',
      color: '#fff',
      addedAt: Date.now()
    }) as unknown as WatchedProject
  })

  afterEach(() => {
    service.stopAll()
    database.close()
  })

  it('is off', () => {
    expect(PLAN_FIRST_AVAILABLE).toBe(false)
  })

  it('the standing instructions, the opening prompt and the help do not mention plans', () => {
    const instructions = generateOstlerAgentInstructionsMd('C:/slot', 'main', 'abc')
    expect(instructions).not.toMatch(/plan first|ostler_submit_plan/i)

    // Even a task carrying the flag (from a later version's state) is not told to plan.
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
    expect(prompt).not.toContain('ostler_submit_plan')
    expect(prompt).toContain('Start now.')

    const help = buildHelp(project.id) as { instructions: string; routes: { path: string }[] }
    expect(help.routes.map((route) => route.path)).not.toContain('/session/:sessionId/plan')
    expect(help.instructions).not.toMatch(/plan first|plan\.decided|plan\.submitted/i)
  })

  it('nothing can make a task plan-first', () => {
    const task = service.addTask(project, 'Task', '')
    expect(() => service.setTaskPlanFirst(project, task.id, true)).toThrow(/not available/)
    expect(service.getState(project).taskQueue[0].planFirst).toBeUndefined()
  })
})
