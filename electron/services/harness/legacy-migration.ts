import * as fs from 'fs'
import * as path from 'path'
import { createHash, randomUUID } from 'crypto'
import simpleGit from 'simple-git'
import type {
  AgentStorageUsage,
  HarnessTaskCopy,
  HarnessWorkspace,
  WatchedProject
} from '@shared/ostler-api'
import { projectFolder } from '@shared/project-folder'
import { todayIsoDate } from '@shared/dates'
import { backupTimestamp } from '../database/backup-timestamp'
import { countKeptReferences, currentVersion, ensureRepository } from '../project-history'
import {
  commitCopyLeftovers,
  copyPathFor,
  excludeOstlerScratchPaths,
  folderSize,
  taskSlug
} from './task-copies'
import { generateSessionToken, type StoredHarnessState, type StoredSession } from './types'

/**
 * The once-per-project move from the agent setup before the simplify pass
 * (§6): a private clone of the folder ("control repository") under the data
 * folder, with agent workspaces inside it. Nothing is deleted without a copy
 * being kept:
 *
 * 1. the harness state files are backed up;
 * 2. live agent work is fetched into the person's own repository as
 *    `ostler/<task-slug>` (a reference only, no files change) and gets a new
 *    copy, so review and Apply work the new way;
 * 3. merged agent work the folder never received is fetched as
 *    `ostler/<date>-earlier-agent-work` and put up for review;
 * 4. only then are the old folders moved to `<dataDir>/legacy/<project-id>/<date>/`,
 *    for the person to remove from Settings › Data when they are happy.
 *
 * If a step fails, the old folders stay exactly as they were, the reason goes
 * to the log, and the project shows that the move needs attention, with Try
 * again.
 */

/** Folders and files the old setup kept per project, moved aside in step 4. */
const LEGACY_PROJECT_ENTRIES = [
  'control',
  'workspaces',
  'merge-reviews',
  'drift-checks',
  'human-reconciliation',
  'human-reconciliation.json',
  'snapshots',
  'recoveries',
  'control-repository.json',
  'origin-comparison.json'
]

const MARKER = 'legacy-migration.json'

interface MigrationMarker {
  status: 'done' | 'failed'
  at: string
  reason?: string
}

/** A session's workspace as the old setup stored it. */
interface LegacyWorkspace extends HarnessWorkspace {
  slotId?: string
}

interface RawState extends Omit<StoredHarnessState, 'sessions'> {
  sessions: (StoredSession & { workspace: LegacyWorkspace | null })[]
  workspaceSlots?: { slotId: string; sessionId: string | null }[]
}

export class LegacyAgentMigration {
  private readonly harnessRoot: string

  constructor(
    private readonly dataDir: string,
    private readonly getProjects: () => WatchedProject[],
    private readonly log: (message: string) => void = (message) => console.log(message)
  ) {
    this.harnessRoot = path.join(dataDir, 'harness')
  }

  private projectDir(projectId: string): string {
    return path.join(this.harnessRoot, createHash('sha256').update(projectId).digest('hex'))
  }

  private controlDir(projectId: string): string {
    return path.join(this.projectDir(projectId), 'control')
  }

  /** Whether a project still has the old setup's folders to move. */
  needsMigration(projectId: string): boolean {
    const dir = this.projectDir(projectId)
    return (
      LEGACY_PROJECT_ENTRIES.some((entry) => fs.existsSync(path.join(dir, entry))) ||
      fs.existsSync(path.join(this.harnessRoot, projectId, 'commit-policy'))
    )
  }

  /** The reason the move failed for a project, or null when there is nothing to attend to. */
  attentionNeeded(projectId: string): string | null {
    const marker = this.readMarker(projectId)
    return marker?.status === 'failed' && this.needsMigration(projectId)
      ? (marker.reason ?? 'unknown')
      : null
  }

  private readMarker(projectId: string): MigrationMarker | null {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(this.projectDir(projectId), MARKER), 'utf8')
      ) as MigrationMarker
    } catch {
      return null
    }
  }

  private writeMarker(projectId: string, marker: MigrationMarker): void {
    const dir = this.projectDir(projectId)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, MARKER), JSON.stringify(marker, null, 2), 'utf8')
  }

  /** Runs the move for every project that needs it. Called once at start-up. */
  async migrateAll(): Promise<void> {
    for (const project of this.getProjects()) {
      if (!this.needsMigration(project.id)) continue
      try {
        await this.migrateProject(project)
      } catch {
        // Recorded on the project by migrateProject; the others still move.
      }
    }
  }

  /** The move for one project (§6). Throws, after recording why, when it could not finish. */
  async migrateProject(project: WatchedProject): Promise<void> {
    if (!this.needsMigration(project.id)) return
    try {
      this.backUpState(project.id)
      const folder = projectFolder(project)
      const control = this.controlDir(project.id)
      const hasControl = fs.existsSync(path.join(control, '.git'))
      if (folder && hasControl) {
        await ensureRepository(folder)
        await this.rescueSessions(project, folder, control)
        await this.rescueUnexportedWork(project, folder, control)
      } else if (hasControl) {
        // No folder to rescue into: the work stays in the archived folders.
        this.log(
          `[LegacyAgentMigration] ${project.id}: no linked folder; earlier agent work is kept in the archived files`
        )
        this.closeLegacySessions(project.id)
      } else {
        this.closeLegacySessions(project.id)
      }
      this.archiveFolders(project.id)
      this.writeMarker(project.id, { status: 'done', at: new Date().toISOString() })
      this.log(`[LegacyAgentMigration] ${project.id}: moved to the new agent setup`)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.writeMarker(project.id, { status: 'failed', at: new Date().toISOString(), reason })
      console.error(`[LegacyAgentMigration] ${project.id}: the move needs attention: ${reason}`)
      throw error
    }
  }

  /** Step 1: the harness state files, next to the database's pre-migration backups. */
  private backUpState(projectId: string): void {
    const source = path.join(this.projectDir(projectId), 'state.json')
    if (!fs.existsSync(source)) return
    const target = path.join(
      this.dataDir,
      'backups',
      `pre-migration-agent-state-${backupTimestamp()}`,
      path.basename(this.projectDir(projectId))
    )
    fs.mkdirSync(target, { recursive: true })
    fs.copyFileSync(source, path.join(target, 'state.json'))
    for (const extra of ['control-repository.json', 'human-reconciliation.json']) {
      const file = path.join(this.projectDir(projectId), extra)
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(target, extra))
    }
  }

  private readRawState(projectId: string): RawState | null {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(this.projectDir(projectId), 'state.json'), 'utf8')
      ) as RawState
    } catch {
      return null
    }
  }

  private writeRawState(projectId: string, state: RawState): void {
    const file = path.join(this.projectDir(projectId), 'state.json')
    const temp = `${file}.${randomUUID()}.tmp`
    state.updatedAt = new Date().toISOString()
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), 'utf8')
    fs.renameSync(temp, file)
  }

  /** Old sessions with nothing to rescue: their workspaces no longer wait on anyone. */
  private closeLegacySessions(projectId: string): void {
    const state = this.readRawState(projectId)
    if (!state) return
    for (const session of state.sessions) {
      if (session.workspace?.branchName.startsWith('nexus/session/'))
        session.workspace.closed = true
      if (session.status !== 'done') {
        session.status = 'done'
        session.endedAs = 'stopped'
        session.statusNote = 'Stopped: Ostler moved to the new agent setup.'
      }
    }
    for (const task of state.tasks) {
      if (
        task.status === 'claimed' &&
        !state.sessions.some((s) => s.id === task.claimedBy && s.status !== 'done')
      ) {
        task.status = 'pending'
        task.claimedBy = null
      }
    }
    this.writeRawState(projectId, state)
  }

  /**
   * Step 2: every session with live work, running or waiting for review, gets
   * its work fetched into the person's repository and a new copy. A session
   * that was running ends, and its task goes back to the queue holding that
   * copy, so the next run carries on from the work.
   */
  private async rescueSessions(
    project: WatchedProject,
    folder: string,
    control: string
  ): Promise<void> {
    const state = this.readRawState(project.id)
    if (!state) return
    const inReview = new Set(
      (state.workspaceSlots ?? []).map((slot) => slot.sessionId).filter((id): id is string => !!id)
    )
    const git = simpleGit(folder)
    const { version } = await currentVersion(folder)
    if (!version)
      throw new Error(
        'The project folder is not on a version (detached); switch to one and try again.'
      )

    for (const session of state.sessions) {
      const workspace = session.workspace
      if (!workspace || !workspace.branchName.startsWith('nexus/session/')) continue
      const live = session.status !== 'done' || inReview.has(session.id)
      if (!live || workspace.closed) {
        workspace.closed = true
        continue
      }
      if (fs.existsSync(path.join(workspace.worktreePath, '.git'))) {
        await commitCopyLeftovers(workspace.worktreePath, `Unsaved work from "${session.title}"`)
      }
      const task =
        state.tasks.find((candidate) => candidate.id === session.taskId) ??
        state.tasks.find((candidate) => candidate.claimedBy === session.id)
      const slug = taskSlug({ id: task?.id ?? session.id, title: task?.title ?? session.title })
      const branchName = `ostler/${slug}`
      // A reference only: no files in the folder change.
      await git.raw([
        'fetch',
        '--no-tags',
        control,
        `+${workspace.branchName}:refs/heads/${branchName}`
      ])
      const worktreePath = copyPathFor(
        { dataDir: this.dataDir } as Parameters<typeof copyPathFor>[0],
        project.id,
        slug
      )
      if (fs.existsSync(worktreePath)) fs.rmSync(worktreePath, { recursive: true, force: true })
      await git.raw(['worktree', 'prune'])
      fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
      await git.raw(['worktree', 'add', worktreePath, branchName])
      await excludeOstlerScratchPaths(worktreePath)
      const rescued: HarnessWorkspace = {
        branchName,
        worktreePath,
        baseBranch: version,
        baseCommit: workspace.baseCommit,
        ...(workspace.setup ? { setup: workspace.setup } : {})
      }

      if (session.status !== 'done') {
        // Running: it stops, and its task returns to the queue with the work.
        session.status = 'done'
        session.endedAs = 'stopped'
        session.statusNote =
          'Stopped: Ostler moved to the new agent setup. Its work went back to the queue with its task.'
        session.workspace = { ...rescued, closed: true }
        if (task && task.status === 'claimed' && task.claimedBy === session.id) {
          task.status = 'pending'
          task.claimedBy = null
          const copy: HarnessTaskCopy = {
            ...rescued,
            state: 'ready',
            preparedAt: new Date().toISOString(),
            hasWork: true
          }
          task.copy = copy
        }
      } else {
        // Waiting for review: reviewed and applied the new way.
        session.workspace = rescued
      }
    }
    for (const session of state.sessions) {
      if (session.workspace?.branchName.startsWith('nexus/session/'))
        session.workspace.closed = true
    }
    delete state.workspaceSlots
    this.writeRawState(project.id, state)
  }

  /**
   * Step 3: merged agent work the folder never received. Fetched as
   * `ostler/<date>-earlier-agent-work` and put up for review like any finished
   * task: "Agent work from before the update".
   */
  private async rescueUnexportedWork(
    project: WatchedProject,
    folder: string,
    control: string
  ): Promise<void> {
    const git = simpleGit(folder)
    const date = todayIsoDate()
    const branchName = `ostler/${date}-earlier-agent-work`
    try {
      await git.raw(['fetch', '--no-tags', control, `+nexus/control:refs/heads/${branchName}`])
    } catch {
      return // No control version: nothing was ever merged.
    }
    const ahead = Number((await git.raw(['rev-list', '--count', `HEAD..${branchName}`])).trim())
    if (!Number.isFinite(ahead) || ahead === 0) {
      await git.raw(['branch', '-D', branchName])
      return
    }
    const { version } = await currentVersion(folder)
    const base = (await git.raw(['merge-base', 'HEAD', branchName])).trim()
    const slug = branchName.replace(/^ostler\//, '')
    const worktreePath = copyPathFor(
      { dataDir: this.dataDir } as Parameters<typeof copyPathFor>[0],
      project.id,
      slug
    )
    if (fs.existsSync(worktreePath)) fs.rmSync(worktreePath, { recursive: true, force: true })
    await git.raw(['worktree', 'prune'])
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
    await git.raw(['worktree', 'add', worktreePath, branchName])
    await excludeOstlerScratchPaths(worktreePath)

    const state = this.readRawState(project.id) ?? {
      version: 1,
      updatedAt: new Date().toISOString(),
      sessions: [],
      tasks: [],
      questions: [],
      guidance: [],
      watcherRunning: false
    }
    const now = new Date().toISOString()
    const sessionId = randomUUID()
    const taskId = `earlier-${randomUUID().slice(0, 8)}`
    const title = 'Agent work from before the update'
    state.tasks.push({
      id: taskId,
      title,
      details: 'Agent work Ostler merged before the update but never added to the project folder.',
      status: 'complete',
      claimedBy: sessionId,
      priority: 'medium',
      planningWorkItemId: null,
      autoContinue: false,
      hold: false
    })
    state.sessions.push({
      id: sessionId,
      title,
      overview: '',
      startedAt: now,
      lastUpdate: now,
      statusNote: 'Agent work from before the update is ready to apply',
      status: 'done',
      assignedTaskId: null,
      taskId,
      workspace: { branchName, worktreePath, baseBranch: version ?? '', baseCommit: base },
      token: generateSessionToken(),
      lastSeenAt: null,
      provenance: 'external',
      endedAs: 'in_review'
    })
    this.writeRawState(project.id, state)
  }

  /** Step 4: the old folders, moved aside and kept until the person removes them. */
  private archiveFolders(projectId: string): void {
    const target = path.join(
      this.dataDir,
      'legacy',
      projectId.replace(/[^a-zA-Z0-9._-]+/g, '-'),
      todayIsoDate()
    )
    fs.mkdirSync(target, { recursive: true })
    const moves: [string, string][] = LEGACY_PROJECT_ENTRIES.map((entry) => [
      path.join(this.projectDir(projectId), entry),
      path.join(target, entry)
    ])
    moves.push([
      path.join(this.harnessRoot, projectId, 'commit-policy'),
      path.join(target, 'commit-policy')
    ])
    for (const [from, to] of moves) {
      if (!fs.existsSync(from)) continue
      moveAside(from, to)
    }
    const emptyPolicyParent = path.join(this.harnessRoot, projectId)
    try {
      if (fs.existsSync(emptyPolicyParent) && fs.readdirSync(emptyPolicyParent).length === 0) {
        fs.rmdirSync(emptyPolicyParent)
      }
    } catch {
      // An empty folder left behind is harmless.
    }
  }

  /** Space used by agent copies, kept history and the old setup's files (Settings › Data). */
  async storageUsage(): Promise<AgentStorageUsage> {
    const copiesRoot = path.join(this.dataDir, 'worktrees')
    let copies = 0
    if (fs.existsSync(copiesRoot)) {
      for (const project of fs.readdirSync(copiesRoot, { withFileTypes: true })) {
        if (!project.isDirectory()) continue
        copies += fs
          .readdirSync(path.join(copiesRoot, project.name), { withFileTypes: true })
          .filter((entry) => entry.isDirectory()).length
      }
    }
    let restorePoints = 0
    let discardedWork = 0
    for (const project of this.getProjects()) {
      const folder = projectFolder(project)
      if (!folder) continue
      const counts = await countKeptReferences(folder)
      restorePoints += counts.restorePoints
      discardedWork += counts.discarded
    }
    const legacyRoot = path.join(this.dataDir, 'legacy')
    return {
      copiesBytes: fs.existsSync(copiesRoot) ? folderSize(copiesRoot) : 0,
      copies,
      restorePoints,
      discardedWork,
      legacyBytes: fs.existsSync(legacyRoot) ? folderSize(legacyRoot) : 0
    }
  }

  /** "Files from the old agent setup: Remove" (§6 step 4). */
  removeLegacyFiles(): void {
    const legacyRoot = path.join(this.dataDir, 'legacy')
    fs.rmSync(legacyRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

/** A rename, or a copy and delete when the rename crosses drives or a file is held open. */
function moveAside(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  try {
    fs.renameSync(from, to)
  } catch {
    fs.cpSync(from, to, { recursive: true, force: true })
    fs.rmSync(from, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
