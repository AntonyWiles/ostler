import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { initProjectRepository } from '../helpers/harness'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

// Each test makes a real task copy (a Git worktree), commits in it and applies a review
// state: some twenty Git processes. About 1.5 s alone, but Windows starts processes
// slowly while other suites hold every core, and the 5 s default ran out there with
// no assertion failing. The work is the test, so it gets the time.
describe('Ostler harness workflow', { timeout: 30_000 }, () => {
  const root = useTempDir('ostler-harness-workflow-')
  let project: WatchedProject
  let database: EventDatabase

  beforeEach(async () => {
    const projectPath = path.join(root(), 'project')
    fs.mkdirSync(path.join(projectPath, 'src'), { recursive: true })
    fs.writeFileSync(path.join(projectPath, 'src', 'index.ts'), 'before\n')
    await initProjectRepository(projectPath)
    project = makeWatchedProject({
      id: 'workflow-project',
      name: 'Workflow project',
      path: projectPath,
      addedAt: Date.now()
    })
    database = new EventDatabase(await createMigratedDatabase(root()))
  })

  afterEach(() => {
    database.close()
  })

  it('records a queued task and a filed report, and links both to the planning work item (P5.2)', async () => {
    const service = new HarnessService(path.join(root(), 'ostler-data'), database)
    const task = service.addTask(project, 'Linked work', 'Details', 'task-p52', 'medium', 'item-1')
    // Adding the same task again is not a second queueing.
    service.addTask(project, 'Linked work', 'Details', 'task-p52', 'medium', 'item-1')
    const session = await service.startSessionForTask(project, task.id)
    service.updateSession(project, session.id, 'Finished', true, {
      filesChanged: ['src/index.ts'],
      summary: 'Did it',
      submittedAt: new Date().toISOString()
    })

    const events = database
      .getHarnessEvents(project.id, 50)
      .map((event) => [event.event_type, event.details])
    expect(events.filter(([type]) => type === 'task_queued')).toEqual([
      ['task_queued', 'queued task task-p52']
    ])
    expect(events.filter(([type]) => type === 'task_report_submitted')).toEqual([
      ['task_report_submitted', 'Submitted a report for task task-p52']
    ])
    const links = service.activityLinks(project)
    expect(links.taskWorkItems.get('task-p52')).toBe('item-1')
    expect(links.sessions.get(session.id)?.taskIds).toContain('task-p52')
  })

  it('persists the queue and a finished session across a restart', async () => {
    const dataRoot = path.join(root(), 'ostler-data')
    const service = new HarnessService(dataRoot, database)
    const task = service.addTask(project, 'Implement feature', 'Use the shared control board')
    const session = await service.startSessionForTask(project, task.id)
    fs.writeFileSync(path.join(session.workspace!.worktreePath, 'src', 'index.ts'), 'after\n')
    await service.completeSessionWithAutoContinuation(project, session.id, 'Finished', task.id)

    const reloaded = new HarnessService(dataRoot, database).getState(project)
    expect(reloaded.activeSessions).toHaveLength(0)
    expect(reloaded.taskQueue[0].status).toBe('complete')
    expect(reloaded.reviewSessions.map((item) => item.id)).toEqual([session.id])
    // Nothing reaches the project folder until the person applies it.
    expect(fs.readFileSync(path.join(project.path!, 'src', 'index.ts'), 'utf8')).toBe('before\n')
    expect(database.getHarnessEvents(project.id, 20).length).toBeGreaterThanOrEqual(3)
  })
})
