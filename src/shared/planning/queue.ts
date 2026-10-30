import type { HarnessProjectState, HarnessTask, PlanningWorkItem } from '../ostler-api'
import { agentRunState, agentRunStateLabel } from '../agent-run-state'
import { t } from '../i18n'

type QueueHarness =
  | (Pick<HarnessProjectState, 'taskQueue' | 'reviewSessions'> &
      Partial<Pick<HarnessProjectState, 'activeSessions'>>)
  | null
  | undefined

/** What a linked card says about its agent work, or null for unlinked work. */
export function executionLabel(item: PlanningWorkItem, harness: QueueHarness): string | null {
  if (!item.linkedHarnessTaskId) return null
  const task = harness?.taskQueue.find((candidate) => candidate.id === item.linkedHarnessTaskId)
  if (!task) return t('tasks:queue.preparingQueue')
  // The run's state in the shared words, with what to do next where it helps.
  const state = runState(task, harness)
  if (state === 'cancelled') return t('tasks:queue.cancelledReadyRequeue')
  if (state === 'onHold') return t('tasks:queue.heldNoAgentWill')
  return agentRunStateLabel(state)
}

function runState(task: HarnessTask, harness: QueueHarness) {
  return agentRunState(task, {
    activeSessions: harness?.activeSessions ?? [],
    reviewSessions: harness?.reviewSessions ?? []
  })
}

/**
 * Tasks an agent could claim right now, in queue order. Mirrors the harness
 * dialog so the board and the dialog agree on what is next.
 */
export function runnableHarnessTasks(harness: QueueHarness): HarnessTask[] {
  return (
    harness?.taskQueue.filter(
      (task) =>
        task.status === 'pending' &&
        task.copy?.state !== 'preparing' &&
        !task.hold &&
        !task.waitingOnDependencies
    ) ?? []
  )
}

/**
 * Queued but not yet runnable: waiting on dependencies rather than on a
 * person. These need no action, so they are counted apart from the queue
 * proper and never offered a Start button.
 */
export function waitingHarnessTasks(harness: QueueHarness): HarnessTask[] {
  return (
    harness?.taskQueue.filter(
      (task) => task.status === 'pending' && (task.waitingOnDependencies ?? 0) > 0
    ) ?? []
  )
}

/** 0 when this item is next to run, -1 when it is not waiting in the queue. */
export function queuePosition(item: PlanningWorkItem, runnable: HarnessTask[]): number {
  return item.linkedHarnessTaskId
    ? runnable.findIndex((task) => task.id === item.linkedHarnessTaskId)
    : -1
}

/**
 * Dependencies still holding a queued task back. The card says so instead of
 * showing a queue position, because there is nothing for the reader to do:
 * the queue releases it once the work ahead lands.
 */
export function queueWait(item: PlanningWorkItem, waiting: HarnessTask[]): number {
  return waiting.find((task) => task.id === item.linkedHarnessTaskId)?.waitingOnDependencies ?? 0
}

export interface QueueSummary {
  running: number
  starting: number
  queued: number
  waiting: number
  review: number
  sessions: number
}

/**
 * At-a-glance execution state for the Planning toolbar.
 *
 * `running` counts claimed tasks, not active sessions: a session can be open
 * without holding a task (an idle or orphaned workspace), and counting those
 * as "running" made the toolbar disagree with the harness dialog's
 * "In progress" tile. Sessions are reported separately in the tooltip.
 */
export function queueSummary(harness: HarnessProjectState | null | undefined): QueueSummary {
  return {
    running: harness?.taskQueue.filter((task) => task.status === 'claimed').length ?? 0,
    starting:
      harness?.taskQueue.filter(
        (task) => task.status === 'pending' && task.copy?.state === 'preparing'
      ).length ?? 0,
    queued: runnableHarnessTasks(harness).length,
    waiting: waitingHarnessTasks(harness).length,
    review: harness?.reviewSessions.length ?? 0,
    sessions: harness?.activeSessions.length ?? 0
  }
}

/** The agent pill a Board card shows: the three states a person scans for. */
export type AgentPill = 'queued' | 'running' | 'review'

/**
 * Which agent pill a card shows, from the same queue facts as
 * `executionLabel` (whose longer words go in the pill's tooltip). Nothing
 * once the run is over or cancelled: the column already says where it is.
 */
export function agentPill(item: PlanningWorkItem, harness: QueueHarness): AgentPill | null {
  if (!item.linkedHarnessTaskId) return null
  const task = harness?.taskQueue.find((candidate) => candidate.id === item.linkedHarnessTaskId)
  if (!task) return 'queued'
  const state = runState(task, harness)
  if (state === 'inReview') return 'review'
  if (state === 'starting' || state === 'running' || state === 'waitingForYou') return 'running'
  if (state === 'queued' || state === 'onHold') return 'queued'
  return null
}
