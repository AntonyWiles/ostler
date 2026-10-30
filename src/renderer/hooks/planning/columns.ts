import type { PlanningColumnSettings, PlanningWorkItemStatus } from '@shared/ostler-api'
import { columnKey, isStatusHidden, orderedColumns, type ColumnPlace } from '@shared/board-columns'
import { TASK_STATUS_HINTS, taskColumnLabel } from '@shared/task-labels'

export interface BoardColumn extends ColumnPlace {
  label: string
  hint: string
}

/**
 * A project's Board columns, in order, with its own words (R2.4, D34): each
 * status, then the columns of its own counting as it (MOP-26). A hidden
 * column is left out, unless a live task is in it (`occupied`, by column
 * key): a task never disappears from the Board.
 */
export function boardColumns(
  columns?: PlanningColumnSettings | null,
  occupied?: (key: string) => boolean
): BoardColumn[] {
  return orderedColumns(columns).flatMap(({ status, custom }) => {
    const key = columnKey(status, custom?.id)
    const hidden = custom ? custom.hidden : isStatusHidden(status, columns)
    if (hidden && !(occupied?.(key) ?? false)) return []
    const columnId = custom?.id ?? null
    return [
      {
        key,
        status,
        columnId,
        label: taskColumnLabel({ status, columnId }, columns),
        hint: TASK_STATUS_HINTS[status]
      }
    ]
  })
}

/** The standard columns: every status, the standard words. */
export const COLUMNS: BoardColumn[] = boardColumns()

/** A status's own column, for callers that know only the six. */
export function statusColumn(status: PlanningWorkItemStatus): string {
  return columnKey(status)
}
