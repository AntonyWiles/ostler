import * as React from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { useToast } from '../../ui'

/**
 * Mark as duplicate and Copy task (N2.4), for the task menu: each one call
 * through the one rule in the main process, then a toast whose undo reverses
 * the whole of it.
 */
export function useTaskLinkActions({
  setError,
  loadPlanning,
  openWorkItem,
  closeDrawerIf
}: {
  setError: (message: string | null) => void
  loadPlanning: () => Promise<unknown>
  openWorkItem: (item: PlanningWorkItem) => void
  /** Closes the drawer when it shows this task. */
  closeDrawerIf: (workItemId: string) => void
}) {
  const { toastUndo } = useToast()

  /** The task the Mark as duplicate dialog is open for, or null while it is closed. */
  const [duplicateTarget, setDuplicateTarget] = React.useState<PlanningWorkItem | null>(null)

  /**
   * Links the task to its original and closes it as won't do. Undo reopens
   * it and removes the link. Returns the error, or null, so the dialog can
   * stay open on failure.
   */
  const markAsDuplicate = async (
    item: PlanningWorkItem,
    originalId: string
  ): Promise<string | null> => {
    const result = await window.ostlerAPI.markPlanningWorkItemDuplicate(item.id, originalId)
    if (!result.ok) return result.error || t('tasks:taskLinks.couldntMarkDuplicate')
    setDuplicateTarget(null)
    closeDrawerIf(item.id)
    const linkId = result.value.link.id
    toastUndo(t('tasks:taskLinks.markedDuplicate', { title: item.title }), async () => {
      const reopened = await window.ostlerAPI.unarchivePlanningWorkItem(item.id)
      const unlinked = await window.ostlerAPI.removePlanningWorkItemLink(item.id, linkId)
      if (!reopened.ok || !unlinked.ok) setError(t('tasks:taskLinks.couldntUndoDuplicate'))
      await loadPlanning()
    })
    await loadPlanning()
    return null
  }

  /** Copies the task into Backlog and opens the copy; undo removes the copy for good. */
  const copyWorkItem = async (item: PlanningWorkItem) => {
    const result = await window.ostlerAPI.copyPlanningWorkItem(item.id)
    if (!result.ok) {
      setError(result.error || t('tasks:taskLinks.couldntCopy'))
      return
    }
    const copy = result.value.workItem
    await loadPlanning()
    openWorkItem(copy)
    toastUndo(t('tasks:taskLinks.copied', { title: item.title }), async () => {
      // The bin first, then for good: a copy just made is not worth keeping there.
      closeDrawerIf(copy.id)
      const binned = await window.ostlerAPI.deletePlanningWorkItem(copy.id)
      const gone = binned.ok
        ? await window.ostlerAPI.deletePlanningWorkItemForever(copy.id)
        : binned
      if (!gone.ok) setError(t('tasks:taskLinks.couldntUndoCopy'))
      await loadPlanning()
    })
  }

  return { duplicateTarget, setDuplicateTarget, markAsDuplicate, copyWorkItem }
}
