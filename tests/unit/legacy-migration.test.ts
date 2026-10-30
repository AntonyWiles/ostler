import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import simpleGit from 'simple-git'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { LegacyAgentMigration } from '../../electron/services/harness/legacy-migration'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { initProjectRepository } from '../helpers/harness'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

/**
 * The once-per-project move from the old agent setup (simplify pass §6): a
 * private control clone with slot workspaces becomes `ostler/*` versions and
 * copies in the person's own repository, with nothing lost.
 */
describe('LegacyAgentMigration', () => {
  const root = useTempDir('ostler-legacy-')
  let dataDir: string
  let folder: string
  let projectDir: string
  let control: string
  let project: WatchedProject
  let database: EventDatabase

  const read = (file: string) => fs.readFileSync(file, 'utf8')

  /** An old-setup workspace: a worktree of control on `nexus/session/<id>` with one saved change. */
  async function oldWorkspace(sessionId: string, slot: string, file: string, content: string) {
    const worktreePath = path.join(projectDir, 'workspaces', slot)
    await simpleGit(control).raw([
      'worktree',
      'add',
      '-b',
      `nexus/session/${sessionId}`,
      worktreePath,
      'nexus/control'
    ])
    fs.writeFileSync(path.join(worktreePath, file), content)
    const git = simpleGit(worktreePath)
    await git.add('.')
    await git.commit(`agent change for ${sessionId}`)
    return {
      branchName: `nexus/session/${sessionId}`,
      worktreePath,
      baseBranch: 'nexus/control',
      baseCommit: (await simpleGit(control).raw(['rev-parse', 'nexus/control'])).trim(),
      slotId: slot
    }
  }

  function session(
    id: string,
    title: string,
    status: 'active' | 'done',
    taskId: string,
    workspace: unknown
  ) {
    const now = new Date().toISOString()
    return {
      id,
      title,
      overview: '',
      startedAt: now,
      lastUpdate: now,
      statusNote: '',
      status,
      assignedTaskId: null,
      taskId,
      workspace,
      token: `token-${id}`,
      lastSeenAt: null,
      provenance: 'external'
    }
  }

  function task(id: string, title: string, status: 'claimed' | 'complete', claimedBy: string) {
    return {
      id,
      title,
      details: '',
      status,
      claimedBy,
      priority: 'medium',
      planningWorkItemId: null,
      autoContinue: false,
      hold: false
    }
  }

  beforeEach(async () => {
    dataDir = path.join(root(), 'data')
    folder = path.join(root(), 'project')
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'a.txt'), 'a\n')
    fs.writeFileSync(path.join(folder, 'b.txt'), 'b\n')
    fs.writeFileSync(path.join(folder, 'c.txt'), 'c\n')
    await initProjectRepository(folder)
    project = makeWatchedProject({
      id: 'legacy-project',
      name: 'Legacy project',
      path: folder,
      color: '#fff'
    })

    // The old setup: a private clone of the folder on nexus/control.
    projectDir = path.join(
      dataDir,
      'harness',
      createHash('sha256').update(project.id).digest('hex')
    )
    control = path.join(projectDir, 'control')
    fs.mkdirSync(projectDir, { recursive: true })
    await simpleGit().clone(folder, control, ['--config', 'core.autocrlf=false'])
    const controlGit = simpleGit(control)
    await controlGit.addConfig('user.email', 'ostler@example.com')
    await controlGit.addConfig('user.name', 'Ostler')
    await controlGit.raw(['checkout', '-b', 'nexus/control'])
    // Work merged on control that the folder never received.
    fs.writeFileSync(path.join(control, 'c.txt'), 'merged earlier\n')
    await controlGit.add('c.txt')
    await controlGit.commit('merged agent work')

    const running = await oldWorkspace('running-1', 'slot-1', 'a.txt', 'running work\n')
    const review = await oldWorkspace('review-1', 'slot-2', 'b.txt', 'reviewed work\n')
    // Unsaved leftovers in the running workspace are kept too.
    fs.writeFileSync(path.join(running.worktreePath, 'a.txt'), 'running work, unsaved\n')

    fs.writeFileSync(
      path.join(projectDir, 'state.json'),
      JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        sessions: [
          session('running-1', 'Running task', 'active', 'task-run', running),
          session('review-1', 'Review task', 'done', 'task-review', review)
        ],
        tasks: [
          task('task-run', 'Running task', 'claimed', 'running-1'),
          task('task-review', 'Review task', 'complete', 'review-1')
        ],
        questions: [],
        guidance: [],
        watcherRunning: false,
        workspaceSlots: [
          { slotId: 'slot-1', worktreePath: running.worktreePath, sessionId: 'running-1' },
          { slotId: 'slot-2', worktreePath: review.worktreePath, sessionId: 'review-1' }
        ]
      })
    )
    database = new EventDatabase(await createMigratedDatabase(root()))
  })

  afterEach(() => {
    database.close()
  })

  it('moves running, waiting and merged agent work into the folder without changing a file', async () => {
    const migration = new LegacyAgentMigration(
      dataDir,
      () => [project],
      () => {}
    )
    expect(migration.needsMigration(project.id)).toBe(true)

    await migration.migrateProject(project)

    // No file in the folder changed: the work arrived as versions only.
    expect(read(path.join(folder, 'a.txt'))).toBe('a\n')
    expect(read(path.join(folder, 'b.txt'))).toBe('b\n')
    expect(read(path.join(folder, 'c.txt'))).toBe('c\n')
    const branches = (await simpleGit(folder).branchLocal()).all
    expect(branches.some((name) => /^ostler\/.*earlier-agent-work$/.test(name))).toBe(true)
    expect(branches.filter((name) => name.startsWith('ostler/')).length).toBe(3)

    // The old folders moved aside, with a backup of the state first.
    expect(fs.existsSync(control)).toBe(false)
    expect(fs.existsSync(path.join(projectDir, 'workspaces'))).toBe(false)
    const legacy = path.join(dataDir, 'legacy', project.id)
    const [dated] = fs.readdirSync(legacy)
    expect(fs.existsSync(path.join(legacy, dated, 'control'))).toBe(true)
    expect(
      fs
        .readdirSync(path.join(dataDir, 'backups'))
        .some((name) => name.startsWith('pre-migration-agent-state-'))
    ).toBe(true)
    expect(migration.needsMigration(project.id)).toBe(false)
    expect(migration.attentionNeeded(project.id)).toBeNull()

    const harness = new HarnessService(dataDir, database)
    harness.setHistoryOptions(() => ({ retentionDays: 30, saveMyEdits: true }))
    const state = harness.getState(project)

    // The running session stopped; its task is back in the queue with the work, unsaved edits included.
    expect(state.activeSessions).toEqual([])
    const queued = state.taskQueue.find((item) => item.id === 'task-run')!
    expect(queued).toMatchObject({ status: 'pending', claimedBy: null })
    expect(queued.copy).toMatchObject({ state: 'ready', hasWork: true })
    expect(read(path.join(queued.copy!.worktreePath, 'a.txt'))).toBe('running work, unsaved\n')

    // The waiting session and the earlier merged work are up for review, and apply the new way.
    const titles = state.reviewSessions.map((item) => item.title)
    expect(titles).toEqual(
      expect.arrayContaining(['Review task', 'Agent work from before the update'])
    )
    const review = state.reviewSessions.find((item) => item.id === 'review-1')!
    await harness.applyTaskWork(project, review.id)
    expect(read(path.join(folder, 'b.txt'))).toBe('reviewed work\n')
    const earlier = state.reviewSessions.find(
      (item) => item.title === 'Agent work from before the update'
    )!
    await harness.applyTaskWork(project, earlier.id)
    expect(read(path.join(folder, 'c.txt'))).toBe('merged earlier\n')
    harness.stopAll()
  }, 60_000)

  it('leaves the old folders as they were and asks for attention when a step fails', async () => {
    // A folder on no version cannot take the rescued work.
    const head = (await simpleGit(folder).raw(['rev-parse', 'HEAD'])).trim()
    await simpleGit(folder).raw(['checkout', '--detach', head])
    const migration = new LegacyAgentMigration(
      dataDir,
      () => [project],
      () => {}
    )

    await migration.migrateAll()

    expect(fs.existsSync(path.join(control, '.git'))).toBe(true)
    expect(fs.existsSync(path.join(projectDir, 'workspaces', 'slot-1'))).toBe(true)
    expect(migration.attentionNeeded(project.id)).toMatch(/detached/)

    // Try again, once the folder is back on a version, finishes the move.
    await simpleGit(folder).raw(['checkout', 'main'])
    await migration.migrateProject(project)
    expect(migration.attentionNeeded(project.id)).toBeNull()
    expect(fs.existsSync(control)).toBe(false)
  }, 60_000)
})
