import { useCallback } from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import type { StickyTaskRef } from '@shared/sticky-task'
import { useConfirm, useToast, type MenuEntry } from '../ui'
import { StickyNote } from '../ui/icons'
import { t } from '@shared/i18n'

/** The oldest pinned task's title, for the five-pinned question; empty when it is gone. */
async function titleOf(ref: StickyTaskRef): Promise<string> {
  const result = await window.ostlerAPI.getPlanningWorkItems(ref.projectId)
  if (!result.ok) return ''
  return result.value.find((item) => item.id === ref.taskId)?.title ?? ''
}

/**
 * Pin to desktop (N5.8b): asks main to pin a task in a sticky window. With
 * five pinned it asks whether to unpin the oldest first; a failure shows in a
 * toast.
 */
export function usePinToDesktop(): (ref: StickyTaskRef) => Promise<void> {
  const confirm = useConfirm()
  const { toast } = useToast()
  return useCallback(
    async (ref: StickyTaskRef) => {
      let result = await window.ostlerAPI.pinTaskToDesktop(ref.projectId, ref.taskId)
      if (result.ok && !result.value.pinned) {
        const oldest = await titleOf(result.value.oldest)
        const unpinOldest = await confirm({
          title: t('tasks:sticky.fullTitle'),
          body: oldest ? t('tasks:sticky.fullBody', { oldest }) : t('tasks:sticky.fullBodyUnknown'),
          confirmLabel: t('tasks:sticky.unpinOldest')
        })
        if (!unpinOldest) return
        result = await window.ostlerAPI.pinTaskToDesktop(ref.projectId, ref.taskId, true)
      }
      if (!result.ok)
        toast({ title: t('tasks:sticky.couldNotPin'), body: result.error, tone: 'danger' })
    },
    [confirm, toast]
  )
}

/**
 * Pin to desktop in a task's menus: its card's and the drawer's. None for a
 * closed task.
 */
export function useStickyTaskMenuItems(item: PlanningWorkItem): () => MenuEntry[] {
  const pin = usePinToDesktop()
  return () =>
    item.archivedAt || item.deletedAt
      ? []
      : [
          {
            label: t('tasks:sticky.pin'),
            icon: StickyNote,
            hint: t('tasks:sticky.pinHint'),
            onSelect: () => void pin({ projectId: item.projectId, taskId: item.id })
          }
        ]
}
