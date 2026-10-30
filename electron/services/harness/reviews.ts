import { randomUUID } from 'crypto'
import type {
  HarnessReviewerReport,
  HarnessReviewFinding,
  HarnessSession,
  HarnessTask,
  HarnessTaskReport,
  WatchedProject
} from '@shared/ostler-api'
import { requireProjectFolder } from '@shared/project-folder'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import { parseUnifiedDiff } from '@shared/diff/unified-diff'
import {
  buildReviewDetails,
  checkFindings,
  MAX_REVIEWS_KEPT,
  parseFindingRequests,
  REVIEWER_DID_NOT_REPORT,
  REVIEWER_RUNS_AVAILABLE,
  withoutFindingRequests
} from '@shared/reviewer-runs'
import { currentVersion } from '../project-history'
import type { HarnessContext } from './context'
import {
  emptyState,
  requireSession,
  reviewSessionsAwaitingDecision,
  toSession,
  type StoredHarnessState,
  type StoredSession,
  type StoredTask
} from './types'
import { commitCopyLeftovers, hasWorktreeLink, removeCopy, repositoryGit } from './task-copies'

/**
 * Reviewer runs (N9.5a, decision N63). A review is an ordinary harness task,
 * marked `reviewOf` the session it reviews, queued ahead of ordinary work and
 * taken by an embedded or external agent like any task. Its copy is detached
 * at the reviewed change's last commit, has no version of its own, and is
 * removed when the review ends: nothing a reviewer does can land. Its findings
 * are kept with the reviewed session as the reviewer's words, never sent to
 * the first agent by Ostler.
 */

/** The note on a review stopped because the task it reviews was applied, sent back, discarded or stopped. */
export const REVIEW_STOPPED_NOTE = 'Stopped: the reviewed task ended'

/** How a review run ended. */
export type ReviewEnding =
  | { outcome: 'reported'; report: HarnessTaskReport; note: string }
  | { outcome: 'not-reported'; note: string }
  | { outcome: 'stopped'; note: string }

/** A session's review that is queued or running, if any: at most one at a time. */
export function openReviewTask(
  state: StoredHarnessState,
  reviewedSessionId: string
): StoredTask | undefined {
  return state.tasks.find(
    (task) =>
      task.reviewOf?.sessionId === reviewedSessionId &&
      (task.status === 'pending' || task.status === 'claimed')
  )
}

/** Whether a session is a review run. */
export function isReviewRun(state: StoredHarnessState, sessionId: string): boolean {
  return Boolean(state.sessions.find((session) => session.id === sessionId)?.reviewOf)
}

/**
 * Starts a review of a session in review: a harness task holding the reviewed
 * task's text, the session's report and the reviewer's instructions, queued
 * first. The reviewed copy's unsaved leftovers are saved on its own version
 * first, so the review sees the whole change. Refused while reviewer runs are
 * unavailable. With `onlyWithChanges` (Review agent work before me, N9.5b), a
 * session whose copy holds no change starts none and this returns null.
 */
export async function startReview(
  ctx: HarnessContext,
  project: WatchedProject,
  reviewedSessionId: string,
  options: { onlyWithChanges: true }
): Promise<HarnessTask | null>
export async function startReview(
  ctx: HarnessContext,
  project: WatchedProject,
  reviewedSessionId: string
): Promise<HarnessTask>
export async function startReview(
  ctx: HarnessContext,
  project: WatchedProject,
  reviewedSessionId: string,
  options: { onlyWithChanges?: boolean } = {}
): Promise<HarnessTask | null> {
  if (!REVIEWER_RUNS_AVAILABLE) throw new Refusal('Reviewer runs are not available')
  const state = ctx.loadState(project.id) ?? emptyState()
  const session = requireSession(state, reviewedSessionId)
  if (session.reviewOf) throw new Refusal('A review run cannot itself be reviewed')
  if (!reviewSessionsAwaitingDecision(state).some((item) => item.id === reviewedSessionId)) {
    throw new Refusal('Only work waiting for review can be reviewed')
  }
  if (openReviewTask(state, reviewedSessionId)) {
    throw new Refusal('This work already has a review queued or running')
  }
  const workspace = session.workspace!
  if (hasWorktreeLink(workspace.worktreePath)) {
    await commitCopyLeftovers(
      workspace.worktreePath,
      t('projects:history.agentLeftovers', { title: session.title })
    )
  }
  const git = repositoryGit(project)
  const headCommit = (await git.raw(['rev-parse', workspace.branchName])).trim()
  // Measured the way Review changes measures it: from where the copy and the
  // folder last agreed.
  let baseCommit = workspace.baseCommit
  try {
    const folderHead = (await currentVersion(requireProjectFolder(project, 'Starting a review')))
      .commit
    if (folderHead) baseCommit = (await git.raw(['merge-base', folderHead, headCommit])).trim()
  } catch {
    // Unrelated histories: from where the copy started.
  }
  if (options.onlyWithChanges && baseCommit === headCommit) return null
  const reviewedTask = state.tasks.find((task) => task.id === session.taskId)
  const report = reviewedTask?.report ?? null
  const task: StoredTask = {
    id: randomUUID().replace(/-/g, '').slice(0, 8),
    title: `Review: ${session.title}`.slice(0, 200),
    details: buildReviewDetails({
      sessionTitle: session.title,
      taskDetails: reviewedTask?.details ?? session.overview,
      reportSummary: report?.summary ?? null,
      reportFiles: report?.filesChanged ?? [],
      baseCommit,
      headCommit
    }),
    status: 'pending',
    claimedBy: null,
    priority: reviewedTask?.priority ?? 'medium',
    planningWorkItemId: null,
    autoContinue: false,
    hold: false,
    reviewOf: { sessionId: reviewedSessionId, baseCommit, headCommit }
  }
  ctx.mutate(project, (next) => {
    if (openReviewTask(next, reviewedSessionId)) {
      throw new Refusal('This work already has a review queued or running')
    }
    // Ahead of ordinary work: before the first queued task.
    const first = next.tasks.findIndex((candidate) => candidate.status === 'pending')
    if (first === -1) next.tasks.push(task)
    else next.tasks.splice(first, 0, task)
    // The 30-minute wait in Needs you counts from here (N9.5b).
    const reviewed = next.sessions.find((candidate) => candidate.id === reviewedSessionId)
    if (reviewed) reviewed.reviewRequestedAt = new Date().toISOString()
  })
  ctx.recordEvent(
    project,
    'task_queued',
    { id: 'human', title: 'human' },
    `queued review ${task.id} of session ${reviewedSessionId}`
  )
  return { ...task }
}

/** The reviewed diff, from the review's base to its head commit; empty when Git no longer has them. */
async function reviewedPatch(
  project: WatchedProject,
  reviewOf: NonNullable<StoredSession['reviewOf']>
): Promise<string> {
  try {
    return await repositoryGit(project).raw([
      'diff',
      '--no-ext-diff',
      '--unified=3',
      reviewOf.baseCommit,
      reviewOf.headCommit
    ])
  } catch {
    return ''
  }
}

/**
 * Ends a review run, however it ended: checks the reviewer's findings against
 * the reviewed diff and keeps them with the reviewed session, closes the run
 * (never in review, never applied), settles its task and removes its copy,
 * edits and commits and all. Does nothing for a run that has already ended.
 */
export async function endReviewRun(
  ctx: HarnessContext,
  project: WatchedProject,
  reviewerSessionId: string,
  ending: ReviewEnding
): Promise<HarnessSession> {
  const state = ctx.loadState(project.id) ?? emptyState()
  const reviewer = requireSession(state, reviewerSessionId)
  const reviewOf = reviewer.reviewOf
  if (!reviewOf) throw new Error(`Session ${reviewerSessionId} is not a review run`)
  if (hasEnded(reviewer)) return toSession(reviewer)

  let findings: HarnessReviewFinding[] = []
  let leftOut = 0
  if (ending.outcome === 'reported') {
    const parsed = parseFindingRequests(ending.report.findingRequests)
    leftOut = parsed.leftOut
    if (parsed.findings.length > 0) {
      const diff = parseUnifiedDiff(await reviewedPatch(project, reviewOf))
      findings = checkFindings(diff, parsed.findings, () => randomUUID())
    }
  }

  // Anything the reviewer edited or committed goes with its copy.
  const workspace = reviewer.workspace
  if (workspace && !workspace.closed) {
    try {
      await removeCopy(repositoryGit(project), workspace)
    } catch (error) {
      console.warn(
        `[HarnessService] Could not remove the review copy ${workspace.worktreePath}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  const endedAt = new Date().toISOString()
  const record: HarnessReviewerReport = {
    reviewerSessionId,
    reviewTaskId: reviewer.taskId ?? '',
    provenance: reviewer.provenance ?? 'external',
    ...reviewerModel(reviewer, ending),
    startedAt: reviewer.startedAt,
    endedAt,
    outcome: ending.outcome,
    summary: ending.outcome === 'reported' ? ending.report.summary : REVIEWER_DID_NOT_REPORT,
    findings,
    ...(leftOut > 0 ? { findingsLeftOut: leftOut } : {})
  }
  let updated: StoredSession | undefined
  let recorded = false
  ctx.mutate(project, (next) => {
    updated = requireSession(next, reviewerSessionId)
    if (hasEnded(updated)) return
    recorded = true
    updated.status = 'done'
    updated.statusNote = ending.note.trim() || record.summary
    updated.endedAs =
      ending.outcome === 'stopped'
        ? 'stopped'
        : ending.outcome === 'reported'
          ? 'accepted'
          : 'unreported'
    updated.lastUpdate = endedAt
    if (updated.workspace) updated.workspace.closed = true
    for (const task of next.tasks) {
      if (task.id !== updated.taskId && task.claimedBy !== reviewerSessionId) continue
      if (!task.reviewOf) continue
      task.status = ending.outcome === 'stopped' ? 'cancelled' : 'complete'
      task.claimedBy = ending.outcome === 'stopped' ? null : reviewerSessionId
      if (ending.outcome === 'reported') task.report = withoutFindingRequests(ending.report)
      delete task.copy
    }
    const reviewed = next.sessions.find((session) => session.id === reviewOf.sessionId)
    if (reviewed) {
      reviewed.reviewerReports = [...(reviewed.reviewerReports ?? []), record].slice(
        -MAX_REVIEWS_KEPT
      )
    }
  })
  if (!updated) throw new Error('Session update failed')
  if (recorded) {
    ctx.recordEvent(
      project,
      'session_end',
      updated,
      `Review of session ${reviewOf.sessionId} ended (${ending.outcome}, ${findings.length} findings)`
    )
  }
  return toSession(updated)
}

/**
 * Dismisses one of the reviewer's findings on a session (N9.5b): it stays in
 * the record, marked dismissed, and no longer counts before Apply. Refused for
 * a finding the session's reviews do not hold.
 */
export function dismissFinding(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  findingId: string,
  dismissed: boolean
): HarnessSession {
  let updated: StoredSession | undefined
  ctx.mutate(project, (next) => {
    updated = requireSession(next, sessionId)
    const known = (updated.reviewerReports ?? []).some((report) =>
      report.findings.some((finding) => finding.id === findingId)
    )
    if (!known) throw new Refusal('No such reviewer finding on this session')
    const ids = new Set(updated.dismissedFindingIds ?? [])
    if (dismissed) ids.add(findingId)
    else ids.delete(findingId)
    updated.dismissedFindingIds = [...ids]
  })
  if (!updated) throw new Error('Session update failed')
  return toSession(updated)
}

/** A review run that has ended: done, its copy gone. */
function hasEnded(session: StoredSession): boolean {
  return session.status === 'done' && (!session.workspace || session.workspace.closed === true)
}

function reviewerModel(reviewer: StoredSession, ending: ReviewEnding): { model?: string } {
  const model =
    reviewer.embeddedRuntime?.model ??
    (ending.outcome === 'reported' ? ending.report.usage?.model : undefined)
  return model ? { model } : {}
}

/**
 * Stops the review of a session whose task was applied, sent back, discarded
 * or stopped (N9.5a): a queued review is cancelled and its copy removed; a
 * running one has its agent stopped (`stopRun`, the caller's) and is ended.
 */
export async function stopReviewsOf(
  ctx: HarnessContext,
  project: WatchedProject,
  reviewedSessionId: string,
  stopRun: (reviewerSessionId: string) => Promise<void>
): Promise<void> {
  const state = ctx.loadState(project.id) ?? emptyState()
  const task = openReviewTask(state, reviewedSessionId)
  if (!task) return
  if (task.status === 'pending') {
    const copy = task.copy
    if (copy && copy.state !== 'preparing') {
      try {
        await removeCopy(repositoryGit(project), copy)
      } catch (error) {
        console.warn(
          `[HarnessService] Could not remove the review copy ${copy.worktreePath}:`,
          error
        )
      }
    }
    ctx.mutate(project, (next) => {
      const stored = next.tasks.find((candidate) => candidate.id === task.id)
      if (!stored || stored.status !== 'pending') return
      stored.status = 'cancelled'
      // One still being made is tidied once it is ready (`tidyCopies`).
      if (stored.copy?.state !== 'preparing') delete stored.copy
    })
    ctx.recordEvent(
      project,
      'task_cancelled',
      { id: 'ostler', title: 'Ostler' },
      `cancelled review ${task.id}: the reviewed task ended`
    )
    return
  }
  if (task.claimedBy) {
    await stopRun(task.claimedBy)
    await endReviewRun(ctx, project, task.claimedBy, {
      outcome: 'stopped',
      note: REVIEW_STOPPED_NOTE
    })
  }
}
