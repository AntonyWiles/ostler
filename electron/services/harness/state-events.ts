import type { AgentEventInput } from '../agent-events'
import {
  reviewSessionsAwaitingDecision,
  type StoredHarnessState,
  type StoredSession
} from './types'

const sessionTaskId = (session: StoredSession): string | undefined =>
  session.taskId ?? session.assignedTaskId ?? undefined

/**
 * The agent events (D41) one write of the harness state makes, read from the
 * difference between the state before and after it. Every write goes through
 * `saveState`, so the app, the harness API, the automation API and the
 * embedded runner all raise the same events by the same rule, without each
 * write path having to remember to.
 */
export function harnessStateEvents(
  before: StoredHarnessState | null,
  after: StoredHarnessState
): AgentEventInput[] {
  const events: AgentEventInput[] = []
  const previousSessions = new Map((before?.sessions ?? []).map((s) => [s.id, s]))
  const reviewBefore = new Set(
    before ? reviewSessionsAwaitingDecision(before).map((session) => session.id) : []
  )
  const reviewAfter = new Set(reviewSessionsAwaitingDecision(after).map((session) => session.id))

  for (const session of after.sessions) {
    const run = { sessionId: session.id, taskId: sessionTaskId(session) }
    const previous = previousSessions.get(session.id)
    // Plan first (N9.3a): a new plan version, then the person's decision on it.
    if (session.plan && session.plan.version !== previous?.plan?.version) {
      events.push({ type: 'plan.submitted', ...run })
    } else if (previous?.plan?.status === 'pending' && session.plan?.status !== 'pending') {
      events.push({ type: 'plan.decided', ...run })
    }
    if (!previous) {
      events.push({ type: 'run.started', ...run })
      if (session.status === 'done') {
        events.push({ type: reviewAfter.has(session.id) ? 'run.review' : 'run.ended', ...run })
      }
      continue
    }
    if (previous.status !== 'done' && session.status === 'done') {
      events.push({ type: reviewAfter.has(session.id) ? 'run.review' : 'run.ended', ...run })
    } else if (reviewBefore.has(session.id) && !reviewAfter.has(session.id)) {
      // Accepted, discarded or sent back: the run is over.
      events.push({ type: 'run.ended', ...run })
    } else if (
      session.status !== 'done' &&
      (previous.status !== session.status || previous.statusNote !== session.statusNote)
    ) {
      events.push({ type: 'run.updated', ...run })
    }
  }

  const previousQuestions = new Map((before?.questions ?? []).map((q) => [q.id, q]))
  for (const question of after.questions) {
    const previous = previousQuestions.get(question.id)
    const fields = { sessionId: question.sessionId, questionId: question.id }
    if (!previous) events.push({ type: 'question.asked', ...fields })
    if (question.status === 'answered' && previous?.status !== 'answered') {
      events.push({ type: 'question.answered', ...fields })
    }
  }

  const previousTasks = new Map((before?.tasks ?? []).map((task) => [task.id, task]))
  for (const task of after.tasks) {
    const previous = previousTasks.get(task.id)
    const fields = {
      taskId: task.id,
      ...(task.planningWorkItemId ? { workItemId: task.planningWorkItemId } : {})
    }
    if (!previous) {
      events.push({ type: 'task.queued', ...fields })
      continue
    }
    if (previous.status !== 'claimed' && task.status === 'claimed') {
      events.push({ type: 'task.claimed', ...fields, sessionId: task.claimedBy ?? undefined })
    } else if (previous.status === 'claimed' && task.status === 'pending') {
      events.push({ type: 'task.released', ...fields, sessionId: previous.claimedBy ?? undefined })
    }
  }

  const previousGuidance = new Map((before?.guidance ?? []).map((entry) => [entry.id, entry]))
  for (const entry of after.guidance) {
    const previous = previousGuidance.get(entry.id)
    const fields = { sessionId: entry.sessionId, guidanceId: entry.id }
    if (!previous) events.push({ type: 'guidance.sent', ...fields, text: entry.text })
    if (entry.deliveredAt && !previous?.deliveredAt) {
      events.push({ type: 'guidance.delivered', ...fields })
    }
  }

  return events
}
