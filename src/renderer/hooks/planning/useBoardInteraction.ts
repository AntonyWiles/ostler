import { useCallback, useMemo, useState } from 'react'
import type {
  PlanningWorkItem,
  PlanningWorkItemPlacement,
  PlanningWorkItemStatus
} from '@shared/ostler-api'
import {
  dropIndex,
  dropPlacement,
  normalizeColumnOptions,
  sortWorkItems,
  type BoardColumnOptions,
  type BoardSortBy,
  type BoardSortDir
} from '@shared/planning/board'
import { applyTaskFilters, useTaskView } from '../useTaskFilters'
import { useHiddenTasks } from '../useHiddenTasks'
import type { TaskViewSpec } from '../task-view-spec'
import { usePeople } from '../../context/PeopleContext'
import { TASK_STATUSES } from '@shared/task-labels'
import { columnIdOfKey, taskColumnKey } from '@shared/board-columns'
import { useStatusWords } from '../../context/ColumnsContext'
import { boardColumns } from './columns'
import type { PlanningRunner } from './usePlanningRunner'
import type { PlanningRecords } from './usePlanningRecords'
import type { PlanningSelectors } from './usePlanningSelectors'
import type { WorkItemActions } from './useWorkItemActions'

/**
 * Everything the Board does with the pointer and its toolbar: drag and drop,
 * filters, grouping, sorting, lane collapse, saved views and
 * WIP limits, and the filtered, sorted columns that result. Depends on the
 * runner, records, selectors and work item actions (a drop is a move).
 */
export function useBoardInteraction(
  projectId: string,
  runner: PlanningRunner,
  records: PlanningRecords,
  selectors: PlanningSelectors,
  actions: WorkItemActions,
  /** The sub-project the Board is scoped to, or null for the whole project. */
  subprojectId: string | null = null
) {
  const { setError } = runner
  const { workItems, commentCounts, taskContacts } = records
  const { setWipLimits } = records.internal
  const { projectedStatus, goalIdForItem, currentIterationId } = selectors
  const people = usePeople()
  // The project's own column words and hidden columns (R2.4).
  const statusWords = useStatusWords(projectId)
  /** The Board column a task is in (MOP-26): its own column, or its status's. */
  const columnOf = useCallback(
    (item: PlanningWorkItem) => taskColumnKey(item, statusWords.columns, projectedStatus(item)),
    [statusWords.columns, projectedStatus]
  )
  const columns = useMemo(() => {
    const occupied = new Set(workItems.map(columnOf))
    return boardColumns(statusWords.columns, (key) => occupied.has(key))
  }, [statusWords.columns, workItems, columnOf])
  const [draggingWorkItemId, setDraggingWorkItemId] = useState<string | null>(null)
  /** The column key (`columnKey`) a card is dragged over. */
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null)
  const [dragOverLaneId, setDragOverLaneId] = useState<string | null>(null)
  /** Under Manual: where in the column under the pointer the card would land. */
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [collapsedLaneIds, setCollapsedLaneIds] = useState<string[]>([])
  const [pendingMilestoneMove, setPendingMilestoneMove] = useState<{
    item: PlanningWorkItem
    targetMilestoneId: string | null
    targetStatus: PlanningWorkItemStatus
    targetColumnId: string | null
    /** Where in the column it was dropped, under Manual. */
    placement?: PlanningWorkItemPlacement
  } | null>(null)
  // The same view state, filters and rule as every task view (`useTaskView`).
  const boardView = useTaskView(projectId, 'board', BOARD_VIEW_SPEC)
  const { groupBy: boardGroupBy, sortBy: boardSortBy, sortDir: boardSortDir } = boardView.options
  const setBoardGroupBy = (groupBy: BoardGroupBy) => boardView.setOptions({ groupBy })
  const setBoardSortBy = (sortBy: BoardSortBy) => boardView.setOptions({ sortBy })
  const setBoardSortDir = (sortDir: BoardSortDir) => boardView.setOptions({ sortDir })
  const boardCardFields = boardView.options.cardFields
  const setBoardCardFields = (cardFields: string[]) => boardView.setOptions({ cardFields })
  // Columns this view leaves out for now, from the toolbar's Columns: the
  // project's own columns (Project settings › Board) are not changed.
  const boardHiddenColumns = boardView.options.hiddenColumns
  const setBoardHiddenColumns = (hiddenColumns: string[]) => boardView.setOptions({ hiddenColumns })
  // The toolbar's eye (MOP-43): shows the hidden columns for a look, without
  // changing which ones this view hides. Not kept: the next visit hides them.
  const [peekHiddenColumns, setPeekHiddenColumns] = useState(false)
  const shownColumns = useMemo(() => {
    if (peekHiddenColumns) return columns
    const shown = columns.filter((column) => !boardHiddenColumns.includes(column.key))
    // Never an empty board: with every column hidden, all of them show.
    return shown.length > 0 ? shown : columns
  }, [columns, boardHiddenColumns, peekHiddenColumns])
  const boardShowBoxes = boardView.options.showBoxes
  // Each column's own sort, length, height and card details (MOP-79).
  const boardColumnOptions = boardView.options.columnOptions
  const setBoardColumnOptions = (key: string, options: BoardColumnOptions | null) => {
    const next = { ...boardColumnOptions }
    if (options && Object.keys(options).length > 0) next[key] = options
    else delete next[key]
    boardView.setOptions({ columnOptions: next })
  }
  const setBoardShowBoxes = (showBoxes: boolean) => boardView.setOptions({ showBoxes })

  const toggleLaneCollapsed = (laneId: string) =>
    setCollapsedLaneIds((current) =>
      current.includes(laneId) ? current.filter((id) => id !== laneId) : [...current, laneId]
    )

  const setColumnWipLimit = useCallback(
    async (status: PlanningWorkItemStatus, limit: number | null) => {
      if (!projectId) return
      const result = await window.ostlerAPI.setPlanningWipLimit(projectId, status, limit)
      if (result.ok) setWipLimits(result.value)
      else setError(result.error)
    },
    [projectId]
  )

  // Memoised (P9.1): a drag over a column re-renders the workspace on every
  // move, and filtering and sorting thousands of tasks each time was most of
  // the cost. The column arrays also stay the same, so cards can skip renders.
  const meId = people.me?.id ?? null
  const { filter: boardFilter, query: boardQuery, hideDone: boardHideDone } = boardView
  const matchingWorkItems = useMemo(
    () =>
      applyTaskFilters(
        workItems,
        { filter: boardFilter, query: boardQuery, hideDone: boardHideDone },
        {
          projectedStatus,
          goalIdForItem,
          commentCounts,
          taskContacts,
          meId,
          currentIterationId,
          subprojectId
        }
      ),
    [
      workItems,
      boardFilter,
      boardQuery,
      boardHideDone,
      projectedStatus,
      goalIdForItem,
      commentCounts,
      taskContacts,
      meId,
      currentIterationId,
      subprojectId
    ]
  )
  // Someday and shown-later tasks stay off the Board unless asked for (N1.1a).
  const boardHidden = useHiddenTasks(projectId, 'board', matchingWorkItems)
  const shownWorkItems = boardHidden.items
  const filteredWorkItems = useMemo(
    () => sortWorkItems(shownWorkItems, boardSortBy, boardSortDir),
    [shownWorkItems, boardSortBy, boardSortDir]
  )

  /** Each column's cards, by column key, in the order shown. */
  const itemsByStatus = useMemo(() => {
    const byKey = new Map<string, PlanningWorkItem[]>(columns.map((column) => [column.key, []]))
    for (const item of filteredWorkItems) {
      const key = columnOf(item)
      const list = byKey.get(key) ?? byKey.get(projectedStatus(item))
      list?.push(item)
    }
    return byKey
  }, [columns, filteredWorkItems, columnOf, projectedStatus])

  /**
   * A card dropped on a column (`columnItems`: that column's cards as shown,
   * in a lane or not). Under Manual it lands exactly where the drop line
   * was (D31); under another sort only its status changes, so a drop in its
   * own column does nothing.
   */
  const dropWorkItem = (
    key: string,
    targetMilestoneId?: string | null,
    draggedId?: string,
    columnItems?: PlanningWorkItem[]
  ) => {
    const target = columns.find((column) => column.key === key)
    const status = target?.status ?? (key as PlanningWorkItemStatus)
    const columnId = target ? target.columnId : columnIdOfKey(key)
    const itemId = draggedId || draggingWorkItemId
    const item = workItems.find((candidate) => candidate.id === itemId)
    const pointerIndex = dragOverIndex
    setDraggingWorkItemId(null)
    setDragOverStatus(null)
    setDragOverLaneId(null)
    setDragOverIndex(null)
    if (!item) return
    const manual = boardSortBy === 'manual' && columnItems !== undefined
    const insertAt = manual
      ? dropIndex(columnItems, item, 'manual', boardSortDir, pointerIndex ?? columnItems.length)
      : null
    const placement =
      manual && insertAt !== null
        ? dropPlacement(columnItems, item, insertAt, status, columnId)
        : undefined
    const sameColumn = columnOf(item) === key
    // A linked item's move is a harness action, not a milestone edit; only
    // its place within a column is the Board's to change.
    if (item.linkedHarnessTaskId) {
      if (!sameColumn) void actions.internal.moveLinkedWorkItem(item, status, columnId)
      else if (placement) void actions.placeWorkItem(item, { ...placement, status: undefined })
      return
    }

    if (boardGroupBy === 'milestone' && targetMilestoneId !== undefined) {
      const sourceMilestoneId = item.milestoneId ?? null
      if (sourceMilestoneId !== targetMilestoneId) {
        setPendingMilestoneMove({
          item,
          targetMilestoneId,
          targetStatus: status,
          targetColumnId: columnId,
          placement
        })
        return
      }
    }

    if (manual) {
      if (placement) void actions.placeWorkItem(item, placement)
      return
    }
    void actions.moveWorkItem(item, status, columnId)
  }

  const confirmMilestoneMove = async () => {
    if (!pendingMilestoneMove) return
    const { item, targetMilestoneId, targetStatus, targetColumnId, placement } =
      pendingMilestoneMove
    await actions.internal.moveWorkItemToMilestone(
      item,
      targetMilestoneId,
      targetStatus,
      () => setPendingMilestoneMove(null),
      targetColumnId
    )
    if (placement) await actions.placeWorkItem(item, { ...placement, status: undefined })
  }

  const cancelMilestoneMove = () => {
    setPendingMilestoneMove(null)
  }

  return {
    boardView,
    /** The Board's columns for this project, in order, in its words. */
    columns,
    /** The columns the Board shows: `columns` without those this view hides. */
    shownColumns,
    boardHiddenColumns,
    setBoardHiddenColumns,
    /** Hidden columns shown for now, from the toolbar's eye (MOP-43). */
    peekHiddenColumns,
    setPeekHiddenColumns,
    /** This project's status words and the statuses its pickers offer. */
    statusWords,
    setColumnWipLimit,
    draggingWorkItemId,
    setDraggingWorkItemId,
    dragOverStatus,
    setDragOverStatus,
    dragOverLaneId,
    setDragOverLaneId,
    dragOverIndex,
    setDragOverIndex,
    dropWorkItem,
    pendingMilestoneMove,
    setPendingMilestoneMove,
    confirmMilestoneMove,
    cancelMilestoneMove,
    boardGroupBy,
    setBoardGroupBy,
    boardSortBy,
    setBoardSortBy,
    boardSortDir,
    setBoardSortDir,
    boardCardFields,
    setBoardCardFields,
    /** Whether every card shows its selection box, from the toolbar; off by default. */
    boardShowBoxes,
    setBoardShowBoxes,
    /** Each column's own options in this view, by column key (MOP-79). */
    boardColumnOptions,
    setBoardColumnOptions,
    boardHideDone: boardView.hideDone,
    setBoardHideDone: boardView.setHideDone,
    collapsedLaneIds,
    toggleLaneCollapsed,
    boardFiltersActive: boardView.isFiltered,
    clearBoardFilters: boardView.clear,
    filteredWorkItems,
    /** Hidden tasks the filters matched (N1.1a), and whether they are shown. */
    boardHidden,
    itemsByStatus,
    /** The Board column (key) a task is in. */
    columnOf
  }
}

/** `field:<id>` swimlanes group by a Choice or Checkbox custom field (R2.2). */
export type BoardGroupBy =
  | 'none'
  | 'milestone'
  | 'goal'
  | 'origin'
  | 'assignee'
  /** One lane per iteration (R6.1). */
  | 'iteration'
  /** One lane per task type (N2.7a). */
  | 'type'
  /** One lane per workstream (sub-project). */
  | 'subproject'
  | `field:${string}`

/** The Board's own options in its saved views: grouping and sort. */
export interface BoardViewOptions {
  groupBy: BoardGroupBy
  sortBy: BoardSortBy
  sortDir: BoardSortDir
  /** The custom fields shown on cards, by id, in this order (R2.2). None by default. */
  cardFields: string[]
  /**
   * Every card shows its selection box. Off by default: a box that appeared
   * on hover moved the card's title, so with this off the boxes show only
   * once something is selected (Ctrl and a click, or a column's Select all).
   */
  showBoxes: boolean
  /** Columns this view leaves out, by column key, from View options. None by default. */
  hiddenColumns: string[]
  /** Each column's own options, by column key (MOP-79). None by default. */
  columnOptions: Record<string, BoardColumnOptions>
}

const BOARD_GROUPS: readonly BoardGroupBy[] = [
  'none',
  'milestone',
  'goal',
  'origin',
  'assignee',
  'iteration',
  'type',
  'subproject'
]
const BOARD_SORTS: readonly BoardSortBy[] = ['manual', 'priority', 'targetDate', 'title', 'created']

export const BOARD_VIEW_SPEC: TaskViewSpec<BoardViewOptions> = {
  normalize: (raw) => {
    const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    return {
      groupBy:
        BOARD_GROUPS.includes(value.groupBy as BoardGroupBy) ||
        (typeof value.groupBy === 'string' && /^field:./.test(value.groupBy))
          ? (value.groupBy as BoardGroupBy)
          : 'none',
      sortBy: BOARD_SORTS.includes(value.sortBy as BoardSortBy)
        ? (value.sortBy as BoardSortBy)
        : 'manual',
      sortDir: value.sortDir === 'desc' ? 'desc' : 'asc',
      cardFields: Array.isArray(value.cardFields)
        ? [...new Set(value.cardFields.filter((id): id is string => typeof id === 'string'))]
        : [],
      showBoxes: value.showBoxes === true,
      hiddenColumns: Array.isArray(value.hiddenColumns)
        ? [
            ...new Set(
              value.hiddenColumns.filter(
                (key): key is string =>
                  typeof key === 'string' &&
                  ((TASK_STATUSES as readonly string[]).includes(key) ||
                    columnIdOfKey(key) !== null)
              )
            )
          ]
        : [],
      columnOptions: normalizeColumnOptions(value.columnOptions)
    }
  }
}
