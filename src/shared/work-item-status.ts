import type { HarnessProjectState, PlanningWorkItem, PlanningWorkItemStatus } from './ostler-api'
import { t } from './i18n'
import { agentRunState, sessionOwnsTask, type AgentRunState } from './agent-run-state'

// Re-exported: callers have always found it here.
export { sessionOwnsTask }

/**
 * Why this work item cannot be deleted right now, or null if it can. The one
 * rule for the Board menu, the desktop delete, and the automation API.
 *
 * Linked agent work blocks deletion only while it is still in flight: queued,
 * running, or finished but not yet merged/rejected/discarded. Once the work is
 * over -- cancelled, or completed and out of review -- the item is history and
 * can go. (This used to require `cancelled`, which a completed task can never
 * become, so every merged item was undeletable.)
 */
export function workItemDeletionBlocker(
  item: PlanningWorkItem,
  harness: Pick<HarnessProjectState, 'taskQueue' | 'reviewSessions'> | null | undefined
): string | null {
  if (!item.linkedHarnessTaskId) return null
  const task = harness?.taskQueue.find((candidate) => candidate.id === item.linkedHarnessTaskId)
  if (!task || task.status === 'cancelled') return null
  if (task.status === 'pending' || task.status === 'claimed') {
    return t('tasks:workItemStatus.activeQueuedAgentWork')
  }
  if (harness?.reviewSessions?.some((session) => sessionOwnsTask(session, task))) {
    return t('tasks:workItemStatus.workAwaitingReviewMerge')
  }
  return null
}

/**
 * The one answer to "which Board column is this work item in".
 *
 * Once a work item is handed to the harness, the harness task and its session
 * are the source of truth and the stored `status` is only a cache that can lag
 * (it reads `active` all through review, for example). The Board, the
 * automation API and status counts all go through this so they cannot
 * disagree.
 */
export function projectWorkItemStatus(
  item: PlanningWorkItem,
  harness: Pick<HarnessProjectState, 'taskQueue' | 'reviewSessions'> | null | undefined
): PlanningWorkItemStatus {
  if (!item.linkedHarnessTaskId) return item.status
  const task = harness?.taskQueue.find((candidate) => candidate.id === item.linkedHarnessTaskId)
  if (!task) return 'ready'
  // The column follows the run's state (`agentRunState`), so the Board, the
  // Agents view and the API name the same state for the same run.
  return RUN_STATE_COLUMN[
    agentRunState(task, { activeSessions: [], reviewSessions: harness?.reviewSessions ?? [] })
  ]
}

/**
 * Which column each run state sits in. A held queue entry is the harness's
 * own "nobody may take this", so it shows where a reader looks for stopped
 * work rather than sitting in Ready looking startable. Starting means an agent
 * has been given it: work in flight, not work waiting to be picked.
 */
const RUN_STATE_COLUMN: Record<AgentRunState, PlanningWorkItemStatus> = {
  queued: 'ready',
  onHold: 'blocked',
  starting: 'active',
  running: 'active',
  waitingForYou: 'active',
  inReview: 'review',
  accepted: 'done',
  cancelled: 'ready'
}
