import type { PlanningWorkItem, UpdatePlanningWorkItemInput } from '@shared/ostler-api'
import { useToast } from '../../ui'
import { t } from '@shared/i18n'

/** A task a change took out of the agent queue, and the update that puts the change back. */
export interface LeftQueue {
  item: PlanningWorkItem
  undo: UpdatePlanningWorkItemInput
}

/**
 * Undo for a change that took queued tasks out of the agent queue (a move out
 * of Ready, Someday, a later show-from date): the main process cancelled each
 * queue entry with the change, so its undo puts the change back and queues
 * the task again, as it was.
 */
export function useRequeueUndo(
  projectId: string,
  afterUndo: () => Promise<unknown>,
  setError: (message: string | null) => void
) {
  const { toastUndo } = useToast()

  /** Queues each task again (after its change was put back). */
  const requeue = async (items: PlanningWorkItem[]) => {
    for (const item of items) {
      const queued = await window.ostlerAPI.queuePlanningWorkItem(projectId, item.id)
      if (!queued.ok) setError(queued.error)
    }
  }

  const undo = async (left: LeftQueue[]) => {
    const back: PlanningWorkItem[] = []
    for (const entry of left) {
      const result = await window.ostlerAPI.updatePlanningWorkItem(entry.item.id, entry.undo)
      if (result.ok) back.push(entry.item)
      else setError(result.error)
    }
    await requeue(back)
    await afterUndo()
  }

  /** The toast for tasks a change took out of the queue; nothing when there are none. */
  const offer = (left: LeftQueue[]) => {
    if (left.length === 0) return
    toastUndo(
      left.length === 1
        ? t('tasks:useWorkItemActions.queuedAgentBlockHold', { itemTitle: left[0].item.title })
        : t('tasks:useWorkItemActions.leftQueueTasks', { count: left.length }),
      () => undo(left)
    )
  }

  return { offer, requeue }
}
