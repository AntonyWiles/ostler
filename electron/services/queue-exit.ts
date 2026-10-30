import type {
  PlanningActor,
  PlanningWorkItem,
  UpdatePlanningWorkItemInput,
  WatchedProject
} from '@shared/ostler-api'
import { todayIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import { isHiddenNow } from '@shared/planning/show-from'
import { Refusal } from '@shared/refusal'
import { projectWorkItemStatus, workItemDeletionBlocker } from '@shared/work-item-status'
import type { HarnessService } from './harness-service'
import type { PlanningService } from './planning-service'

export type QueueHarness = Pick<HarnessService, 'getState' | 'cancelTask' | 'setTaskHold'>

/**
 * The one rule for a change to a task that has a queue entry, for the Board,
 * the List, the drawer, bulk edit and the automation API alike. The queue
 * must never disagree with the task:
 *
 *  - Blocked holds a queued task's entry and Ready releases it; the stored
 *    status is left to the run.
 *  - Any other move out of Ready, Someday, or a show-from date that hides it
 *    today takes a queued task out of the queue, as Won't do does: the entry
 *    is cancelled and the link cleared, in the same step as the change (the
 *    dispatcher would otherwise queue it again, or start it while hidden).
 *    Undo is the change undone and the task queued again.
 *  - A task whose agent is running, or whose work waits for review, refuses
 *    such a change with its reason and nothing changes.
 *
 * `write` is the change itself (an update, or a move in the manual order);
 * it receives the updates with any status the queue took care of left out.
 * The answer carries `leftQueue: true` when the task left the queue.
 */
export function updateWorkItemThroughQueue(
  planning: PlanningService,
  harness: QueueHarness | undefined,
  project: WatchedProject,
  workItemId: string,
  updates: UpdatePlanningWorkItemInput,
  actor: PlanningActor,
  write: (updates: UpdatePlanningWorkItemInput) => PlanningWorkItem = (given) =>
    planning.updateWorkItem(workItemId, given, actor)
): PlanningWorkItem {
  const item = planning.getWorkItem(workItemId)
  const taskId = item.linkedHarnessTaskId
  if (!taskId || !harness || !updates || typeof updates !== 'object') return write(updates)
  const state = harness.getState(project)
  const task = state.taskQueue.find((candidate) => candidate.id === taskId)
  if (!task || task.status === 'cancelled') return write(updates)

  const status = updates.status
  const current = projectWorkItemStatus(item, state)
  const moves = status !== undefined && status !== current
  const today = todayIsoDate()
  const hides =
    !isHiddenNow(item, today) &&
    isHiddenNow(
      {
        inTriage: item.inTriage,
        someday: updates.someday === undefined ? item.someday : Boolean(updates.someday),
        showFrom: updates.showFrom === undefined ? item.showFrom : updates.showFrom
      },
      today
    )
  if (!moves && !hides) {
    // The column follows the run: a status it already shows is not stored.
    if (status === undefined) return write(updates)
    const { status: _same, ...rest } = updates
    return write(rest)
  }

  const blocker = workItemDeletionBlocker(item, state)
  // Over and done with (applied, or out of review): the task is history.
  if (!blocker) return write(updates)
  if (task.status === 'claimed')
    throw new Refusal(t('errors:queueExit.agentRunning', { title: item.title }))
  if (task.status !== 'pending') throw new Refusal(blocker)

  // Queued, not started. Blocked and back are the queue's own hold.
  if (!hides && (status === 'blocked' || status === 'ready')) {
    const { status: _held, ...rest } = updates
    const saved = write(rest)
    harness.setTaskHold(project, taskId, status === 'blocked')
    return saved
  }
  return planning.runInTransaction(() => {
    const saved = write(updates)
    harness.cancelTask(project, taskId, item.id)
    const cleared = planning.clearHarnessHandoff(project.id, item.id, taskId)
    return { ...saved, linkedHarnessTaskId: cleared.linkedHarnessTaskId, leftQueue: true }
  })
}
