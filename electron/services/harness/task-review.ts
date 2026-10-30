import { randomUUID } from 'crypto'
import simpleGit, { type SimpleGit } from 'simple-git'
import type {
  DiscardedTaskWork,
  HarnessApplyResult,
  HarnessReviewComment,
  HarnessSentReviewComment,
  HarnessSession,
  HarnessTaskRejection,
  HarnessWorkspace,
  WatchedProject
} from '@shared/ostler-api'
import type { AgentRunChoice } from '@shared/agent-model'
import { requireProjectFolder } from '@shared/project-folder'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import { parseUnifiedDiff } from '@shared/diff/unified-diff'
import {
  normalizeReviewComments,
  pruneRejectionComments,
  SEE_LINE_COMMENTS,
  withExcerpts
} from '@shared/review-comments'
import {
  applyTaskSegments,
  currentVersion,
  keepDiscardedWork,
  refExists,
  saveYourEdits,
  type HistoryOptions,
  type TaskSegment
} from '../project-history'
import type { HarnessContext } from './context'
import { emptyState, requireSession, toSession, type StoredSession } from './types'
import { settleSessionTasks } from './sessions'
import { sendBackNote } from './task-queue'
import {
  commitCopyLeftovers,
  copyPathFor,
  hasWorktreeLink,
  recordSessionWork,
  getSessionDiff,
  removeCopy,
  repositoryGit
} from './task-copies'

/**
 * Review, Apply, Discard, Send back, Stop and Bring back (simplify pass §3).
 * The person decides; nothing here runs on its own. Every path that removes a
 * copy first puts its work somewhere safe: into the folder's history (Apply),
 * or under `refs/ostler/discarded/` (Discard, Stop, back to planning).
 */

/** The message an agent gets when the project changed under it and its work clashes. */
export const BRING_UP_TO_DATE_NOTE =
  'Your project changed while you worked; bring your work up to date with it.'

function slugOf(workspace: HarnessWorkspace): string {
  return workspace.branchName.replace(/^ostler\//, '')
}

function requireReviewable(ctx: HarnessContext, project: WatchedProject, sessionId: string) {
  const state = ctx.loadState(project.id) ?? emptyState()
  const session = requireSession(state, sessionId)
  // A review run's copy is never applied, sent back or kept (N9.5a).
  if (!session.workspace || session.workspace.closed || session.reviewOf) {
    throw new Refusal(t('errors:gitWorktree.agentHasNoAgent3'))
  }
  return { session, workspace: session.workspace }
}

/** Makes sure the copy's folder exists, recreating it from its version if it went missing. */
async function ensureCopyFolder(git: SimpleGit, workspace: HarnessWorkspace): Promise<void> {
  if (hasWorktreeLink(workspace.worktreePath)) return
  try {
    await git.raw(['worktree', 'prune'])
    await git.raw(['worktree', 'add', workspace.worktreePath, workspace.branchName])
  } catch (error) {
    throw new Error(
      t('errors:gitWorktree.couldNotCreateAgent', {
        message: error instanceof Error ? error.message : String(error)
      })
    )
  }
}

/** The copy's latest state, after saving anything the agent left unsaved. */
async function copyTip(
  git: SimpleGit,
  workspace: HarnessWorkspace,
  title: string
): Promise<string> {
  if (hasWorktreeLink(workspace.worktreePath)) {
    await commitCopyLeftovers(
      workspace.worktreePath,
      t('projects:history.agentLeftovers', { title })
    )
  }
  return (await git.raw(['rev-parse', workspace.branchName])).trim()
}

/**
 * Whether `ancestor` is in `descendant`'s history. Read from Git's output, not
 * its exit code: simple-git only throws when Git writes to stderr, and
 * `merge-base --is-ancestor` answers with its exit code alone.
 */
async function isAncestor(git: SimpleGit, ancestor: string, descendant: string): Promise<boolean> {
  try {
    const [base, sha] = await Promise.all([
      git.raw(['merge-base', ancestor, descendant]),
      git.raw(['rev-parse', '--verify', `${ancestor}^{commit}`])
    ])
    return base.trim() !== '' && base.trim() === sha.trim()
  } catch {
    return false
  }
}

/** Whether a merge stopped part-way in `git`'s folder, with clashes to settle. */
async function mergeInProgress(git: SimpleGit): Promise<boolean> {
  try {
    return (await git.raw(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'])).trim() !== ''
  } catch {
    return false
  }
}

/**
 * Apply (§3.2). Never a blind merge:
 * 1. the person's edits are saved;
 * 2. the task is brought up to date with the folder in its copy, and on a
 *    clash it goes back to its agent instead, with nothing changed;
 * 3. a restore point is recorded;
 * 4. the work is added as one entry per task;
 * 5. the copy and its version are deleted and the task is done.
 *
 * When the folder is on a different version from the task's (§4), Apply asks
 * first: `onCurrentVersion` is the person's "Apply to the current version".
 */
export async function applyTaskWork(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  history: HistoryOptions,
  onCurrentVersion = false
): Promise<HarnessApplyResult> {
  const { session, workspace } = requireReviewable(ctx, project, sessionId)
  if (session.status !== 'done') throw new Refusal(t('errors:history.stillWorking'))
  const folder = requireProjectFolder(project, 'Applying agent work')
  const git = simpleGit(folder)

  const { version } = await currentVersion(folder)
  if (!version) throw new Refusal(t('errors:history.folderDetached'))
  if (version !== workspace.baseBranch && !onCurrentVersion) {
    throw new Refusal(
      t('errors:history.versionChanged', { task: workspace.baseBranch, folder: version })
    )
  }

  await ensureCopyFolder(git, workspace)
  if (history.saveMyEdits) await saveYourEdits(folder)
  const folderHead = (await git.raw(['rev-parse', 'HEAD'])).trim()

  // 2. Bring the task up to date, in its own copy.
  await copyTip(git, workspace, session.title)
  const copyGit = simpleGit(workspace.worktreePath)
  if (!(await isAncestor(git, folderHead, workspace.branchName))) {
    try {
      await copyGit.raw([
        ...(await identity(copyGit)),
        'merge',
        '--no-edit',
        '--no-verify',
        '-m',
        t('projects:history.broughtUpToDate'),
        folderHead
      ])
    } catch {
      // Reported below: a clash leaves the merge in progress.
    }
    // A clash does not always throw (Git reports it on stdout), so ask Git.
    if (await mergeInProgress(copyGit)) {
      try {
        await copyGit.raw(['merge', '--abort'])
      } catch {
        // Nothing to abort.
      }
      return sendBackForUpdate(ctx, project, sessionId)
    }
    if (!(await isAncestor(git, folderHead, workspace.branchName))) {
      return sendBackForUpdate(ctx, project, sessionId)
    }
  }
  const tip = (await git.raw(['rev-parse', workspace.branchName])).trim()

  // 3 and 4. Restore point, then one entry per task.
  const segments = await fromFolderVersion(
    git,
    taskSegments(ctx, project, session, workspace, tip),
    folderHead
  )
  const { entries, conflicts } = await applyTaskSegments(folder, git, segments, history)
  if (conflicts.length > 0) return sendBackForUpdate(ctx, project, sessionId)

  // 5. Clean up.
  await recordSessionWork(ctx, project, sessionId, workspace)
  await removeCopy(git, workspace)

  let updated: StoredSession | undefined
  ctx.mutate(project, (next) => {
    updated = requireSession(next, sessionId)
    updated.status = 'done'
    updated.statusNote = entries.length > 0 ? 'Applied to the project folder' : 'Nothing changed'
    delete updated.reviewDrafts
    updated.lastUpdate = new Date().toISOString()
    if (updated.workspace) updated.workspace.closed = true
    settleSessionTasks(next, sessionId, 'complete')
  })
  if (!updated) throw new Error('Session update failed')
  ctx.recordEvent(
    project,
    'session_end',
    updated,
    entries.length > 0
      ? `Applied "${updated.title}" to the project folder (${entries.length} ${entries.length === 1 ? 'entry' : 'entries'})`
      : `Closed "${updated.title}" with nothing changed`
  )
  return {
    session: toSession(updated),
    outcome: entries.length > 0 ? 'applied' : 'nothing_changed',
    entries: entries.length
  }
}

/** One segment per task the copy holds, oldest first, ending at the copy's tip. */
function taskSegments(
  ctx: HarnessContext,
  project: WatchedProject,
  session: StoredSession,
  workspace: HarnessWorkspace,
  tip: string
): TaskSegment[] {
  const state = ctx.loadState(project.id) ?? emptyState()
  const marks = workspace.taskMarks ?? []
  const segments: TaskSegment[] = []
  let start = workspace.baseCommit
  for (const mark of marks) {
    segments.push({ taskId: mark.taskId, title: mark.title, start, end: mark.commit })
    start = mark.commit
  }
  const lastTask =
    state.tasks.find(
      (task) => task.claimedBy === session.id && !marks.some((m) => m.taskId === task.id)
    ) ?? state.tasks.find((task) => task.id === session.taskId)
  segments.push({
    taskId: lastTask?.id ?? session.taskId ?? session.id,
    title: lastTask?.title ?? session.title,
    start,
    end: tip
  })
  return segments
}

/**
 * A segment that holds the folder's current version (the copy was brought up
 * to date, by its agent or by Apply) starts from that version, not from where
 * the copy began: its changes are then the task's work on top of the folder,
 * including how the agent settled any clash, and they never clash again.
 */
async function fromFolderVersion(
  git: SimpleGit,
  segments: TaskSegment[],
  folderHead: string
): Promise<TaskSegment[]> {
  const result: TaskSegment[] = []
  for (const segment of segments) {
    const holdsFolder = await isAncestor(git, folderHead, segment.end)
    const startHolds = holdsFolder && (await isAncestor(git, folderHead, segment.start))
    result.push(holdsFolder && !startHolds ? { ...segment, start: folderHead } : segment)
  }
  return result
}

async function identity(git: SimpleGit): Promise<string[]> {
  try {
    if ((await git.raw(['config', 'user.email'])).trim()) return []
  } catch {
    // Unset.
  }
  return ['-c', 'user.name=Ostler', '-c', 'user.email=ostler@localhost']
}

/** The clash case of Apply: the task goes back to its agent, in the same copy, with the note. */
async function sendBackForUpdate(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string
): Promise<HarnessApplyResult> {
  // The person chose Apply, so draft line comments are not sent (they were told).
  const session = await sendBack(
    ctx,
    project,
    sessionId,
    BRING_UP_TO_DATE_NOTE,
    'retry',
    undefined,
    []
  )
  return { session, outcome: 'sent_back', entries: 0 }
}

/**
 * Keeps a copy's work under `refs/ostler/discarded/<task-slug>` and deletes the
 * copy. Returns the reference, or null when the copy held no work.
 */
async function keepAndRemoveCopy(
  ctx: HarnessContext,
  project: WatchedProject,
  session: StoredSession,
  workspace: HarnessWorkspace
): Promise<string | null> {
  const git = repositoryGit(project)
  let ref: string | null = null
  try {
    const tip = await copyTip(git, workspace, session.title)
    if (tip !== workspace.baseCommit) ref = await keepDiscardedWork(git, slugOf(workspace), tip)
  } catch {
    // The version is already gone: there is nothing left to keep.
  }
  await recordSessionWork(ctx, project, session.id, workspace)
  await removeCopy(git, workspace)
  return ref
}

/**
 * Discard (§3.3): deletes the copy but keeps the work for the retention
 * period, so Bring back can recreate it. The task goes back to the queue.
 */
export async function discardTaskWork(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string
): Promise<HarnessSession> {
  const { session, workspace } = requireReviewable(ctx, project, sessionId)
  // A running agent is still writing to its copy: Stop is the way to end it.
  if (session.status !== 'done') throw new Refusal(t('errors:history.stillWorking'))
  const ref = await keepAndRemoveCopy(ctx, project, session, workspace)
  let updated: StoredSession | undefined
  ctx.mutate(project, (next) => {
    updated = requireSession(next, sessionId)
    updated.status = 'done'
    updated.statusNote = 'Discarded'
    delete updated.reviewDrafts
    updated.lastUpdate = new Date().toISOString()
    if (updated.workspace) updated.workspace.closed = true
    if (ref) {
      updated.discardedRef = ref
      updated.discardedAt = new Date().toISOString()
    }
    reopenTasks(next.tasks, sessionId)
  })
  if (!updated) throw new Error('Session update failed')
  ctx.recordEvent(project, 'session_end', updated, `Discarded "${updated.title}"`)
  return toSession(updated)
}

/** A session's tasks go back to the queue: claimed or finished, the work is not taken. */
function reopenTasks(tasks: ReturnType<typeof emptyState>['tasks'], sessionId: string): void {
  for (const task of tasks) {
    if (task.claimedBy !== sessionId) continue
    if (task.status !== 'claimed' && task.status !== 'complete') continue
    task.status = 'pending'
    task.claimedBy = null
    delete task.report
  }
}

/**
 * Stop (§1, §3.3): ends a running agent, keeps its work the way Discard does,
 * and puts its task back in the queue. The caller stops the agent's process
 * first. The one override that replaces force-release and force-end.
 */
export async function stopSession(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string
): Promise<HarnessSession> {
  const state = ctx.loadState(project.id) ?? emptyState()
  const session = requireSession(state, sessionId)
  const workspace = session.workspace
  // A run that ended as it was stopped has already handed its copy back to
  // its task (failSession); Stop still keeps that work aside and starts over.
  const handedBack = state.tasks.find(
    (task) =>
      task.status === 'pending' && !!workspace && task.copy?.worktreePath === workspace.worktreePath
  )
  let ref: string | null = null
  if (workspace && (!workspace.closed || handedBack)) {
    ref = await keepAndRemoveCopy(ctx, project, session, workspace)
  }
  let updated: StoredSession | undefined
  ctx.mutate(project, (next) => {
    updated = requireSession(next, sessionId)
    if (handedBack) delete next.tasks.find((task) => task.id === handedBack.id)?.copy
    updated.status = 'done'
    updated.statusNote = 'Stopped'
    delete updated.reviewDrafts
    updated.endedAs = 'stopped'
    updated.lastUpdate = new Date().toISOString()
    if (updated.workspace) updated.workspace.closed = true
    if (ref) {
      updated.discardedRef = ref
      updated.discardedAt = new Date().toISOString()
    }
    reopenTasks(next.tasks, sessionId)
  })
  if (!updated) throw new Error('Session update failed')
  ctx.recordEvent(project, 'session_end', updated, `Stopped "${updated.title}"`)
  return toSession(updated)
}

/**
 * Send back (§3.3, today's reject): returns the task to its agent with a note,
 * in the same copy, and says what happens next. "rework" hands it back to
 * planning instead: the copy's work is kept as discarded work and the queue
 * entry goes away. Nothing here re-plans the queue on its own.
 */
export async function sendBack(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  reason: string,
  disposition: HarnessTaskRejection['disposition'],
  /** "Run again with…" (D42): the next run's model and effort, already validated. Retry only. */
  runAgainWith?: AgentRunChoice,
  /**
   * Line comments (N9.2a), unchecked. Absent: the session's draft comments,
   * the ones the person wrote in Review changes.
   */
  comments?: unknown
): Promise<HarnessSession> {
  const { session, workspace } = requireReviewable(ctx, project, sessionId)
  const anchors =
    comments === undefined
      ? (session.reviewDrafts ?? [])
      : normalizeReviewComments(comments, () => randomUUID())
  // Comments may stand in for the reason: they say what was wrong.
  const trimmedReason = reason.trim() || (anchors.length > 0 ? SEE_LINE_COMMENTS : '')
  if (!trimmedReason) throw new Refusal(t('errors:gitWorktree.reasonRequiredRejectAgents'))
  if (session.status !== 'done') throw new Refusal(t('errors:history.stillWorking'))
  // The excerpts come from the diff now, before a rework removes the copy.
  const sentComments = await commentsWithExcerpts(ctx, project, sessionId, anchors)
  const before = ctx.loadState(project.id) ?? emptyState()
  // A session that ended blocked or failed has already handed its task back,
  // so its own task id is the fallback.
  const taskId = before.tasks.find((task) => task.claimedBy === sessionId)?.id ?? session.taskId

  let ref: string | null = null
  if (disposition === 'rework') {
    ref = await keepAndRemoveCopy(ctx, project, session, workspace)
  } else {
    const git = repositoryGit(project)
    await ensureCopyFolder(git, workspace)
    await copyTip(git, workspace, session.title)
  }

  let updated: StoredSession | undefined
  ctx.mutate(project, (next) => {
    updated = requireSession(next, sessionId)
    updated.status = 'done'
    updated.statusNote = `Sent back: ${trimmedReason}`
    updated.lastUpdate = new Date().toISOString()
    delete updated.reviewDrafts
    if (updated.workspace) updated.workspace.closed = true
    if (ref) {
      updated.discardedRef = ref
      updated.discardedAt = new Date().toISOString()
    }
    reopenTasks(next.tasks, sessionId)
    const task = taskId ? next.tasks.find((candidate) => candidate.id === taskId) : undefined
    if (!task) return
    task.rejections = pruneRejectionComments([
      ...(task.rejections ?? []),
      {
        reason: trimmedReason,
        rejectedAt: new Date().toISOString(),
        disposition,
        sessionId,
        ...(sentComments.length > 0
          ? { comments: sentComments, commentCount: sentComments.length }
          : {})
      }
    ])
    // The note has to reach whoever works on this next, and for an agent that
    // means the task details it is handed. The comments themselves go in its
    // prompt (embedded) or as reviewComments (harness API).
    task.details = `${task.details}${sendBackNote(
      task.rejections.length,
      trimmedReason,
      sentComments.length
    )}`.slice(0, 8000)
    task.hold = disposition === 'hold'
    if (disposition === 'retry' && runAgainWith) {
      if (runAgainWith.model) task.model = runAgainWith.model
      else delete task.model
      if (runAgainWith.effort) task.effort = runAgainWith.effort
      else delete task.effort
    }
    if (disposition === 'rework') {
      task.status = 'cancelled'
      task.claimedBy = null
      delete task.copy
      return
    }
    // Same copy, work and all: the next run picks up where this one stopped.
    task.copy = {
      ...workspace,
      closed: false,
      taskMarks: [],
      state: 'ready',
      preparedAt: new Date().toISOString(),
      hasWork: true
    }
  })
  if (!updated) throw new Error('Session update failed')
  ctx.recordEvent(
    project,
    'session_end',
    updated,
    `Sent back "${updated.title}" (${disposition}): ${trimmedReason}${
      sentComments.length > 0 ? ` (${sentComments.length} line comments)` : ''
    }`
  )
  return toSession(updated)
}

/** Line comments with the code they are about, read from the session's diff. */
async function commentsWithExcerpts(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  comments: HarnessReviewComment[]
): Promise<HarnessSentReviewComment[]> {
  if (comments.length === 0) return []
  const diff = await getSessionDiff(ctx, project, sessionId)
  return withExcerpts(parseUnifiedDiff(diff.patch), comments)
}

/**
 * Keeps the person's draft line comments with the session (N9.2a), so closing
 * Review changes loses nothing. Replaces the whole list; an empty list clears it.
 */
export function saveReviewDrafts(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  drafts: unknown
): HarnessSession {
  const checked = normalizeReviewComments(drafts, () => randomUUID())
  const { session } = requireReviewable(ctx, project, sessionId)
  if (session.status !== 'done') throw new Refusal(t('errors:history.stillWorking'))
  let updated: StoredSession | undefined
  ctx.mutate(project, (next) => {
    updated = requireSession(next, sessionId)
    if (checked.length > 0) updated.reviewDrafts = checked
    else delete updated.reviewDrafts
  })
  if (!updated) throw new Error('Session update failed')
  return toSession(updated)
}

/** Work kept from discarded and stopped tasks, newest first, for Bring back. */
export async function listDiscardedWork(
  ctx: HarnessContext,
  project: WatchedProject
): Promise<DiscardedTaskWork[]> {
  const state = ctx.loadState(project.id) ?? emptyState()
  const candidates = state.sessions.filter((session) => session.discardedRef)
  if (candidates.length === 0) return []
  const git = repositoryGit(project)
  const kept: DiscardedTaskWork[] = []
  for (const session of candidates) {
    if (!(await refExists(git, session.discardedRef!))) continue
    kept.push({
      sessionId: session.id,
      taskId: session.taskId ?? null,
      title: session.title,
      discardedAt: session.discardedAt ?? session.lastUpdate
    })
  }
  return kept.sort((a, b) => b.discardedAt.localeCompare(a.discardedAt))
}

/**
 * Bring back (§3.3): recreates the copy from the kept work and puts the task
 * back up for review, as it was before it was discarded.
 */
export async function bringBackTaskWork(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string
): Promise<HarnessSession> {
  const state = ctx.loadState(project.id) ?? emptyState()
  const session = requireSession(state, sessionId)
  const ref = session.discardedRef
  if (!ref || !session.workspace) throw new Refusal(t('errors:history.nothingToBringBack'))
  const task = state.tasks.find((candidate) => candidate.id === session.taskId)
  if (
    task &&
    (task.status === 'claimed' ||
      (task.status === 'complete' && task.claimedBy !== sessionId) ||
      task.copy?.hasWork)
  ) {
    throw new Refusal(t('errors:history.taskHasNewerWork', { title: task.title }))
  }
  const git = repositoryGit(project)
  if (!(await refExists(git, ref))) throw new Refusal(t('errors:history.nothingToBringBack'))
  const workspace: HarnessWorkspace = {
    ...session.workspace,
    worktreePath: copyPathFor(ctx, project.id, slugOf(session.workspace)),
    closed: false
  }
  // The queue prepared a fresh copy for the task after the discard, on the
  // same version and folder: it holds no work, so it makes way first.
  if (task?.copy) await removeCopy(git, task.copy)
  await git.raw(['worktree', 'prune'])
  await git.raw(['worktree', 'add', workspace.worktreePath, '-B', workspace.branchName, ref])
  await git.raw(['update-ref', '-d', ref])

  let updated: StoredSession | undefined
  ctx.mutate(project, (next) => {
    updated = requireSession(next, sessionId)
    updated.workspace = workspace
    updated.statusNote = 'Brought back for review'
    updated.lastUpdate = new Date().toISOString()
    updated.endedAs = 'in_review'
    delete updated.discardedRef
    delete updated.discardedAt
    const stored = next.tasks.find((candidate) => candidate.id === session.taskId)
    if (stored) {
      stored.status = 'complete'
      stored.claimedBy = sessionId
      delete stored.copy
    }
  })
  if (!updated) throw new Error('Session update failed')
  ctx.recordEvent(project, 'session_start', updated, `Brought back "${updated.title}" for review`)
  return toSession(updated)
}
