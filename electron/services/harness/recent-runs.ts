import type { AgentRunOutcome, HarnessSession, RecentAgentRun } from '@shared/ostler-api'

/** The outcome a finished session's status note records (see git-worktree.ts). */
function outcomeOf(statusNote: string): AgentRunOutcome {
  if (/^(Merged|Accepted)/.test(statusNote)) return 'accepted'
  if (/^Discarded/.test(statusNote)) return 'discarded'
  if (/^Rejected/.test(statusNote)) return 'rejected'
  return 'ended'
}

/**
 * Finished agent runs, newest first: every session that is done and no
 * longer waiting for review. Running runs and runs in review are left out;
 * the Agents view shows those in their own sections.
 */
export function recentAgentRuns(
  sessions: Pick<
    HarnessSession,
    'id' | 'title' | 'status' | 'startedAt' | 'lastUpdate' | 'statusNote' | 'provenance' | 'taskId'
  >[],
  reviewSessionIds: ReadonlySet<string>,
  limit = 10
): RecentAgentRun[] {
  return sessions
    .filter((session) => session.status === 'done' && !reviewSessionIds.has(session.id))
    .map((session) => ({
      sessionId: session.id,
      title: session.title,
      taskId: session.taskId ?? null,
      provenance: session.provenance ?? 'external',
      startedAt: Date.parse(session.startedAt),
      endedAt: Date.parse(session.lastUpdate),
      outcome: outcomeOf(session.statusNote),
      detail: session.statusNote
    }))
    .sort((left, right) => right.endedAt - left.endedAt)
    .slice(0, limit)
}
