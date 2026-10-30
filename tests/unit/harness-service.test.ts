import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import simpleGit from 'simple-git'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService, parseWorktreeListing } from '../../electron/services/harness-service'
import { isOstlerTaskBranch } from '../../electron/services/harness/task-copies'
import type { HarnessSession, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { makeWatchedProject } from '../helpers/projects'

/**
 * The harness after the simplify pass: each task's agent works in its own copy
 * of the person's repository, and work reaches the project folder only on
 * Apply, as one entry in the folder's history that can be undone.
 */

const read = (file: string) => fs.readFileSync(file, 'utf8')

async function makeRepository(projectDir: string): Promise<void> {
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(projectDir, 'src', 'app.ts'), 'original\n')
  fs.writeFileSync(path.join(projectDir, 'src', 'other.ts'), 'other\n')
  const git = simpleGit(projectDir)
  await git.init()
  await git.addConfig('user.email', 'test@example.com')
  await git.addConfig('user.name', 'Test')
  await git.addConfig('core.autocrlf', 'false')
  await git.raw(['checkout', '-B', 'main'])
  await git.add('.')
  await git.commit('initial commit')
}

function makeProject(id: string, projectDir: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: 'Test project',
    path: projectDir,
    color: '#fff',
    addedAt: Date.now()
  })
}

describe('harness-service.ts queue', { timeout: 30_000 }, () => {
  let tempDir: string
  let projectDir: string
  let database: EventDatabase
  let service: HarnessService
  let project: WatchedProject

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-harness-'))
    projectDir = path.join(tempDir, 'project')
    await makeRepository(projectDir)
    database = new EventDatabase(await createMigratedDatabase(tempDir))
    service = new HarnessService(path.join(tempDir, 'data'), database)
    project = makeProject('project-1', projectDir)
  })

  afterEach(() => {
    service.stopAll()
    database.close()
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  it('stores coordination state outside the watched project', async () => {
    const task = service.addTask(project, 'Review app', 'Check the current behavior')
    const session = await service.startSessionForTask(project, task.id)

    const state = service.getState(project)
    expect(state.hasHarness).toBe(true)
    expect(state.activeSessions[0].id).toBe(session.id)
    expect(state.taskQueue[0]).toMatchObject({ status: 'claimed', claimedBy: session.id })
    expect(fs.existsSync(path.join(projectDir, '.agent-harness'))).toBe(false)
    expect(fs.existsSync(path.join(tempDir, 'data', 'harness'))).toBe(true)
  })

  it('gives each session its own password, and no project-wide one', async () => {
    const task = service.addTask(project, 'Only task', '')
    const session = await service.startSessionForTask(project, task.id)

    expect(service.resolveToken(project, session.token)).toMatchObject({
      valid: true,
      sessionId: session.id
    })
    expect(service.resolveToken(project, 'not-a-password').valid).toBe(false)
  })

  it('atomically continues the same session and password onto the next auto task', async () => {
    const first = service.addTask(project, 'First task', 'Finish this first')
    const next = service.addTask(
      project,
      'Next task',
      'Continue here',
      undefined,
      'medium',
      null,
      true
    )
    const session = await service.startSessionForTask(project, first.id)
    service.touchSessionConnection(project, session.id)

    const result = await service.completeSessionWithAutoContinuation(
      project,
      session.id,
      'First complete',
      first.id
    )

    expect(result.session).toMatchObject({ id: session.id, token: session.token, status: 'active' })
    expect(result.nextTask).toMatchObject({ id: next.id, status: 'claimed', claimedBy: session.id })
    expect(service.resolveToken(project, session.token).valid).toBe(true)
    expect(service.getState(project).taskQueue.find((task) => task.id === first.id)?.status).toBe(
      'complete'
    )
  })

  it('ends the session normally when no auto task is waiting', async () => {
    const task = service.addTask(project, 'Only task', '')
    const session = await service.startSessionForTask(project, task.id)
    service.touchSessionConnection(project, session.id)
    const result = await service.completeSessionWithAutoContinuation(
      project,
      session.id,
      'Done',
      task.id
    )
    expect(result.nextTask).toBeNull()
    expect(result.session.status).toBe('done')
    expect(service.resolveToken(project, session.token).valid).toBe(false)
  })

  it('idempotently reuses a caller-chosen task identifier', () => {
    const first = service.addTask(project, 'Planning handoff', 'Approved scope', 'planning-task-id')
    const retried = service.addTask(
      project,
      'Planning handoff',
      'Approved scope',
      'planning-task-id'
    )

    expect(retried).toEqual(first)
    expect(service.getState(project).taskQueue).toHaveLength(1)
    expect(() => service.addTask(project, 'Different scope', '', 'planning-task-id')).toThrow(
      'Harness task identifier is already in use'
    )
  })

  it('cancels queued work and preserves its planning origin', async () => {
    const queued = service.addTask(
      project,
      'Cancel queued work',
      '',
      'planning-cancel-task',
      'high',
      'planning-work-item'
    )
    const cancelled = service.cancelTask(project, queued.id, 'planning-work-item')

    expect(cancelled).toMatchObject({
      status: 'cancelled',
      priority: 'high',
      planningWorkItemId: 'planning-work-item'
    })
    expect(() => service.setTaskPriority(project, queued.id, 'critical')).toThrow(
      'Cancelled task priority cannot be changed'
    )
  })

  it('updates task priority independently of who is working on it', async () => {
    const task = service.addTask(project, 'Adjust priority', '', undefined, 'low')
    const session = await service.startSessionForTask(project, task.id)

    expect(service.setTaskPriority(project, task.id, 'critical').priority).toBe('critical')
    expect(service.getState(project).taskQueue[0]).toMatchObject({
      status: 'claimed',
      claimedBy: session.id,
      priority: 'critical'
    })
  })

  it('refuses to start a second session for an already claimed task', async () => {
    const task = service.addTask(project, 'Queued work', 'Must remain single-owner')
    await service.startSessionForTask(project, task.id)

    await expect(service.startSessionForTask(project, task.id)).rejects.toThrow()
    expect(service.getState(project).activeSessions).toHaveLength(1)
  })

  it('persists the latest automated report in Ostler data', () => {
    const report = service.getReport(project)
    const reloaded = new HarnessService(path.join(tempDir, 'data'), database).getState(project)

    expect(report.generatedAt).toBeTruthy()
    expect(reloaded.automation?.lastReportAt).toBe(report.generatedAt)
    expect(reloaded.automation?.lastReportHealth).toBe(report.healthStatus)
  })

  it('blocks a session on a question and unblocks it once answered', async () => {
    const task = service.addTask(project, 'Ask first', '')
    const session = await service.startSessionForTask(project, task.id)
    const question = service.askQuestion(project, session.id, 'Which file should I change?')

    expect(service.getState(project).activeSessions[0].blocked).toBe(true)
    expect(service.getReport(project).alerts.map((alert) => alert.code)).toContain(
      'agent_question_pending'
    )

    const answered = service.answerQuestion(project, question.id, 'src/app.ts')
    expect(answered).toMatchObject({ status: 'answered', answer: 'src/app.ts' })
    expect(service.getState(project).activeSessions[0].blocked).toBe(false)
  })
})

describe('harness-service.ts copies, Apply and History', { timeout: 30_000 }, () => {
  let tempDir: string
  let projectDir: string
  let dataDir: string
  let database: EventDatabase
  let service: HarnessService
  let project: WatchedProject

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-harness-copies-'))
    projectDir = path.join(tempDir, 'project')
    dataDir = path.join(tempDir, 'data')
    await makeRepository(projectDir)
    database = new EventDatabase(await createMigratedDatabase(tempDir))
    service = new HarnessService(dataDir, database)
    service.setHistoryOptions(() => ({ retentionDays: 30, saveMyEdits: true }))
    project = makeProject('copies-project', projectDir)
  })

  afterEach(() => {
    service.stopAll()
    database.close()
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  /** Runs a task to "ready for review": the agent edits `file` in its copy and finishes. */
  const runTask = async (title: string, file: string, content: string): Promise<HarnessSession> => {
    const task = service.addTask(project, title, '')
    const session = await service.startSessionForTask(project, task.id)
    const copy = session.workspace!.worktreePath
    fs.writeFileSync(path.join(copy, file), content)
    await service.completeSessionWithAutoContinuation(project, session.id, 'Done', task.id)
    return session
  }

  it("makes each task's copy a worktree of the person's repository on its own ostler version", async () => {
    const task = service.addTask(project, 'Fix the launch flow', '')
    await service.prepareCopies(project, 1)

    const copy = service.getState(project).taskQueue[0].copy
    expect(copy).toMatchObject({ state: 'ready', baseBranch: 'main' })
    expect(isOstlerTaskBranch(copy!.branchName)).toBe(true)
    expect(copy!.worktreePath.startsWith(service.copiesRoot(project.id))).toBe(true)
    expect(read(path.join(copy!.worktreePath, 'src', 'app.ts'))).toBe('original\n')

    const listed = parseWorktreeListing(
      await simpleGit(projectDir).raw(['worktree', 'list', '--porcelain'])
    )
    expect(listed.map((entry) => entry.branchName)).toContain(copy!.branchName)

    const session = await service.startSessionForTask(project, task.id)
    expect(session.workspace?.worktreePath).toBe(copy!.worktreePath)
    expect(service.getState(project).taskQueue[0].copy).toBeUndefined()
  })

  it('refuses the review verdicts while the agent is still working in its copy', async () => {
    const task = service.addTask(project, 'Still going', '')
    const session = await service.startSessionForTask(project, task.id)
    fs.writeFileSync(path.join(session.workspace!.worktreePath, 'wip.txt'), 'half done\n')

    await expect(service.applyTaskWork(project, session.id)).rejects.toThrow(/still working/)
    await expect(service.discardTaskWork(project, session.id)).rejects.toThrow(/still working/)
    await expect(
      service.sendBackTaskWork(project, session.id, 'Wrong file', 'retry')
    ).rejects.toThrow(/still working/)
    expect(read(path.join(session.workspace!.worktreePath, 'wip.txt'))).toBe('half done\n')
    expect(service.getState(project).activeSessions.map((item) => item.id)).toEqual([session.id])
  })

  it("isolates an agent's edits from the project folder until Apply", async () => {
    const session = await runTask('Change app', 'src/app.ts', 'agent edit\n')

    expect(read(path.join(projectDir, 'src', 'app.ts'))).toBe('original\n')
    const diff = await service.getSessionDiff(project, session.id)
    expect(diff.files.map((file) => file.path)).toContain('src/app.ts')
    expect(diff.versionChanged).toBe(false)

    const result = await service.applyTaskWork(project, session.id)
    expect(result.outcome).toBe('applied')
    expect(read(path.join(projectDir, 'src', 'app.ts'))).toBe('agent edit\n')
    expect(service.getState(project).reviewSessions).toHaveLength(0)
  })

  it("reads a task's changes without failing when Apply removes its copy mid-read", async () => {
    const session = await runTask('Change app', 'src/app.ts', 'agent edit\n')
    const { worktreePath, branchName } = session.workspace!

    // The copy is still there when the read starts; Apply removes it (folder
    // link and version) before the read reaches Git.
    const reading = service.getSessionDiff(project, session.id)
    fs.rmSync(path.join(worktreePath, '.git'), { force: true })
    const git = simpleGit(projectDir)
    await git.raw(['worktree', 'prune'])
    await git.raw(['branch', '-D', branchName])

    const diff = await reading
    expect(diff).toMatchObject({
      filesChanged: 0,
      hasUncommittedChanges: false,
      mergeReadiness: 'no_changes'
    })
  })

  it("reads a task's changes from its version when its copy folder is gone mid-read", async () => {
    const other = await runTask('Change other', 'src/other.ts', 'other agent edit\n')
    const { worktreePath } = other.workspace!
    await simpleGit(worktreePath).raw(['add', '-A'])
    await simpleGit(worktreePath).raw([
      '-c',
      'user.name=T',
      '-c',
      'user.email=t@t',
      'commit',
      '-m',
      'work'
    ])

    const reading = service.getSessionDiff(project, other.id)
    fs.rmSync(path.join(worktreePath, '.git'), { force: true })

    const diff = await reading
    expect(diff.files.map((file) => file.path)).toEqual(['src/other.ts'])
  })

  it('closes a task that changed nothing without adding an entry', async () => {
    const task = service.addTask(project, 'Look only', '')
    const session = await service.startSessionForTask(project, task.id)
    await service.completeSessionWithAutoContinuation(project, session.id, 'Nothing to do', task.id)

    const result = await service.applyTaskWork(project, session.id)
    expect(result).toMatchObject({ outcome: 'nothing_changed', entries: 0 })
  })

  it('saves the person\'s own edits as "Your edits" before applying', async () => {
    const session = await runTask('Change app', 'src/app.ts', 'agent edit\n')
    fs.writeFileSync(path.join(projectDir, 'src', 'other.ts'), 'my edit\n')

    await service.applyTaskWork(project, session.id)

    expect(read(path.join(projectDir, 'src', 'other.ts'))).toBe('my edit\n')
    const history = await service.getProjectHistory(project)
    const kinds = history.entries.map((entry) => entry.kind)
    expect(kinds).toContain('your-edits')
    expect(kinds).toContain('task')
  })

  it('undoes one task, leaves the others, and undoes the undo', async () => {
    const first = await runTask('Change app', 'src/app.ts', 'agent edit\n')
    await service.applyTaskWork(project, first.id)
    const second = await runTask('Change other', 'src/other.ts', 'other agent edit\n')
    await service.applyTaskWork(project, second.id)

    let history = await service.getProjectHistory(project)
    const firstEntry = history.entries.find((entry) => entry.title.includes('Change app'))!
    expect(firstEntry.kind).toBe('task')

    const undo = await service.undoHistoryEntries(project, [firstEntry.id])
    expect(undo.undone).toBe(true)
    expect(read(path.join(projectDir, 'src', 'app.ts'))).toBe('original\n')
    expect(read(path.join(projectDir, 'src', 'other.ts'))).toBe('other agent edit\n')
    expect(undo.entry!.title).toBe('Undo of "Change app"')
    history = await service.getProjectHistory(project)
    expect(history.entries.find((entry) => entry.id === firstEntry.id)?.undone).toBe(true)

    const redo = await service.undoHistoryEntries(project, [undo.entry!.id])
    expect(redo.undone).toBe(true)
    expect(read(path.join(projectDir, 'src', 'app.ts'))).toBe('agent edit\n')
    expect(redo.entry!.title).toBe('Put back "Change app"')
    history = await service.getProjectHistory(project)
    expect(history.entries.find((entry) => entry.id === firstEntry.id)?.undone).toBe(false)
    expect(history.entries.find((entry) => entry.id === undo.entry!.id)?.undone).toBe(true)

    history = await service.getProjectHistory(project, { kind: 'undo' })
    expect(history.entries.length).toBeGreaterThanOrEqual(2)
  })

  it('names the later task that changed the same lines instead of undoing over it', async () => {
    const first = await runTask('First edit', 'src/app.ts', 'first\n')
    await service.applyTaskWork(project, first.id)
    const second = await runTask('Second edit', 'src/app.ts', 'second\n')
    await service.applyTaskWork(project, second.id)

    const history = await service.getProjectHistory(project)
    const firstEntry = history.entries.find((entry) => entry.title.includes('First edit'))!
    const result = await service.undoHistoryEntries(project, [firstEntry.id])

    expect(result.undone).toBe(false)
    expect(result.laterEntries.map((entry) => entry.title).join()).toContain('Second edit')
    expect(read(path.join(projectDir, 'src', 'app.ts'))).toBe('second\n')

    const both = await service.undoHistoryEntries(project, [
      firstEntry.id,
      ...result.laterEntries.map((entry) => entry.id)
    ])
    expect(both.undone).toBe(true)
    expect(read(path.join(projectDir, 'src', 'app.ts'))).toBe('original\n')
  })

  it('restores the folder to an entry as a new entry', async () => {
    const before = await service.getProjectHistory(project)
    const start = before.entries[before.entries.length - 1]
    const session = await runTask('Change app', 'src/app.ts', 'agent edit\n')
    await service.applyTaskWork(project, session.id)

    const restored = await service.restoreToHistoryEntry(project, start.id)
    expect(restored.kind).toBe('restore')
    expect(read(path.join(projectDir, 'src', 'app.ts'))).toBe('original\n')

    const undo = await service.undoHistoryEntries(project, [restored.id])
    expect(undo.undone).toBe(true)
    expect(read(path.join(projectDir, 'src', 'app.ts'))).toBe('agent edit\n')
  })

  it('discards work but keeps it to bring back', async () => {
    const session = await runTask('Maybe later', 'src/app.ts', 'kept edit\n')

    await service.discardTaskWork(project, session.id)
    expect(service.getState(project).reviewSessions).toHaveLength(0)
    expect(fs.existsSync(session.workspace!.worktreePath)).toBe(false)
    const history = await service.getProjectHistory(project)
    expect(history.discarded.map((work) => work.sessionId)).toContain(session.id)

    await service.bringBackTaskWork(project, session.id)
    const review = service.getState(project).reviewSessions
    expect(review.map((item) => item.id)).toContain(session.id)
    const back = review.find((item) => item.id === session.id)!
    expect(read(path.join(back.workspace!.worktreePath, 'src', 'app.ts'))).toBe('kept edit\n')

    await service.applyTaskWork(project, session.id)
    expect(read(path.join(projectDir, 'src', 'app.ts'))).toBe('kept edit\n')
  })

  it('brings work back after the queue made the task a fresh copy', async () => {
    const session = await runTask('Second thoughts', 'src/app.ts', 'kept edit\n')
    await service.discardTaskWork(project, session.id)
    // The task is back in the queue, and the queue makes it a copy on the same version.
    await service.prepareCopies(project, 5)
    const fresh = service.getState(project).taskQueue.find((item) => item.id === session.taskId)!
    expect(fresh.copy).toMatchObject({ state: 'ready', hasWork: false })
    expect(fresh.copy!.branchName).toBe(session.workspace!.branchName)

    await service.bringBackTaskWork(project, session.id)

    const state = service.getState(project)
    const back = state.reviewSessions.find((item) => item.id === session.id)!
    expect(read(path.join(back.workspace!.worktreePath, 'src', 'app.ts'))).toBe('kept edit\n')
    expect(state.taskQueue.find((item) => item.id === session.taskId)?.copy).toBeUndefined()
  })

  it('stops a running agent, keeps its work and puts the task back in the queue', async () => {
    const task = service.addTask(project, 'Stop me', '')
    const session = await service.startSessionForTask(project, task.id)
    fs.writeFileSync(path.join(session.workspace!.worktreePath, 'src', 'app.ts'), 'half done\n')

    await service.stopSession(project, session.id)

    const state = service.getState(project)
    expect(state.activeSessions).toHaveLength(0)
    expect(state.taskQueue.find((item) => item.id === task.id)?.status).toBe('pending')
    expect(read(path.join(projectDir, 'src', 'app.ts'))).toBe('original\n')
  })

  it('sends work back to its agent in the same copy', async () => {
    const session = await runTask('Try again', 'src/app.ts', 'not quite\n')

    await service.sendBackTaskWork(project, session.id, 'Use the other file', 'retry')

    const task = service.getState(project).taskQueue.find((item) => item.title === 'Try again')!
    expect(task.status).toBe('pending')
    expect(task.copy?.worktreePath).toBe(session.workspace!.worktreePath)
    expect(read(path.join(task.copy!.worktreePath, 'src', 'app.ts'))).toBe('not quite\n')
  })

  it('keeps draft line comments with the session, and Send back carries them with excerpts', async () => {
    const session = await runTask('Comment me', 'src/app.ts', 'not quite\n')
    const draft = {
      id: 'draft-1',
      file: 'src/app.ts',
      side: 'new' as const,
      firstLine: 1,
      lastLine: 1,
      comment: 'This line is backwards'
    }
    service.saveReviewDrafts(project, session.id, [draft])
    const reviewing = () =>
      service.getState(project).reviewSessions.find((item) => item.id === session.id)
    expect(reviewing()?.reviewDrafts).toEqual([draft])

    // An empty reason is fine with comments: they say what was wrong.
    await service.sendBackTaskWork(project, session.id, '', 'retry')

    const task = service.getState(project).taskQueue.find((item) => item.title === 'Comment me')!
    const rejection = task.rejections!.at(-1)!
    expect(rejection.reason).toBe('See the line comments')
    expect(rejection.comments).toEqual([
      { ...draft, excerpt: ['@@ -1 +1 @@', '-original', '+not quite'].join('\n') }
    ])
    expect(task.details).toContain('[Sent back 1] See the line comments (1 line comment)')
    // The drafts went with the session.
    const stored = service
      .getState(project)
      .reviewSessions.concat(service.getState(project).activeSessions)
      .find((item) => item.id === session.id)
    expect(stored?.reviewDrafts).toBeUndefined()
  })

  it('refuses an empty reason without comments, and comments on lines the change does not show', async () => {
    const session = await runTask('No reason', 'src/app.ts', 'changed\n')
    await expect(service.sendBackTaskWork(project, session.id, '  ', 'retry')).rejects.toThrow()
    await expect(
      service.sendBackTaskWork(project, session.id, '', 'retry', undefined, [
        { file: 'src/app.ts', firstLine: 30, comment: 'Not here' }
      ])
    ).rejects.toThrow(/does not show/)
  })

  it('drops draft line comments when the work is applied', async () => {
    const session = await runTask('Apply me', 'src/app.ts', 'good\n')
    service.saveReviewDrafts(project, session.id, [
      { id: 'd', file: 'src/app.ts', side: 'new', firstLine: 1, lastLine: 1, comment: 'nit' }
    ])
    await service.applyTaskWork(project, session.id)
    const state = service.getState(project)
    expect(
      [...state.reviewSessions, ...state.activeSessions].some((item) => item.reviewDrafts)
    ).toBe(false)
  })

  it('applies work its agent brought up to date after a clash, and keeps the note for it', async () => {
    const first = await runTask('Header A', 'src/app.ts', 'from A\n')
    const second = await runTask('Header B', 'src/app.ts', 'from B\n')
    await service.applyTaskWork(project, first.id)

    // The same line changed in the folder meanwhile: the task goes back to its agent.
    const clash = await service.applyTaskWork(project, second.id)
    expect(clash.outcome).toBe('sent_back')
    // The clash leaves no half-finished merge behind in the copy.
    expect(
      fs.existsSync(
        path.join(
          projectDir,
          '.git',
          'worktrees',
          path.basename(second.workspace!.worktreePath),
          'MERGE_HEAD'
        )
      )
    ).toBe(false)
    expect((await simpleGit(second.workspace!.worktreePath).status()).isClean()).toBe(true)
    const queued = () =>
      service.getState(project).taskQueue.find((item) => item.title === 'Header B')!
    expect(queued().details).toContain('bring your work up to date')

    // Re-copying the work item's text keeps the reason it was sent back for.
    service.syncPendingTaskText(project, queued().id, 'Header B', 'The header, from the work item')
    expect(queued().details).toContain('The header, from the work item')
    expect(queued().details).toContain('[Sent back 1]')
    expect(queued().details).toContain('bring your work up to date')

    // The agent brings its work up to date in the same copy, settling the clash.
    const again = await service.startSessionForTask(project, queued().id)
    const copy = again.workspace!.worktreePath
    expect(copy).toBe(second.workspace!.worktreePath)
    const folderHead = (await simpleGit(projectDir).raw(['rev-parse', 'HEAD'])).trim()
    const copyGit = simpleGit(copy)
    await copyGit.raw(['merge', '--no-edit', folderHead]).catch(() => undefined)
    fs.writeFileSync(path.join(copy, 'src', 'app.ts'), 'from A and B\n')
    await copyGit.add('.')
    await copyGit.commit('Bring the header up to date')
    await service.completeSessionWithAutoContinuation(project, again.id, 'Done', queued().id)

    const result = await service.applyTaskWork(project, again.id)
    expect(result.outcome).toBe('applied')
    expect(read(path.join(projectDir, 'src', 'app.ts'))).toBe('from A and B\n')
  })

  it('asks before applying when the folder switched versions mid-task', async () => {
    const task = service.addTask(project, 'On main', '')
    const session = await service.startSessionForTask(project, task.id)
    fs.writeFileSync(path.join(session.workspace!.worktreePath, 'src', 'app.ts'), 'agent edit\n')
    await service.completeSessionWithAutoContinuation(project, session.id, 'Done', task.id)

    await simpleGit(projectDir).raw(['checkout', '-b', 'feature'])
    expect(service.getState(project).folderVersion).toBe('feature')
    const diff = await service.getSessionDiff(project, session.id)
    expect(diff).toMatchObject({
      versionChanged: true,
      taskVersion: 'main',
      folderVersion: 'feature'
    })

    await expect(service.applyTaskWork(project, session.id)).rejects.toThrow()
    expect(read(path.join(projectDir, 'src', 'app.ts'))).toBe('original\n')

    const result = await service.applyTaskWork(project, session.id, true)
    expect(result.outcome).toBe('applied')
    expect(read(path.join(projectDir, 'src', 'app.ts'))).toBe('agent edit\n')
  })

  it('removes copies but keeps their versions when a project leaves', async () => {
    const session = await runTask('Leave it', 'src/app.ts', 'agent edit\n')

    const kept = await service.releaseProjectCopies(project)

    expect(kept).toContain(session.workspace!.branchName)
    expect(fs.existsSync(session.workspace!.worktreePath)).toBe(false)
    const branches = await simpleGit(projectDir).branchLocal()
    expect(branches.all).toContain(session.workspace!.branchName)
  })
})

describe('parseWorktreeListing', () => {
  it('reads paths and branches out of porcelain records', () => {
    const entries = parseWorktreeListing(
      [
        'worktree C:/my repo',
        'HEAD 3eb62ac',
        'branch refs/heads/master',
        '',
        'worktree C:/data/worktrees/abc/fix-login',
        'HEAD ce8b445',
        'branch refs/heads/ostler/fix-login',
        '',
        'worktree C:/data/detached',
        'HEAD aaaaaaa',
        'detached',
        ''
      ].join('\n')
    )

    expect(entries).toEqual([
      { worktreePath: 'C:/my repo', branchName: 'master' },
      { worktreePath: 'C:/data/worktrees/abc/fix-login', branchName: 'ostler/fix-login' },
      { worktreePath: 'C:/data/detached', branchName: null }
    ])
  })

  it('handles a final record with no trailing blank line', () => {
    const entries = parseWorktreeListing('worktree /repo\nHEAD abc\nbranch refs/heads/main')
    expect(entries).toEqual([{ worktreePath: '/repo', branchName: 'main' }])
  })

  it('returns nothing for empty output', () => {
    expect(parseWorktreeListing('')).toEqual([])
  })
})

describe('isOstlerTaskBranch', () => {
  it('recognizes only the versions Ostler makes for tasks', () => {
    expect(isOstlerTaskBranch('ostler/fix-login')).toBe(true)
    expect(isOstlerTaskBranch('master')).toBe(false)
    expect(isOstlerTaskBranch('feature/ostler/fix-login')).toBe(false)
    expect(isOstlerTaskBranch(null as unknown as string)).toBe(false)
  })
})
