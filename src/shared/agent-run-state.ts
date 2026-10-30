import type { HarnessProjectState, HarnessSession, HarnessTask } from './ostler-api'
import { t } from './i18n'

/**
 * The one answer to "what state is this agent run in", in the words a person
 * sees. The Agents view and its queue, a task's agent run section, Home's
 * Needs you, the Inbox and notifications all go through this, in the style of
 * `projectWorkItemStatus`, so they cannot disagree with each other or with
 * the Board: a run whose work waits for review is In review everywhere, never
 * "Complete".
 *
 * - `queued`: waiting in the queue for an agent.
 * - `onHold`: held in the queue; nobody may take it (Blocked on the Board).
 * - `starting`: an agent has been given it and is connecting.
 * - `running`: an agent is working on it.
 * - `waitingForYou`: the agent asked a question and waits for the answer.
 * - `inReview`: the agent finished and its changes wait for Accept or Discard.
 *   This wins over a queued or complete task, because a failed run releases
 *   its task back to the queue while its session still waits in review.
 * - `accepted`: the work was accepted; the run is over.
 * - `cancelled`: taken out of the queue before it finished.
 */
export type AgentRunState =
  | 'queued'
  | 'onHold'
  | 'starting'
  | 'running'
  | 'waitingForYou'
  | 'inReview'
  | 'accepted'
  | 'cancelled'

/** Every state, in the order the queue lists them: work to act on first. */
export const AGENT_RUN_STATES: AgentRunState[] = [
  'waitingForYou',
  'inReview',
  'running',
  'starting',
  'queued',
  'onHold',
  'accepted',
  'cancelled'
]

/**
 * Whether this session is the one that was started for this task.
 *
 * `session.taskId` is the durable answer and must be tried first: when a run
 * fails, the task goes back to pending and `claimedBy` is cleared, but the
 * session stays in review with its copy. `claimedBy` remains the fallback
 * for sessions persisted before `taskId` existed.
 */
export function sessionOwnsTask(session: HarnessSession, task: HarnessTask): boolean {
  if (session.taskId) return session.taskId === task.id
  return task.claimedBy === session.id
}

type RunHarness = Pick<HarnessProjectState, 'activeSessions' | 'reviewSessions'>

/** The session working on, or waiting in review for, this task. Review first. */
export function runSessionForTask(
  task: HarnessTask,
  harness: RunHarness | null | undefined
): { session: HarnessSession; inReview: boolean } | null {
  const review = harness?.reviewSessions.find((session) => sessionOwnsTask(session, task))
  if (review) return { session: review, inReview: true }
  const active = harness?.activeSessions.find((session) => sessionOwnsTask(session, task))
  return active ? { session: active, inReview: false } : null
}

/** A queued task's run state, from the task and the sessions that own it. */
export function agentRunState(
  task: HarnessTask,
  harness: RunHarness | null | undefined
): AgentRunState {
  const owner = runSessionForTask(task, harness)
  // A task taken again after a failed run is the new run, whatever waits in review.
  if (task.status === 'claimed') {
    const active = harness?.activeSessions.find((session) => sessionOwnsTask(session, task))
    return active?.blocked ? 'waitingForYou' : 'running'
  }
  if (task.status === 'pending' && task.hold) return 'onHold'
  // Its copy is being made: "Getting ready" (simplify pass §2.1).
  if (task.status === 'pending' && task.copy?.state === 'preparing') return 'starting'
  if (owner?.inReview) return 'inReview'
  if (task.status === 'cancelled') return 'cancelled'
  if (task.status === 'complete') return 'accepted'
  return 'queued'
}

/**
 * A session's run state when there may be no task to go by (a bare session,
 * or one whose task has gone): blocked, working, or finished and in review.
 */
export function sessionRunState(
  session: HarnessSession,
  harness: Pick<HarnessProjectState, 'reviewSessions' | 'taskQueue'> &
    Partial<Pick<HarnessProjectState, 'activeSessions'>>
): AgentRunState {
  if (harness.reviewSessions.some((candidate) => candidate.id === session.id)) return 'inReview'
  const task = harness.taskQueue.find((candidate) => sessionOwnsTask(session, candidate))
  if (task)
    return agentRunState(task, {
      activeSessions: harness.activeSessions ?? [session],
      reviewSessions: harness.reviewSessions
    })
  if (session.status === 'done') return 'accepted'
  return session.blocked ? 'waitingForYou' : 'running'
}

/**
 * The words for a run's state. A queued run may say where it is in the queue:
 * "Next to start" for the first, "Queued #3" after that.
 */
export function agentRunStateLabel(state: AgentRunState, queuePosition?: number): string {
  if (state === 'queued' && queuePosition !== undefined && queuePosition >= 0)
    return queuePosition === 0
      ? t('agents:runState.nextToStart')
      : t('agents:runState.queuedAt', { number: queuePosition + 1 })
  return t(`agents:runState.${state}`)
}

/**
 * Whether a run waiting in review offers "Run again with…" (D42): it failed or
 * was abandoned, so its task went back to the queue while its work waits here.
 * A rejected run gets the same choice inside Reject.
 */
export function runCanRunAgain(session: HarnessSession, task: HarnessTask | undefined): boolean {
  return (
    session.status === 'done' &&
    Boolean(session.workspace) &&
    task?.status === 'pending' &&
    !task.claimedBy
  )
}
