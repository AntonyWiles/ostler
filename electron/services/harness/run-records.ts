import type { AgentRunRecordOutcome } from '@shared/ostler-api'
import type { AgentRunInput } from '../database/agent-run-repository'
import type { StoredHarnessState, StoredSession } from './types'

/**
 * The run history's records, read from the harness state (R5.3, D43).
 *
 * Every way a run ends -- a finish, a stop, a stall, a failure, Stop all AI,
 * a person's review -- is a write of the harness state, so a record derived
 * from each write is written on every exit path without any path having to
 * remember to write it.
 */

/** The verdict a review wrote into the session's note (see task-review.ts). */
function verdictOf(statusNote: string): AgentRunRecordOutcome | null {
  if (/^(Merged|Accepted|Applied|Nothing changed)/.test(statusNote)) return 'accepted'
  if (/^Discarded/.test(statusNote)) return 'discarded'
  if (/^(Rejected|Sent back)/.test(statusNote)) return 'rejected'
  return null
}

/**
 * How a run ended when the session does not say (it ended before the run
 * history existed): read from what the runner recorded.
 */
export function legacyEndedAs(session: StoredSession): AgentRunRecordOutcome {
  switch (session.embeddedRuntime?.stopReason) {
    case 'unreported':
      return 'unreported'
    case 'abandoned':
      return 'abandoned'
    case 'manual':
    case 'limit':
    case 'tool_call_rate_exceeded':
      return 'stopped'
    case 'blocked':
    case 'no-response':
    case 'error':
    case 'timeout':
    case 'stalled':
      return 'failed'
  }
  if (/^Force-ended/.test(session.statusNote)) return 'stopped'
  if (/fail/i.test(session.statusNote)) return 'failed'
  return session.workspace ? 'in_review' : 'accepted'
}

function count(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null
}

/** The record for one session, or null while it is still running. */
export function runRecordFor(
  projectId: string,
  state: StoredHarnessState,
  session: StoredSession
): AgentRunInput | null {
  if (session.status !== 'done') return null
  const taskId = session.taskId ?? session.assignedTaskId ?? null
  const task = taskId ? state.tasks.find((candidate) => candidate.id === taskId) : undefined
  const report = task?.claimedBy === session.id ? task.report : undefined
  const runtime = session.embeddedRuntime
  const measuredIn = count(runtime?.usage?.inputTokens)
  const measuredOut = count(runtime?.usage?.outputTokens)
  const measured = measuredIn !== null || measuredOut !== null
  const reportedIn = count(report?.usage?.inputTokens)
  const reportedOut = count(report?.usage?.outputTokens)
  const reported = !measured && (reportedIn !== null || reportedOut !== null)
  const endedAs = session.endedAs ?? legacyEndedAs(session)
  const startedAt = Date.parse(session.startedAt)
  const endedAt = Date.parse(session.lastUpdate)
  return {
    sessionId: session.id,
    projectId,
    taskId,
    title: task?.title ?? session.title,
    provenance: session.provenance ?? 'external',
    model: runtime?.model ?? report?.usage?.model ?? null,
    effort: runtime?.effort ?? null,
    startedAt: Number.isFinite(startedAt) ? startedAt : endedAt,
    endedAt: Number.isFinite(endedAt) ? endedAt : startedAt,
    outcome: verdictOf(session.statusNote) ?? endedAs,
    endedAs,
    detail: session.statusNote,
    stalls: runtime?.stallAborts ?? 0,
    nudges: runtime?.nudgeCount ?? 0,
    guidance: state.guidance.filter((message) => message.sessionId === session.id).length,
    commits: null,
    filesChanged: report ? report.filesChanged.length : null,
    inputTokens: measured ? measuredIn : reported ? reportedIn : null,
    outputTokens: measured ? measuredOut : reported ? reportedOut : null,
    usageReported: reported
  }
}

/**
 * The records a state write changed: runs that ended in it, and ended runs
 * whose record reads differently now (a review's verdict, a late usage sync).
 * `newlyEnded` lists the sessions that ended in this write.
 */
export function changedRunRecords(
  projectId: string,
  before: StoredHarnessState | null,
  after: StoredHarnessState
): { records: AgentRunInput[]; newlyEnded: string[] } {
  const records: AgentRunInput[] = []
  const newlyEnded: string[] = []
  const previous = new Map((before?.sessions ?? []).map((session) => [session.id, session]))
  for (const session of after.sessions) {
    const record = runRecordFor(projectId, after, session)
    if (!record) continue
    const old = previous.get(session.id)
    const oldRecord = old && before ? runRecordFor(projectId, before, old) : null
    if (!oldRecord) newlyEnded.push(session.id)
    if (oldRecord && JSON.stringify(oldRecord) === JSON.stringify(record)) continue
    records.push(record)
  }
  return { records, newlyEnded }
}
