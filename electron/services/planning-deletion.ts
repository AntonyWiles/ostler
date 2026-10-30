import { MAX_RESOLUTION_REASON_LENGTH } from '@shared/ostler-api'
import type {
  MarkDuplicateResult,
  PlanningActor,
  PlanningWorkItem,
  WatchedProject,
  WontDoOptions,
  WontDoResult
} from '@shared/ostler-api'
import { workItemDeletionBlocker } from '@shared/work-item-status'
import type { HarnessService } from './harness-service'
import type { PlanningService } from './planning-service'
import { t } from '@shared/i18n'
import { Refusal } from '@shared/refusal'
import { openSubtasksOf } from '@shared/planning/wont-do'

export interface WorkItemDeletion {
  /** An active or queued agent task was cancelled so the item could go. */
  cancelledTask: boolean
  /** The item's link to a (now cancelled) execution task was cleared. */
  clearedHandoff: boolean
}

/**
 * The one rule for deleting a planning work item, shared by the desktop UI, the
 * project-brief undo, and the automation API so they cannot drift apart.
 *
 * A work item linked to agent work is only deletable once that work is over:
 *  - queued, running or in-review work is refused (see workItemDeletionBlocker);
 *  - `cancelActiveWork` (used only where deleting is an undo of something the
 *    human just created) cancels it first instead;
 *  - once the work is over (cancelled, or completed and out of review) the
 *    link is cleared and the item is deleted.
 * `PlanningService.deleteWorkItem` still refuses any item that is somehow still
 * linked, as a last line of defence.
 */
export function deleteWorkItem(
  planning: PlanningService,
  harness: Pick<HarnessService, 'getState' | 'cancelTask'> | undefined,
  project: WatchedProject,
  workItemId: string,
  actor: PlanningActor,
  options: { cancelActiveWork?: boolean; permanent?: boolean } = {}
): WorkItemDeletion {
  const item = planning.getWorkItem(workItemId)
  if (item.projectId !== project.id) {
    throw new Error('Planning work item belongs to another project')
  }

  const result: WorkItemDeletion = { cancelledTask: false, clearedHandoff: false }
  if (item.linkedHarnessTaskId) {
    if (!harness) throw new Error('Harness API unavailable')
    const state = harness.getState(project)
    const linkedTask = state.taskQueue.find((task) => task.id === item.linkedHarnessTaskId)
    const blocker = workItemDeletionBlocker(item, state)
    if (blocker) {
      // Only queued work can be cancelled out of the way; running work and
      // work awaiting review must be stopped/merged/discarded by a human.
      if (!options.cancelActiveWork || linkedTask?.status !== 'pending') throw new Error(blocker)
      harness.cancelTask(project, linkedTask.id, item.id)
      result.cancelledTask = true
    }
    planning.clearHarnessHandoff(project.id, item.id, item.linkedHarnessTaskId)
    result.clearedHandoff = true
  }
  // The recycle bin by default; `permanent` is for undoing a creation the
  // human just made, where a bin entry would only be clutter.
  if (options.permanent) planning.deleteWorkItem(workItemId, actor)
  else planning.moveWorkItemToBin(workItemId, actor)
  return result
}

/**
 * Moves a finished work item off the Board into the project archive. Same
 * gate as deletion -- work still queued, running or in review stays put -- but
 * the link to the agent task is kept so its report remains readable.
 */
export function archiveWorkItem(
  planning: PlanningService,
  harness: Pick<HarnessService, 'getState'> | undefined,
  project: WatchedProject,
  workItemId: string,
  actor: PlanningActor,
  now = Date.now()
): PlanningWorkItem {
  const item = planning.getWorkItem(workItemId)
  if (item.projectId !== project.id) {
    throw new Error('Planning work item belongs to another project')
  }
  if (item.linkedHarnessTaskId) {
    if (!harness) throw new Error('Harness API unavailable')
    const blocker = workItemDeletionBlocker(item, harness.getState(project))
    if (blocker) throw new Error(blocker.replace('deleted', 'archived'))
  }
  return planning.archiveWorkItem(workItemId, actor, now)
}

/** Permanently deletes an item that is already in the recycle bin. */
export function deleteWorkItemForever(
  planning: PlanningService,
  project: WatchedProject,
  workItemId: string,
  actor: PlanningActor
): void {
  const item = planning.getWorkItem(workItemId)
  if (item.projectId !== project.id) {
    throw new Error('Planning work item belongs to another project')
  }
  if (!item.deletedAt) throw new Error(t('errors:planningDeletion.onlyItemsRecycleBin'))
  planning.deleteWorkItem(workItemId, actor)
}

/**
 * Closes a task as won't do (N1.2, N8): the one rule for the desktop UI and
 * the automation API. Agent work follows the deletion rule: queued work is
 * cancelled only with `cancelQueuedWork` (the app asks the person first) and
 * its handoff cleared; running work and work in review refuse, in archiving's
 * words. With `includeSubtasks`, the task's open subtasks are closed the same
 * way, with the same reason, in the same transaction. Nothing changes until
 * every task has passed every check.
 */
export function closeAsWontDo(
  planning: PlanningService,
  harness: Pick<HarnessService, 'getState' | 'cancelTask'> | undefined,
  project: WatchedProject,
  workItemId: string,
  actor: PlanningActor,
  options: WontDoOptions = {}
): WontDoResult {
  const item = planning.getWorkItem(workItemId)
  if (item.projectId !== project.id) {
    throw new Error('Planning work item belongs to another project')
  }
  const items = [
    item,
    ...(options.includeSubtasks ? openSubtasksOf(planning.listWorkItems(project.id), item.id) : [])
  ]
  const ids = items.map((candidate) => candidate.id)
  const reason = options.reason ?? ''
  // Done, already closed, the reason's length: before any agent work is touched.
  planning.checkWontDo(ids, reason)
  const toCancel: { item: PlanningWorkItem; taskId: string }[] = []
  const linked = items.filter((candidate) => candidate.linkedHarnessTaskId)
  if (linked.length > 0) {
    if (!harness) throw new Error('Harness API unavailable')
    const state = harness.getState(project)
    for (const candidate of linked) {
      const blocker = workItemDeletionBlocker(candidate, state)
      if (!blocker) continue
      const task = state.taskQueue.find((entry) => entry.id === candidate.linkedHarnessTaskId)
      // Only queued work can be cancelled out of the way, and only when asked.
      if (!options.cancelQueuedWork || task?.status !== 'pending')
        throw new Error(blocker.replace('deleted', 'archived'))
      toCancel.push({ item: candidate, taskId: task.id })
    }
  }
  for (const entry of toCancel) {
    harness!.cancelTask(project, entry.taskId, entry.item.id)
    planning.clearHarnessHandoff(project.id, entry.item.id, entry.taskId)
  }
  const { workItems, repeatedAs } = planning.closeWorkItemsAsWontDo(ids, reason, actor)
  return {
    workItem: workItems[0],
    closedIds: workItems.map((closed) => closed.id),
    cancelledTask: toCancel.length > 0,
    repeatedAs: repeatedAs.get(item.id)
  }
}

/**
 * Reads won't-do options from an untrusted caller (the renderer or an HTTP
 * body): a reason string and two true/false switches, nothing else.
 */
export function wontDoOptions(input: unknown): WontDoOptions {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input))
    throw new Refusal('Won’t do options must be an object')
  const { reason, includeSubtasks, cancelQueuedWork } = input as Record<string, unknown>
  if (reason !== undefined && reason !== null && typeof reason !== 'string')
    throw new Refusal('reason must be a string')
  for (const [name, value] of [
    ['includeSubtasks', includeSubtasks],
    ['cancelQueuedWork', cancelQueuedWork]
  ] as const)
    if (value !== undefined && typeof value !== 'boolean')
      throw new Refusal(`${name} must be true or false`)
  return {
    reason: typeof reason === 'string' ? reason : '',
    includeSubtasks: includeSubtasks === true,
    cancelQueuedWork: cancelQueuedWork === true
  }
}

/**
 * Mark as duplicate (N2.4, N19): the one rule for the app and the automation
 * API. Links this task to its original as "duplicates" and closes it as won't
 * do with the reason "Duplicate of <title>" through `closeAsWontDo`, so every
 * refusal of Won't do applies. The link is checked before anything closes and
 * added once the task is closed, so a refusal changes nothing. Chains are
 * never followed: the original may itself be a duplicate.
 */
export function markAsDuplicate(
  planning: PlanningService,
  harness: Pick<HarnessService, 'getState' | 'cancelTask'> | undefined,
  project: WatchedProject,
  workItemId: string,
  originalId: unknown,
  actor: PlanningActor,
  options: Pick<WontDoOptions, 'cancelQueuedWork'> = {}
): MarkDuplicateResult {
  const item = planning.getWorkItem(workItemId)
  if (item.projectId !== project.id) {
    throw new Error('Planning work item belongs to another project')
  }
  const { to } = planning.checkWorkItemLink(item.id, originalId, 'duplicates')
  const reason = t('tasks:taskLinks.duplicateReason', { title: to.title }).slice(
    0,
    MAX_RESOLUTION_REASON_LENGTH
  )
  const closed = closeAsWontDo(planning, harness, project, item.id, actor, {
    reason,
    cancelQueuedWork: options.cancelQueuedWork === true
  })
  const link = planning.addWorkItemLink(item.id, to.id, 'duplicates', actor)
  return {
    workItem: planning.getWorkItem(item.id),
    link,
    cancelledTask: closed.cancelledTask
  }
}
