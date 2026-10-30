import * as fs from 'fs'
import { isOwnTaskBranch, TASK_BRANCH_PREFIX, taskBranchSlug } from '@shared/legacy-names'
import * as path from 'path'
import simpleGit, { type SimpleGit } from 'simple-git'
import type {
  HarnessSessionDiff,
  HarnessTaskCopy,
  HarnessWorkspace,
  WatchedProject,
  WorkspaceSetupRecord
} from '@shared/ostler-api'
import { requireProjectFolder } from '@shared/project-folder'
import { Refusal } from '@shared/refusal'
import { REPORT_PICTURES_FOLDER } from '@shared/agent-report-extras'
import { t } from '@shared/i18n'
import { labelPathLowIntegrity } from '../sandbox-service'
import {
  currentVersion,
  ensureRepository,
  refExists,
  saveYourEdits,
  type HistoryOptions
} from '../project-history'
import type { HarnessContext } from './context'
import { emptyState, requireSession } from './types'
import { planWorkspaceSetup, runWorkspaceSetup } from './workspace-setup'
import { stopWorkspaceProcesses } from './workspace-processes'

/**
 * Agent copies (simplify pass §2): each task gets its own copy of the project,
 * a Git worktree of the person's own repository at
 * `<dataDir>/worktrees/<project-id>/<task-slug>` on an `ostler/<task-slug>`
 * version. Worktrees share the repository's history, so a copy holds only the
 * project's files.
 *
 * A copy is prepared when its task goes on the queue, setup included, and an
 * agent can start only once it is ready. It is deleted when its task is
 * applied, discarded or stopped; its work stays in the history.
 */

/**
 * Ostler-owned runtime directories are never agent deliverables. The pictures
 * folder is where an agent saves screenshots for its report (N9.1): Ostler
 * copies them out, and they never reach the project. A copy made before the
 * rename may still hold `.nexus-opencode-home`: kept out the same way.
 */
export const OSTLER_SCRATCH_PATHS = [
  '.opencode',
  '.ostler-opencode-home',
  '.nexus-opencode-home',
  REPORT_PICTURES_FOLDER
]

/** Files whose change means a copy's dependencies must be installed again. */
const DEPENDENCY_FILES =
  /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|requirements[^/]*\.txt|poetry\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/

export function copiesRoot(ctx: HarnessContext, projectId: string): string {
  return path.join(ctx.dataDir, 'worktrees', safeSegment(projectId))
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'project'
}

/** A short, readable, unique name for a task's copy and its version. */
export function taskSlug(task: { id: string; title: string }): string {
  const words = task.title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return `${words || 'task'}-${task.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`
}

export function copyPathFor(ctx: HarnessContext, projectId: string, slug: string): string {
  return path.join(copiesRoot(ctx, projectId), slug)
}

/** The person's repository, which every copy belongs to. */
export function repositoryGit(project: WatchedProject): SimpleGit {
  return simpleGit(requireProjectFolder(project, 'Agent copies'))
}

function gitDirOf(worktreePath: string): string | null {
  const gitFile = path.join(worktreePath, '.git')
  if (!fs.existsSync(gitFile)) return null
  if (fs.statSync(gitFile).isDirectory()) return gitFile
  const pointer = fs
    .readFileSync(gitFile, 'utf8')
    .match(/^gitdir:\s*(.+)$/m)?.[1]
    ?.trim()
  return pointer ? path.resolve(worktreePath, pointer) : null
}

/**
 * Keeps the agent runtime's scratch folders out of the copy's changes. A
 * linked worktree reads `info/exclude` from the shared repository, so this is
 * written there once and covers every copy.
 */
export async function excludeOstlerScratchPaths(worktreePath: string): Promise<void> {
  let excludePath: string
  try {
    const common = (await simpleGit(worktreePath).raw(['rev-parse', '--git-common-dir'])).trim()
    excludePath = path.join(path.resolve(worktreePath, common), 'info', 'exclude')
  } catch {
    const gitDir = gitDirOf(worktreePath)
    if (!gitDir) return
    excludePath = path.join(gitDir, 'info', 'exclude')
  }
  const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : ''
  const missing = OSTLER_SCRATCH_PATHS.filter((entry) => !existing.includes(entry))
  if (missing.length) {
    fs.mkdirSync(path.dirname(excludePath), { recursive: true })
    fs.appendFileSync(excludePath, `\n# Ostler runtime scratch\n${missing.join('\n')}\n`, 'utf8')
  }
}

/**
 * The version the folder is on, read from `.git/HEAD` without running Git: the
 * agent state asks often (§4). Null when detached or not a plain repository.
 */
export function folderVersionNow(folder: string): string | null {
  try {
    const head = fs.readFileSync(path.join(folder, '.git', 'HEAD'), 'utf8').trim()
    return head.match(/^ref: refs\/heads\/(.+)$/)?.[1] ?? null
  } catch {
    return null
  }
}

/** Whether `worktreePath` is still a working copy: its `.git` link is there. */
export function hasWorktreeLink(worktreePath: string): boolean {
  return fs.existsSync(path.join(worktreePath, '.git'))
}

/** The key a copy's setup runs under in `ctx.workspaceSetups`. */
export function copySetupKey(taskId: string): string {
  return `copy:${taskId}`
}

function saveCopy(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  update: (copy: HarnessTaskCopy) => void
): void {
  ctx.mutate(project, (state) => {
    const task = state.tasks.find((item) => item.id === taskId)
    if (task?.copy) update(task.copy)
  })
}

/**
 * Makes a task's copy (§2.1): the person's edits saved first, then a worktree
 * on `ostler/<task-slug>` from the folder's current version, the scratch
 * folders excluded, the Low-integrity label, and workspace setup. The task
 * shows "Getting ready" until all of that has finished. Resolves with the
 * finished copy; a failure is recorded on the copy, never thrown, except when
 * the task is gone.
 */
export async function prepareTaskCopy(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  history: HistoryOptions,
  from?: { commit: string; hasWork: boolean }
): Promise<HarnessTaskCopy> {
  if (ctx.preparingCopies.has(taskId)) {
    throw new Refusal(t('errors:history.copyGettingReady', { title: taskId }))
  }
  ctx.preparingCopies.add(taskId)
  try {
    return await prepare(ctx, project, taskId, history, from)
  } finally {
    ctx.preparingCopies.delete(taskId)
  }
}

async function prepare(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  history: HistoryOptions,
  from?: { commit: string; hasWork: boolean }
): Promise<HarnessTaskCopy> {
  const folder = requireProjectFolder(project, 'Preparing an agent copy')
  const task = (ctx.loadState(project.id) ?? emptyState()).tasks.find((item) => item.id === taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  const slug = taskSlug(task)
  const worktreePath = copyPathFor(ctx, project.id, slug)
  // A reviewer's copy (N9.5a) has no version of its own: nothing in it is applied.
  const review = task.reviewOf
  const branchName = review ? '' : `${TASK_BRANCH_PREFIX}${slug}`
  const now = new Date().toISOString()
  const preparing: HarnessTaskCopy = {
    state: 'preparing',
    branchName,
    worktreePath,
    baseBranch: '',
    baseCommit: '',
    preparedAt: now,
    hasWork: from?.hasWork ?? false,
    ...(review ? { detached: true } : {})
  }
  ctx.mutate(project, (state) => {
    const stored = state.tasks.find((item) => item.id === taskId)
    if (stored) stored.copy = preparing
  })
  ctx.notifyWorkspaceSetup(project)

  const fail = (failure: string): HarnessTaskCopy => {
    const failed: HarnessTaskCopy = { ...preparing, state: 'failed', failure }
    saveCopy(ctx, project, taskId, (copy) => Object.assign(copy, failed))
    ctx.notifyWorkspaceSetup(project)
    return failed
  }

  let version: string | null
  let commit: string | null
  try {
    await ensureRepository(folder)
    if (history.saveMyEdits && !from && !review) await saveYourEdits(folder)
    ;({ version, commit } = await currentVersion(folder))
    if (review) {
      // Measured from the reviewed change, whatever the folder is on now.
      version = version ?? ''
      commit = review.baseCommit
    }
    if (version === null || !commit) return fail(t('errors:history.folderDetached'))
    const git = simpleGit(folder)
    await removeLeftoverCopy(git, worktreePath, branchName)
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
    await git.raw(
      review
        ? ['worktree', 'add', '--detach', worktreePath, review.headCommit]
        : ['worktree', 'add', worktreePath, '-B', branchName, from?.commit ?? commit]
    )
    await excludeOstlerScratchPaths(worktreePath)
  } catch (error) {
    return fail(
      t('errors:gitWorktree.couldNotCreateAgent', {
        message: error instanceof Error ? error.message : String(error)
      })
    )
  }

  // Best effort: the copy works without the label, the OS write boundary just
  // isn't active for it.
  try {
    await labelPathLowIntegrity(worktreePath)
  } catch (error) {
    console.warn(
      `[HarnessService] Failed to label the copy Low integrity (${worktreePath}): ${error instanceof Error ? error.message : String(error)}`
    )
  }

  saveCopy(ctx, project, taskId, (copy) => {
    copy.baseBranch = version!
    copy.baseCommit = commit!
  })
  const setup = await runCopySetup(ctx, project, taskId, worktreePath)
  const finished: HarnessTaskCopy = {
    ...preparing,
    baseBranch: version,
    baseCommit: commit,
    setup,
    state: setup.status === 'failed' || setup.status === 'cancelled' ? 'failed' : 'ready',
    ...(setup.status === 'failed' || setup.status === 'cancelled'
      ? { failure: setup.failure ?? t('errors:history.setupStopped') }
      : {})
  }
  saveCopy(ctx, project, taskId, (copy) => Object.assign(copy, finished))
  ctx.notifyWorkspaceSetup(project)
  return finished
}

/** Runs workspace setup in a copy and waits for it, registered so every stop path can abort it. */
async function runCopySetup(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  worktreePath: string
): Promise<WorkspaceSetupRecord> {
  const planned = planWorkspaceSetup(project, worktreePath)
  saveCopy(ctx, project, taskId, (copy) => (copy.setup = planned.setup))
  if (!planned.run) return planned.setup
  const key = copySetupKey(taskId)
  const controller = new AbortController()
  const done = runWorkspaceSetup(
    ctx,
    project,
    {
      id: taskId,
      worktreePath,
      save: (record) => saveCopy(ctx, project, taskId, (copy) => (copy.setup = record))
    },
    planned.run,
    controller.signal
  ).catch((error: unknown): WorkspaceSetupRecord => ({
    status: 'failed',
    failure: `Setup failed: ${error instanceof Error ? error.message : String(error)}`,
    finishedAt: new Date().toISOString()
  }))
  ctx.workspaceSetups.set(key, { controller, done })
  try {
    return await done
  } finally {
    if (ctx.workspaceSetups.get(key)?.done === done) ctx.workspaceSetups.delete(key)
  }
}

/** A folder left by an interrupted copy, cleared before a new one. `-B` resets its version. */
async function removeLeftoverCopy(
  git: SimpleGit,
  worktreePath: string,
  branchName: string
): Promise<void> {
  if (fs.existsSync(worktreePath)) {
    await removeCopy(git, { worktreePath, branchName }, { keepBranch: true })
  }
}

/**
 * Brings a copy with no work in it up to the folder's latest state when an
 * agent starts (§2.2). About a second; setup runs again only when the
 * dependency files changed. A copy with work in it is left alone.
 */
export async function refreshCopyForStart(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  copy: HarnessTaskCopy
): Promise<HarnessTaskCopy> {
  // A reviewer's copy stays at the change it reviews (N9.5a).
  if (copy.hasWork || copy.detached) return copy
  const folder = requireProjectFolder(project, 'Starting an agent')
  const { version, commit } = await currentVersion(folder)
  if (!version || !commit) return copy
  if (commit === copy.baseCommit && version === copy.baseBranch) return copy
  const git = simpleGit(copy.worktreePath)
  const status = await git.raw(['status', '--porcelain'])
  const head = (await git.raw(['rev-parse', 'HEAD'])).trim()
  // Someone worked in the copy by hand: it has work, so it is not reset.
  if (status.trim() || head !== copy.baseCommit) return copy
  const changed = (await git.raw(['diff', '--name-only', copy.baseCommit, commit]))
    .split(/\r?\n/)
    .filter(Boolean)
  await git.raw(['reset', '--hard', commit])
  const refreshed: HarnessTaskCopy = { ...copy, baseBranch: version, baseCommit: commit }
  saveCopy(ctx, project, taskId, (stored) => Object.assign(stored, refreshed))
  if (changed.some((file) => DEPENDENCY_FILES.test(file))) {
    const setup = await runCopySetup(ctx, project, taskId, copy.worktreePath)
    refreshed.setup = setup
    if (setup.status === 'failed' || setup.status === 'cancelled') {
      refreshed.state = 'failed'
      refreshed.failure = setup.failure ?? t('errors:history.setupStopped')
    }
    saveCopy(ctx, project, taskId, (stored) => Object.assign(stored, refreshed))
  }
  return refreshed
}

/**
 * Deletes a copy's folder and, unless kept, its `ostler/*` version. Work in it
 * is safe only once it is applied or kept as discarded work, so callers do
 * that first.
 */
export async function removeCopy(
  git: SimpleGit,
  workspace: Pick<HarnessWorkspace, 'worktreePath' | 'branchName'>,
  options: { keepBranch?: boolean } = {}
): Promise<void> {
  const { worktreePath, branchName } = workspace
  // Anything still running from the copy (a dev server the agent left up)
  // keeps files open, and Windows then refuses to delete the folder.
  await stopWorkspaceProcesses(worktreePath)
  try {
    await git.raw(['worktree', 'remove', worktreePath, '--force'])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/is not a working tree/i.test(message)) {
      throw new Error(t('errors:gitWorktree.couldNotRemoveAgent', { message }))
    }
  }
  if (fs.existsSync(worktreePath)) {
    try {
      fs.rmSync(worktreePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (rmError) {
      throw new Error(
        `Could not remove the agent copy (${worktreePath}); a program may still have files open there. Close it and try again. (${rmError instanceof Error ? rmError.message : String(rmError)})`
      )
    }
  }
  try {
    await git.raw(['worktree', 'prune'])
  } catch {
    // Tidy-up only.
  }
  // A reviewer's detached copy has no version to delete.
  if (options.keepBranch || !branchName) return
  try {
    await git.raw(['branch', '-D', branchName])
  } catch {
    // Already gone.
  }
}

export interface SessionLeftoverCommit {
  committed: boolean
  /** Paths swept into the commit, or the paths still unsaved if the commit failed. */
  files: string[]
  /** Why nothing was saved, when `committed` is false and `files` is non-empty. */
  error?: string
}

/**
 * Saves whatever an agent left unsaved in its copy, on the copy's own
 * `ostler/*` version. It never touches the person's folder, and it is not an
 * apply: the person still decides whether the work lands.
 */
export async function commitCopyLeftovers(
  worktreePath: string,
  message: string
): Promise<SessionLeftoverCommit> {
  if (!hasWorktreeLink(worktreePath)) return { committed: false, files: [] }
  const git = simpleGit(worktreePath)
  const status = await git.status()
  if (status.isClean()) return { committed: false, files: [] }
  const files = status.files.map((file) => file.path)
  try {
    await git.raw(['add', '-A'])
    // -A can still stage nothing when everything left is excluded scratch.
    const staged = (await git.raw(['diff', '--cached', '--name-only'])).trim()
    if (!staged) return { committed: false, files: [] }
    await git.raw([...(await identityFor(git)), 'commit', '-m', message])
    return { committed: true, files }
  } catch (error) {
    try {
      await git.raw(['reset'])
    } catch {
      // The failure below is the one worth reporting.
    }
    return {
      committed: false,
      files,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

async function identityFor(git: SimpleGit): Promise<string[]> {
  try {
    if ((await git.raw(['config', 'user.email'])).trim()) return []
  } catch {
    // Unset.
  }
  return ['-c', 'user.name=Ostler', '-c', 'user.email=ostler@localhost']
}

/** The commit the folder is on now, the point a copy's changes are measured from. */
async function folderCommit(project: WatchedProject): Promise<string | null> {
  try {
    return (await currentVersion(requireProjectFolder(project, 'Agent copies'))).commit
  } catch {
    return null
  }
}

/**
 * Read-only: the changes in a session's copy, measured from where the copy and
 * the folder last agreed, unsaved changes included.
 */
export async function getSessionDiff(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string
): Promise<HarnessSessionDiff> {
  const state = ctx.loadState(project.id) ?? emptyState()
  const session = requireSession(state, sessionId)
  if (!session.workspace) throw new Refusal(t('errors:gitWorktree.agentHasNoAgent'))
  const workspace = session.workspace
  if (hasWorktreeLink(workspace.worktreePath)) {
    try {
      return await readSessionDiff(project, workspace, true)
    } catch (error) {
      // Apply or Discard can remove the copy while this reads it; its version
      // still holds the work, read below.
      if (hasWorktreeLink(workspace.worktreePath)) throw error
    }
  }
  try {
    return await readSessionDiff(project, workspace, false)
  } catch (error) {
    // Apply and Discard delete the version too, once the work is safe.
    if (await refExists(repositoryGit(project), workspace.branchName)) throw error
    return noSessionChanges(project, workspace)
  }
}

type DiffWorkspace = Pick<
  HarnessWorkspace,
  'branchName' | 'baseBranch' | 'baseCommit' | 'worktreePath'
>

/** The changes read from the copy itself (`live`) or, when it is gone, from its version. */
async function readSessionDiff(
  project: WatchedProject,
  workspace: DiffWorkspace,
  live: boolean
): Promise<HarnessSessionDiff> {
  const { branchName, baseCommit, worktreePath } = workspace
  const git = live ? simpleGit(worktreePath) : repositoryGit(project)
  const head = live ? 'HEAD' : branchName
  const folderHead = await folderCommit(project)
  let mergeBase = baseCommit
  try {
    if (folderHead) mergeBase = (await git.raw(['merge-base', folderHead, head])).trim()
  } catch {
    // The folder's commit is unrelated to the copy: measure from where it started.
  }
  const summary = await git.diffSummary(live ? [mergeBase] : [mergeBase, head])
  const committedSummary = await git.diffSummary([mergeBase, head])
  const workspaceStatus = live ? await git.status() : null
  const patchLimit = 200_000
  const rawPatch = await git.raw(
    live
      ? ['diff', '--no-ext-diff', '--unified=3', mergeBase]
      : ['diff', '--no-ext-diff', '--unified=3', mergeBase, head]
  )
  const patchTruncated = rawPatch.length > patchLimit
  return sessionDiff(project, workspace, {
    filesChanged: summary.files.length,
    insertions: summary.insertions,
    deletions: summary.deletions,
    files: summary.files.map((file) =>
      file.binary
        ? { path: file.file, insertions: 0, deletions: 0, binary: true }
        : { path: file.file, insertions: file.insertions, deletions: file.deletions, binary: false }
    ),
    patch: patchTruncated ? rawPatch.slice(0, patchLimit) : rawPatch,
    patchTruncated,
    committedFilesChanged: committedSummary.files.length,
    committedInsertions: committedSummary.insertions,
    committedDeletions: committedSummary.deletions,
    hasUncommittedChanges: !!workspaceStatus && !workspaceStatus.isClean(),
    uncommittedFiles: workspaceStatus?.files.map((file) => file.path) ?? []
  })
}

/** A task whose copy and version are both gone: nothing left to review. */
function noSessionChanges(
  project: WatchedProject,
  workspace: DiffWorkspace
): Promise<HarnessSessionDiff> {
  return sessionDiff(project, workspace, {
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    files: [],
    patch: '',
    patchTruncated: false,
    committedFilesChanged: 0,
    committedInsertions: 0,
    committedDeletions: 0,
    hasUncommittedChanges: false,
    uncommittedFiles: []
  })
}

async function sessionDiff(
  project: WatchedProject,
  { branchName, baseBranch }: DiffWorkspace,
  changes: Omit<
    HarnessSessionDiff,
    | 'branchName'
    | 'baseBranch'
    | 'mergeReadiness'
    | 'mergeReadinessReason'
    | 'taskVersion'
    | 'folderVersion'
    | 'versionChanged'
  >
): Promise<HarnessSessionDiff> {
  const hasChanges = changes.filesChanged > 0
  const folderVersion = (await safeVersion(project)) ?? baseBranch
  return {
    branchName,
    baseBranch,
    ...changes,
    mergeReadiness: hasChanges ? 'ready' : 'no_changes',
    mergeReadinessReason: hasChanges
      ? t('errors:gitWorktree.sessionBranchHasCommitted')
      : t('errors:gitWorktree.sessionBranchHasNo'),
    taskVersion: baseBranch,
    folderVersion,
    versionChanged: folderVersion !== baseBranch
  }
}

async function safeVersion(project: WatchedProject): Promise<string | null> {
  try {
    return (await currentVersion(requireProjectFolder(project, 'Agent copies'))).version
  } catch {
    return null
  }
}

/** Saves and counts the work on a run's version for the run history (R5.3). Best effort. */
export async function recordSessionWork(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  workspace: Pick<HarnessWorkspace, 'branchName' | 'baseCommit'>
): Promise<void> {
  const repository = ctx.database.agentRuns
  if (!repository) return
  try {
    const git = repositoryGit(project)
    const range = `${workspace.baseCommit}..${workspace.branchName}`
    const commits = Number((await git.raw(['rev-list', '--count', '--no-merges', range])).trim())
    const names = await git.raw([
      'diff',
      '--name-only',
      `${workspace.baseCommit}...${workspace.branchName}`
    ])
    repository.setWork(
      sessionId,
      Number.isFinite(commits) ? commits : 0,
      names.split('\n').filter((line) => line.trim().length > 0).length
    )
  } catch {
    // The version is already gone, or Git could not be read.
  }
}

/** True for a version Ostler made for a task copy. */
export function isOstlerTaskBranch(branchName: string | null): boolean {
  return isOwnTaskBranch(branchName)
}

/** Bytes used by every agent copy of every project, for Settings › Data. */
export function folderSize(folder: string): number {
  let total = 0
  const stack = [folder]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size
        } catch {
          // Vanished while counting.
        }
      }
    }
  }
  return total
}

/**
 * Prepares copies for the next few queued tasks (§2.2): as many as `limit`,
 * in queue order, skipping held tasks and tasks still waiting on their
 * dependencies. Other queued tasks show "Waiting" and are prepared as copies
 * free up. Sequential: one copy and one install at a time per project.
 */
export async function ensureCopies(
  ctx: HarnessContext,
  project: WatchedProject,
  limit: number,
  history: HistoryOptions
): Promise<void> {
  if (limit <= 0) return
  const state = ctx.loadState(project.id) ?? emptyState()
  const queued = state.tasks.filter(
    (task) =>
      task.status === 'pending' &&
      !task.claimedBy &&
      !task.hold &&
      ctx.isTaskDispatchable(project.id, task.planningWorkItemId)
  )
  // A copy an open review still holds is never made again over it.
  const held = new Set(
    state.sessions.flatMap((session) =>
      session.workspace && !session.workspace.closed ? [session.workspace.worktreePath] : []
    )
  )
  const wanted = queued.slice(0, limit)
  for (const task of wanted) {
    if (!task.copy && held.has(copyPathFor(ctx, project.id, taskSlug(task)))) continue
    // A copy left "preparing" when Ostler quit is made again.
    const interrupted = task.copy?.state === 'preparing' && !ctx.preparingCopies.has(task.id)
    if (task.copy && !interrupted) continue
    if (ctx.preparingCopies.has(task.id)) continue
    await prepareTaskCopy(ctx, project, task.id, history)
  }
}

/**
 * Deletes copies nothing will use: those of tasks that were cancelled or
 * finished another way. A copy holding work is kept as discarded work first,
 * so nothing is lost.
 */
export async function tidyCopies(ctx: HarnessContext, project: WatchedProject): Promise<void> {
  const state = ctx.loadState(project.id) ?? emptyState()
  const stale = state.tasks.filter(
    (task) => task.copy && task.copy.state !== 'preparing' && task.status !== 'pending'
  )
  if (stale.length === 0) return
  const git = repositoryGit(project)
  for (const task of stale) {
    const copy = task.copy!
    try {
      if (copy.hasWork) {
        const tip = (await git.raw(['rev-parse', copy.branchName])).trim()
        await git.raw([
          'update-ref',
          `refs/ostler/discarded/${taskBranchSlug(copy.branchName)}`,
          tip
        ])
      }
      await removeCopy(git, copy)
    } catch (error) {
      console.warn(
        `[HarnessService] Could not remove the unused copy of task ${task.id}: ${error instanceof Error ? error.message : String(error)}`
      )
      continue
    }
    ctx.mutate(project, (next) => {
      const stored = next.tasks.find((item) => item.id === task.id)
      if (stored?.copy?.worktreePath === copy.worktreePath) delete stored.copy
    })
  }
}
