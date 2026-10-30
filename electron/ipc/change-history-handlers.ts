import type { ChangeHistoryClear, ChangeHistoryQuery } from '@shared/ostler-api'
import type { ChangeHistoryService } from '../services/change-history/history-service'
import { handleApi } from './handle-ipc'

/**
 * Undo history: the person's own changes, step by step. Undo and redo run as
 * IPC calls like any other, so each is recorded as a step of its own.
 */
export function registerChangeHistoryHandlers({
  changeHistory
}: {
  changeHistory: ChangeHistoryService
}): void {
  handleApi('listChangeHistory', async (_event, query?: ChangeHistoryQuery) =>
    changeHistory.list(query ?? {})
  )
  handleApi('getChangeHistoryDetails', async (_event, entryId: string) =>
    changeHistory.details(String(entryId))
  )
  handleApi('getChangeHistoryHead', async () => changeHistory.head())
  handleApi('getChangeHistoryStats', async () => changeHistory.stats())
  handleApi('undoChange', async (_event, entryId: string) => changeHistory.undo(String(entryId)))
  handleApi('redoChange', async (_event, entryId: string) => changeHistory.redo(String(entryId)))
  handleApi('undoLatestChange', async () => changeHistory.undoLatest())
  handleApi('redoLatestChange', async () => changeHistory.redoLatest())
  handleApi('deleteChangeHistoryEntry', async (_event, entryId: string) =>
    changeHistory.delete(String(entryId))
  )
  handleApi('clearChangeHistory', async (_event, options?: ChangeHistoryClear) =>
    changeHistory.clear({
      olderThan: typeof options?.olderThan === 'number' ? options.olderThan : undefined,
      projectId: typeof options?.projectId === 'string' ? options.projectId : undefined
    })
  )
}
