import { useCallback } from 'react'
import { useConfirm, useToast } from '../ui'
import { t } from '@shared/i18n'

/** At most this many changed tasks are named in the question. */
const NAMED = 5

/**
 * "Undo import" (P6.1), for the Inbox and Settings › Data alike: the
 * import's tasks go to the recycle bin at once, with Undo. Tasks changed
 * since the import are kept, unless the person says to move them too. Returns
 * whether anything was undone.
 */
export function useUndoImport(): (batchId: string, onChange?: () => void) => Promise<boolean> {
  const confirm = useConfirm()
  const { toast, toastUndo } = useToast()
  return useCallback(
    async (batchId, onChange) => {
      const check = await window.ostlerAPI.checkUndoImport(batchId)
      if (!check.ok) {
        toast({
          title: t('data:useUndoImport.couldntUndoImport'),
          body: check.error,
          tone: 'danger'
        })
        return false
      }
      const { changed } = check.value
      let includeChanged = false
      if (changed.length > 0) {
        const names = changed.slice(0, NAMED).map((task) => `• ${task.title}`)
        if (changed.length > NAMED)
          names.push(t('data:useUndoImport.others', { count: changed.length - NAMED }))
        includeChanged = await confirm({
          title: t('data:useUndoImport.tasksChangedSinceImport', { count: changed.length }),
          body: t('data:useUndoImport.otherImportedTasksGo', { join: names.join('\n') }),
          confirmLabel: t('data:useUndoImport.moveThemToo'),
          cancelLabel: t('data:useUndoImport.keepThem'),
          tone: 'danger'
        })
      }
      const result = await window.ostlerAPI.undoImport(batchId, includeChanged)
      if (!result.ok) {
        toast({
          title: t('data:useUndoImport.couldntUndoImport'),
          body: result.error,
          tone: 'danger'
        })
        return false
      }
      onChange?.()
      const { movedIds, kept } = result.value
      toastUndo(
        t('data:useUndoImport.movedImportedTasksRecycle', { count: movedIds.length }),
        async () => {
          const restored = await window.ostlerAPI.restoreImport(batchId, movedIds)
          if (!restored.ok)
            toast({
              title: t('data:useUndoImport.couldntBringThemBack'),
              body: restored.error,
              tone: 'danger'
            })
          onChange?.()
        },
        kept.length > 0
          ? t('data:useUndoImport.keptChangedTasks', { count: kept.length })
          : undefined
      )
      return true
    },
    [confirm, toast, toastUndo]
  )
}
