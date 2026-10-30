import { randomUUID } from 'crypto'
import { isOwnTaskBranch, taskBranchSlug } from '@shared/legacy-names'
import type {
  AgentRunRecordOutcome,
  HarnessEmbeddedRuntime,
  HarnessAttachmentFetch,
  HarnessAttachmentGiven,
  HarnessSession,
  HarnessTask,
  HarnessTaskReport,
  HarnessWorkspace,
  SessionTranscriptEntry,
  WatchedProject,
  WorkspaceSetupRecord
} from '@shared/ostler-api'
import type { HarnessContext } from './context'
import {
  emptyState,
  generateSessionToken,
  requireSession,
  toSession,
  type StoredHarnessState,
  type StoredSession,
  type StoredTask
} from './types'
import { prepareTaskCopy, refreshCopyForStart, taskSlug } from './task-copies'
import type { HistoryOptions } from '../project-history'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'

/**
 * Starts an agent on a queued task (§2.3): Ostler claims the task and starts the
 * session together, and the agent works in the task's copy. Embedded and
 * external agents start the same way and have the same rights. A copy still
 * getting ready is refused; a task with no copy yet gets one first.
 */
export async function startSessionForTask(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string,
  history: HistoryOptions,
  provenance: 'external' | 'embedded' = 'external'
): Promise<HarnessSession> {
  const task = requirePendingTask(ctx, project, taskId)
  let copy = task.copy
  // No copy yet, one left half-made when Ostler quit, or one that failed: make it now.
  const interrupted = copy?.state === 'preparing' && !ctx.preparingCopies.has(taskId)
  const retry = copy?.state === 'failed' && !copy.hasWork
  if (!copy || interrupted || retry) copy = await prepareTaskCopy(ctx, project, taskId, history)
  if (copy.state === 'preparing') {
    throw new Refusal(t('errors:history.copyGettingReady', { title: task.title }))
  }
  if (copy.state === 'ready') copy = await refreshCopyForStart(ctx, project, taskId, copy)
  if (copy.state === 'failed') {
    throw new Refusal(
      t('errors:history.copyFailed', { title: task.title, reason: copy.failure ?? '' })
    )
  }

  const id = randomUUID()
  const now = new Date().toISOString()
  const workspace: HarnessWorkspace = {
    branchName: copy.branchName,
    worktreePath: copy.worktreePath,
    baseBranch: copy.baseBranch,
    baseCommit: copy.baseCommit,
    ...(copy.setup ? { setup: copy.setup } : {}),
    ...(copy.detached ? { detached: true } : {})
  }
  let session: StoredSession | undefined
  ctx.mutate(project, (state) => {
    const stored = state.tasks.find((item) => item.id === taskId)
    if (!stored || stored.status !== 'pending' || stored.claimedBy) {
      throw new Error(`Task "${task.title}" is no longer available to start`)
    }
    stored.status = 'claimed'
    stored.claimedBy = id
    delete stored.copy
    session = {
      id,
      title: stored.title.trim() || `Agent ${id.slice(0, 8)}`,
      overview: stored.details.trim(),
      startedAt: now,
      lastUpdate: now,
      statusNote: '',
      status: 'active',
      assignedTaskId: null,
      taskId: stored.id,
      workspace,
      token: generateSessionToken(),
      lastSeenAt: null,
      provenance,
      // A review run (N9.5a) carries what it reviews, so every path can tell.
      ...(stored.reviewOf ? { reviewOf: stored.reviewOf } : {})
    }
    state.sessions.push(session)
  })
  if (!session) throw new Error('Session start failed')
  ctx.recordEvent(project, 'session_start', session, `Started session: ${session.title}`)
  ctx.recordEvent(project, 'task_claimed', session, `claimed task ${taskId}`)
  return toSession(session)
}

function requirePendingTask(
  ctx: HarnessContext,
  project: WatchedProject,
  taskId: string
): StoredTask {
  const task = (ctx.loadState(project.id) ?? emptyState()).tasks.find((item) => item.id === taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (task.status !== 'pending' || task.claimedBy) {
    throw new Error(`Task "${task.title}" is no longer available to start`)
  }
  return task
}

/** The setup record of a session's copy. Setup finishes before an agent starts (§2.1). */
export function workspaceSetupRecord(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string
): WorkspaceSetupRecord {
  const session = (ctx.loadState(project.id) ?? emptyState()).sessions.find(
    (item) => item.id === sessionId
  )
  const setup = session?.workspace?.setup ?? { status: 'skipped' }
  // Setup finishes while the copy is prepared, before a session starts: a
  // session still reading "running" was interrupted (Ostler quit mid-setup).
  return setup.status === 'running' ? { ...setup, status: 'cancelled' } : setup
}

/**
 * Authenticates a bearer token against a project: an active session's own
 * password, made when Ostler started it for one task (§2.3). There is no
 * project-wide password. Returns the session, so the caller can record that
 * it connected. A session's password stops working when it ends.
 */
export function resolveToken(
  ctx: HarnessContext,
  project: WatchedProject,
  token: string
): { valid: boolean; sessionId: string | null; expiredSessionId: string | null } {
  if (!token) return { valid: false, sessionId: null, expiredSessionId: null }
  const state = ctx.loadState(project.id) ?? emptyState()
  const session = state.sessions.find((item) => item.status !== 'done' && item.token === token)
  if (session) return { valid: true, sessionId: session.id, expiredSessionId: null }

  // Keep completed tokens revoked, but tell a legitimate agent that it is
  // retrying a final request after the session already ended. This avoids
  // wasting time (and tokens) treating a completed session as a bad bearer
  // credential and attempting unrelated curl workarounds.
  const expiredSession = state.sessions.find(
    (item) => item.status === 'done' && item.token === token
  )
  if (expiredSession) {
    return { valid: false, sessionId: null, expiredSessionId: expiredSession.id }
  }
  return { valid: false, sessionId: null, expiredSessionId: null }
}

/** Records that an agent with a session password connected. */
export function touchSessionConnection(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string
): void {
  ctx.mutate(project, (state) => {
    const session = state.sessions.find((item) => item.id === sessionId)
    if (session) session.lastSeenAt = new Date().toISOString()
  })
}

/**
 * Records the opencode process backing an embedded session, once
 * `OpenCodeRunnerService` has actually launched it and created its opencode
 * session. Only valid for `provenance: 'embedded'` sessions.
 */
export function setEmbeddedRuntime(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  embeddedRuntime: HarnessEmbeddedRuntime
): HarnessSession {
  let updated: StoredSession | undefined
  ctx.mutate(project, (state) => {
    updated = requireSession(state, sessionId)
    if (updated.provenance !== 'embedded') {
      throw new Error(`Session ${sessionId} is not an embedded session`)
    }
    updated.embeddedRuntime = embeddedRuntime
    updated.lastUpdate = new Date().toISOString()
  })
  if (!updated) throw new Error('Session update failed')
  return toSession(updated)
}

/**
 * Records which library attachments, at which revisions, a coding session was
 * given: an embedded session at start, an external one when it takes the
 * task. On the session for review, and as a harness event. Handing the same
 * list again (an agent re-reading its index) records nothing new.
 */
export function recordAttachmentsGiven(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  attachments: HarnessAttachmentGiven[]
): HarnessSession {
  let updated: StoredSession | undefined
  ctx.mutate(project, (state) => {
    const session = requireSession(state, sessionId)
    if (sameAttachments(session.attachmentsGiven ?? [], attachments)) return
    session.attachmentsGiven = attachments
    session.lastUpdate = new Date().toISOString()
    updated = session
  })
  if (!updated) {
    return toSession(requireSession(ctx.loadState(project.id) ?? emptyState(), sessionId))
  }
  ctx.recordEvent(
    project,
    'session_start',
    updated,
    `Attachments given: ${attachments
      .map((entry) => `${entry.libraryItemId} r${entry.revision} (${entry.attachedBy})`)
      .join(', ')}`
  )
  return toSession(updated)
}

function sameAttachments(a: HarnessAttachmentGiven[], b: HarnessAttachmentGiven[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.libraryItemId === b[index].libraryItemId && entry.revision === b[index].revision
    )
  )
}

const MAX_ATTACHMENT_FETCHES = 200

/** Records one download of a task attachment by an external session, on the session and as an event. */
export function recordAttachmentFetch(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  fetch: Omit<HarnessAttachmentFetch, 'fetchedAt'>
): void {
  let updated: StoredSession | undefined
  ctx.mutate(project, (state) => {
    updated = requireSession(state, sessionId)
    updated.attachmentFetches = [
      ...(updated.attachmentFetches ?? []),
      { ...fetch, fetchedAt: new Date().toISOString() }
    ].slice(-MAX_ATTACHMENT_FETCHES)
  })
  if (!updated) return
  ctx.recordEvent(
    project,
    'attachment_fetched',
    updated,
    `Fetched attachment ${fetch.libraryItemId} r${fetch.revision} (${fetch.form})`
  )
}

export function updateSession(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  note: string,
  done: boolean,
  report: HarnessTaskReport | null = null,
  /** How the run ended, for the run history (R5.3); worked out from the report when left out. */
  endedAs?: AgentRunRecordOutcome
): HarnessSession {
  let updated: StoredSession | undefined
  const completedTaskIds: string[] = []
  const reportedTaskIds: string[] = []
  ctx.mutate(project, (state) => {
    updated = requireSession(state, sessionId)
    updated.statusNote = note.trim()
    updated.status = done ? 'done' : 'active'
    updated.lastUpdate = new Date().toISOString()
    if (done) {
      updated.endedAs = endedAs ?? completedRunEndedAs(updated, report)
      completedTaskIds.push(...settleSessionTasks(state, sessionId, 'complete', report))
      reportedTaskIds.push(...reportedTasks(state, completedTaskIds, report))
    }
  })
  if (!updated) throw new Error('Session update failed')
  ctx.recordEvent(
    project,
    done ? 'session_end' : 'session_start',
    updated,
    done ? `Completed session: ${updated.title}` : `Updated session: ${updated.title}`
  )
  for (const taskId of completedTaskIds) {
    ctx.recordEvent(
      project,
      'task_complete',
      updated,
      `Completed task ${taskId} when session completed`
    )
    if (reportedTaskIds.includes(taskId)) recordReportSubmitted(ctx, project, updated, taskId)
  }
  return toSession(updated)
}

/**
 * How a run that ended with its task settled ended: what its report says,
 * else waiting for review when it has a workspace to review. A session with
 * no workspace has nothing to review, so its completed task is its verdict.
 */
export function completedRunEndedAs(
  session: Pick<StoredSession, 'workspace'>,
  report: HarnessTaskReport | null
): AgentRunRecordOutcome {
  if (report?.outcome === 'unreported') return 'unreported'
  if (report?.outcome === 'abandoned') return 'abandoned'
  return session.workspace ? 'in_review' : 'accepted'
}

export function completeSessionWithAutoContinuation(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  note: string,
  completedTaskId: string | null,
  report: HarnessTaskReport | null = null,
  /** The copy's state where the completed task finished, so Apply can add one entry per task (§3.2). */
  finishedAt: string | null = null
): { session: HarnessSession; nextTask: HarnessTask | null } {
  let updated: StoredSession | undefined
  let nextTask: StoredTask | undefined
  const completedTaskIds: string[] = []
  const reportedTaskIds: string[] = []
  ctx.mutate(project, (state) => {
    updated = requireSession(state, sessionId)
    const ownedTask = state.tasks.find(
      (task) => task.status === 'claimed' && task.claimedBy === sessionId
    )
    if (completedTaskId && ownedTask?.id !== completedTaskId) {
      throw new Error(
        `Completion task mismatch: session currently owns ${ownedTask?.id ?? 'no task'}`
      )
    }
    updated.statusNote = note.trim()
    updated.lastUpdate = new Date().toISOString()
    completedTaskIds.push(...settleSessionTasks(state, sessionId, 'complete', report))
    reportedTaskIds.push(...reportedTasks(state, completedTaskIds, report))
    // Auto-continuation used to take the first pending auto-continue task
    // whatever its dependencies said, which is exactly the case this queue is
    // meant to handle: the task ahead has only just completed.
    nextTask = completedTaskId
      ? state.tasks.find(
          (task) =>
            task.status === 'pending' &&
            !task.claimedBy &&
            !task.hold &&
            task.autoContinue &&
            // Same session, same workspace: work it just finished counts as
            // available to the next task even before that branch is merged.
            ctx.isTaskDispatchable(project.id, task.planningWorkItemId, sessionId)
        )
      : undefined
    if (nextTask) {
      nextTask.status = 'claimed'
      nextTask.claimedBy = sessionId
      // It continues in this session's copy; its own unused copy is tidied away.
      if (nextTask.copy && !nextTask.copy.hasWork) delete nextTask.copy
      if (updated.workspace && completedTaskId && finishedAt) {
        const finished = state.tasks.find((task) => task.id === completedTaskId)
        updated.workspace.taskMarks = [
          ...(updated.workspace.taskMarks ?? []),
          { taskId: completedTaskId, title: finished?.title ?? completedTaskId, commit: finishedAt }
        ]
      }
      updated.status = 'active'
      updated.statusNote = `Auto-continued to: ${nextTask.title}`
      updated.assignedTaskId = null
      updated.taskId = nextTask.id
      delete updated.endedAs
    } else {
      updated.status = 'done'
      updated.endedAs = completedRunEndedAs(updated, report)
    }
  })
  if (!updated) throw new Error('Session completion failed')
  for (const taskId of completedTaskIds) {
    ctx.recordEvent(
      project,
      'task_complete',
      updated,
      `Completed task ${taskId} when session completed`
    )
    if (reportedTaskIds.includes(taskId)) recordReportSubmitted(ctx, project, updated, taskId)
  }
  if (nextTask) {
    ctx.recordEvent(
      project,
      'task_claimed',
      updated,
      `Auto-continued to task ${nextTask.id} with existing session token`
    )
  } else {
    ctx.recordEvent(project, 'session_end', updated, `Completed session: ${updated.title}`)
  }
  return { session: toSession(updated), nextTask: nextTask ? { ...nextTask } : null }
}

/** Settled tasks that took the report: only claimed work completes with one. */
function reportedTasks(
  state: StoredHarnessState,
  settledIds: string[],
  report: HarnessTaskReport | null
): string[] {
  if (!report) return []
  return state.tasks
    .filter((task) => settledIds.includes(task.id) && task.report === report)
    .map((task) => task.id)
}

/** The task's activity says the agent filed its report (P5.2). */
function recordReportSubmitted(
  ctx: HarnessContext,
  project: WatchedProject,
  session: StoredSession,
  taskId: string
): void {
  ctx.recordEvent(
    project,
    'task_report_submitted',
    session,
    `Submitted a report for task ${taskId}`
  )
}

export function settleSessionTasks(
  state: StoredHarnessState,
  sessionId: string,
  outcome: 'complete' | 'release',
  report: HarnessTaskReport | null = null
): string[] {
  const settled: string[] = []
  for (const task of state.tasks) {
    if (task.status !== 'claimed' || task.claimedBy !== sessionId) continue
    task.status = outcome === 'complete' ? 'complete' : 'pending'
    task.claimedBy = outcome === 'complete' ? sessionId : null
    if (outcome === 'complete' && report) task.report = report
    settled.push(task.id)
  }
  return settled
}

/**
 * Marks a session done because it failed to start/run, releasing any claimed
 * task back to pending instead of completing it. The task takes the copy
 * back, work and all, so the next run carries on from it -- the same as Send
 * back. Left in review, the copy would share its name with the one the queue
 * prepares for the task again.
 */
export function failSession(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  note: string,
  /** How the run ended, for the run history (R5.3). */
  endedAs: AgentRunRecordOutcome = 'failed'
): HarnessSession {
  let updated: StoredSession | undefined
  ctx.mutate(project, (state) => {
    updated = requireSession(state, sessionId)
    updated.statusNote = note.trim()
    updated.status = 'done'
    updated.endedAs = endedAs
    updated.lastUpdate = new Date().toISOString()
    const released = settleSessionTasks(state, sessionId, 'release')
    const workspace = updated.workspace
    if (!workspace || workspace.closed) return
    const task = state.tasks.find(
      (candidate) =>
        released.includes(candidate.id) &&
        isOwnTaskBranch(workspace.branchName) &&
        taskBranchSlug(workspace.branchName) === taskSlug(candidate)
    )
    if (!task) return
    const { taskMarks, closed, ...copy } = workspace
    void taskMarks
    void closed
    task.copy = { ...copy, state: 'ready', preparedAt: updated.lastUpdate, hasWork: true }
    workspace.closed = true
  })
  if (!updated) throw new Error('Session update failed')
  ctx.recordEvent(project, 'session_end', updated, `Session failed: ${updated.title}`)
  return toSession(updated)
}

/**
 * Entries kept per transcript. The default bounds what an untrusted external
 * agent can push into the database over HTTP; Ostler's own recording of a
 * session it runs raises it, because truncating there would keep only the
 * opening minutes of a long run.
 */
const EXTERNAL_TRANSCRIPT_LIMIT = 100

export function recordSessionTranscript(
  ctx: HarnessContext,
  project: WatchedProject,
  sessionId: string,
  entries: SessionTranscriptEntry[],
  limit: number = EXTERNAL_TRANSCRIPT_LIMIT,
  replace = false
): { accepted: number } {
  const state = ctx.loadState(project.id) ?? emptyState()
  const session = state.sessions.find((item) => item.id === sessionId && item.status !== 'done')
  if (!session) throw new Error('Session not found or already ended')
  const normalized = entries
    .filter((entry) => entry && ['user', 'assistant', 'tool', 'system'].includes(entry.role))
    .map((entry) => ({
      role: entry.role,
      content: String(entry.content || '').slice(0, 20_000),
      timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString()
    }))
    .filter((entry) => entry.content.trim())
    .slice(0, Math.max(1, limit))
  if (!normalized.length) throw new Error('Transcript needs at least one non-empty entry')
  const transcript = {
    projectId: project.id,
    sessionId,
    receivedAt: new Date().toISOString(),
    entries: normalized
  }
  if (replace) ctx.database.replaceSessionTranscript(transcript)
  else ctx.database.insertSessionTranscript(transcript)
  return { accepted: normalized.length }
}
