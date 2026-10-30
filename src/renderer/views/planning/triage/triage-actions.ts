import type { PlanningWorkItem } from '@shared/ostler-api'
import { t } from '@shared/i18n'

/**
 * Duplicate of… for a task in To triage (N4.3a), from its dialog or from a
 * suggestion's Duplicate of this (N4.3b): Mark as duplicate (N2.4), with undo
 * that reopens the task, removes the link and puts it back in To triage.
 * Returns the error, or null once it is marked.
 */
export async function markTriagedDuplicate(
  item: PlanningWorkItem,
  originalId: string,
  toastUndo: (title: string, undo: () => Promise<unknown>) => unknown
): Promise<string | null> {
  const result = await window.ostlerAPI.markPlanningWorkItemDuplicate(item.id, originalId)
  if (!result.ok) return result.error
  const link = result.value.link
  toastUndo(t('tasks:triage.markedDuplicate', { title: item.title }), async () => {
    await window.ostlerAPI.unarchivePlanningWorkItem(item.id)
    await window.ostlerAPI.removePlanningWorkItemLink(item.id, link.id)
    await window.ostlerAPI.updatePlanningWorkItem(item.id, { inTriage: true })
  })
  return null
}
