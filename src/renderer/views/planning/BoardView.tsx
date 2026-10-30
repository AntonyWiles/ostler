import { iterationDates, iterationStatusLabel } from '../../iterations/iteration-words'
import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode
} from 'react'
import type { PlanningWorkItem, PlanningWorkItemStatus } from '@shared/ostler-api'
import { dropIndex } from '@shared/planning/board'
import { fieldIdOf, groupByField, groupTasks, isGroupableField } from '@shared/planning/list'
import { groupableSubprojects } from './subproject-ui'
import { type PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { MemoPlanningCard } from './PlanningCard'
import { BoardColumnItems } from './BoardColumnItems'
import { BoardFilterBar } from './BoardToolbar'
import { TaskBulkBar, TaskToolbarRow } from './TaskBulkBar'
import { useBoardKeyboardNav, type BoardPlaceMove } from '../../hooks/useBoardKeyboardNav'
import type { BoardColumn } from '../../hooks/planning/columns'
import {
  Badge,
  Button,
  ContextMenu,
  Dialog,
  EmptyState,
  IconButton,
  NumberField,
  StatusBadge,
  useAnnounce,
  useReorderMotion,
  type MenuEntry
} from '../../ui'
import {
  chevronClass,
  ChevronRight,
  Columns3Cog,
  EyeOff,
  ListChecks,
  Plus,
  SquareKanban
} from '../../ui/icons'
import { useOptionalSearchParams } from '../../hooks/useOptionalSearchParams'
import { CUSTOMISE_BOARD_PARAM } from '../../navigation/paths'
import { useMyShareRole } from '../../hooks/useMyShareRole'
import { capabilitiesOf } from '@shared/share-roles'
import { usePeople } from '../../context/PeopleContext'
import './BoardView.css'
import { t } from '@shared/i18n'
import { Trans } from '../../i18n/Trans'

/** The column's count, and its WIP limit as "3 / 5" (warning colour when over). */
function ColumnCount({
  status,
  count,
  ws,
  limited = true
}: {
  status: PlanningWorkItemStatus
  count: number
  ws: PlanningWorkspace
  /** False for a column of the project's own (MOP-26): WIP limits are a status's. */
  limited?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<number | null>(null)
  const limit = ws.wipLimits[status]
  const overLimit = limit !== undefined && count > limit
  const word = ws.statusWords.label(status)

  if (!limited)
    return (
      <span className="board-column__count" aria-label={t('tasks:boardView.countOnly', { count })}>
        {count}
      </span>
    )

  if (editing) {
    return (
      <form
        className="board-column__wip-editor"
        onSubmit={(event) => {
          event.preventDefault()
          if (draft !== null && (!Number.isInteger(draft) || draft < 1)) return
          void ws.setColumnWipLimit(status, draft)
          setEditing(false)
        }}
      >
        <NumberField
          label={t('tasks:boardView.wipLimit', { word })}
          hideLabel
          autoFocus
          min={1}
          placeholder={t('tasks:boardView.noLimit')}
          value={draft}
          onChange={setDraft}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setEditing(false)
            }
          }}
        />
      </form>
    )
  }

  return (
    <button
      type="button"
      className={`board-column__count${overLimit ? ' is-over' : ''}`}
      title={
        limit === undefined
          ? t('tasks:boardView.setWipLimitColumn')
          : t('tasks:boardView.clickChangeClearLimit', { count, limit })
      }
      aria-label={
        limit === undefined
          ? t('tasks:boardView.countEdit', { count })
          : overLimit
            ? t('tasks:boardView.countOverLimitEdit', { count, limit })
            : t('tasks:boardView.countLimitEdit', { count, limit })
      }
      onClick={() => {
        setDraft(limit ?? null)
        setEditing(true)
      }}
    >
      {limit !== undefined ? `${count} / ${limit}` : count}
    </button>
  )
}

/**
 * Under Manual, where a card dragged over `column` at height `clientY` would
 * land: before the first card whose middle is below the pointer, else after
 * the last card. Only rendered cards are measured, which with a virtualised
 * column are the ones near the pointer, so the answer is the same.
 */
export function pointerIndex(
  column: HTMLElement,
  clientY: number,
  items: PlanningWorkItem[]
): number {
  const cards = column.querySelectorAll<HTMLElement>('.task-card[data-work-item-id]')
  let after: string | undefined
  for (const card of cards) {
    const box = card.getBoundingClientRect()
    if (clientY < box.top + box.height / 2) {
      const index = items.findIndex((item) => item.id === card.dataset.workItemId)
      if (index >= 0) return index
    }
    after = card.dataset.workItemId
  }
  if (after === undefined) return items.length
  const last = items.findIndex((item) => item.id === after)
  return last < 0 ? items.length : last + 1
}

/** "Moved above Pay invoice, 3 of 8": what a keyboard move says. */
function placeAnnouncement(move: BoardPlaceMove): string {
  const values = { position: move.position, count: move.count }
  if (move.kind === 'column')
    return t('tasks:boardView.movedToColumn', { ...values, column: move.label })
  return t(move.kind === 'above' ? 'tasks:boardView.movedAbove' : 'tasks:boardView.movedBelow', {
    ...values,
    title: move.neighbour?.title ?? ''
  })
}

interface Swimlane {
  id: string
  title: string
  subtitle?: string
  milestoneId?: string | null
  items: PlanningWorkItem[]
}

/** A click on one of these is theirs: it does not clear the selection. */
const BLANK_CLICK_KEEPS =
  'button, a, input, select, textarea, label, [role="menuitem"], [role="dialog"]'

/**
 * The Kanban board: one
 * toolbar row, covered by the bulk bar while tasks are selected, then the
 * columns or the swimlanes. `toolbarEnd` holds the view's own action at the
 * end of the toolbar (Suggest tasks, when AI is set up).
 */
export function BoardView({ ws, toolbarEnd }: { ws: PlanningWorkspace; toolbarEnd?: ReactNode }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const boardRef = useRef<HTMLDivElement | null>(null)
  useReorderMotion(boardRef)
  const selecting = selectedIds.length > 0
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const toggleSelected = (id: string, checked: boolean) =>
    setSelectedIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((candidate) => candidate !== id)
    )
  /**
   * One control per column rather than a box per card: selecting the whole
   * of Ready was the common intent and it used to mean eighteen clicks.
   */
  const toggleColumnSelected = (columnItems: PlanningWorkItem[], select: boolean) => {
    const ids = new Set(columnItems.map((item) => item.id))
    setSelectedIds((current) =>
      select
        ? [...new Set([...current, ...ids])]
        : current.filter((candidate) => !ids.has(candidate))
    )
  }

  /**
   * The rest of a dragged selection follows the card that was dropped: into
   * the column's status (and the lane's milestone), at the end of the column
   * under Manual. Tasks an agent holds move by the queue's own rules.
   */
  const moveAlongside = (
    ids: string[],
    target: BoardColumn,
    milestoneId: string | null | undefined
  ) => {
    const { status, columnId } = target
    const items = ids.flatMap((id) => {
      const item = ws.workItemsById.get(id)
      return item ? [item] : []
    })
    const free = items.filter((item) => !item.linkedHarnessTaskId)
    if (milestoneId !== undefined && free.length > 0) {
      void ws.bulkUpdateWorkItems(
        free.map((item) => item.id),
        { status, columnId, milestoneId }
      )
    } else {
      for (const item of free) void ws.moveWorkItem(item, status, columnId)
    }
    for (const item of items)
      if (item.linkedHarnessTaskId) void ws.moveWorkItem(item, status, columnId)
  }

  // Counted once for the board, not once per card.
  const subtaskCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of ws.workItems) {
      if (item.parentWorkItemId)
        counts.set(item.parentWorkItemId, (counts.get(item.parentWorkItemId) ?? 0) + 1)
    }
    return counts
  }, [ws.workItems])

  const announce = useAnnounce()
  const [params, setParams] = useOptionalSearchParams()
  const dragged = ws.draggingWorkItemId ? ws.workItemsById.get(ws.draggingWorkItemId) : undefined
  const people = usePeople()
  const canCreate = capabilitiesOf(useMyShareRole(ws.projectId)).createTasks

  // Each grouping is built only when it is the one shown (P9.1): with
  // thousands of tasks, building all four on every render was measurable.
  const milestoneLanes = (): Swimlane[] => [
    ...ws.milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.name,
      subtitle:
        milestone.outcome ||
        (milestone.targetDate
          ? t('tasks:boardView.due', { targetDate: milestone.targetDate })
          : undefined),
      milestoneId: milestone.id,
      items: ws.filteredWorkItems.filter((item) => item.milestoneId === milestone.id)
    })),
    {
      id: 'unassigned',
      title: t('tasks:boardView.noMilestone'),
      subtitle: t('tasks:boardView.tasksNotAnyMilestone'),
      milestoneId: null,
      items: ws.filteredWorkItems.filter((item) => !item.milestoneId)
    }
  ]

  const goalLanes = (): Swimlane[] => [
    ...ws.goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      subtitle: goal.outcome || undefined,
      items: ws.filteredWorkItems.filter((item) => ws.goalIdForItem(item) === goal.id)
    })),
    {
      id: 'no-goal',
      title: t('tasks:boardView.noGoal'),
      subtitle: t('tasks:boardView.tasksWhoseMilestoneHas'),
      items: ws.filteredWorkItems.filter((item) => !ws.goalIdForItem(item))
    }
  ]

  const originLanes = (): Swimlane[] => [
    {
      id: 'origin-human',
      title: t('tasks:boardView.humanAuthored'),
      subtitle: t('tasks:boardView.createdDirectlyTeamMembers'),
      items: ws.filteredWorkItems.filter((item) => item.origin === 'human')
    },
    {
      id: 'origin-ai-approved',
      title: t('tasks:boardView.aiApproved'),
      subtitle: t('tasks:boardView.proposedAiApprovedPerson'),
      items: ws.filteredWorkItems.filter((item) => item.origin === 'ai-approved')
    },
    {
      id: 'origin-imported',
      title: t('tasks:boardView.imported'),
      subtitle: t('tasks:boardView.importedOtherToolsAgents'),
      items: ws.filteredWorkItems.filter((item) => item.origin === 'imported')
    }
  ]

  // One lane per option of a Choice field (or Yes and No), then the tasks with none (R2.2).
  // A grouping by a field that is gone shows the board ungrouped.
  const groupFieldId = fieldIdOf(ws.boardGroupBy)
  const groupField = (() => {
    const field = groupFieldId === null ? undefined : ws.fields.find((f) => f.id === groupFieldId)
    return field && isGroupableField(field) ? field : undefined
  })()
  const ungrouped = ws.boardGroupBy === 'none' || (groupFieldId !== null && !groupField)

  const boardColumns = useMemo(
    () =>
      ws.shownColumns.map((column) => ({
        ...column,
        items: ws.itemsByStatus.get(column.key) ?? []
      })),
    [ws.shownColumns, ws.itemsByStatus]
  )
  // A project may hide columns (R2.4), and a view more for now (Columns in
  // the toolbar): the grid has as many as it shows.
  const columnCount = { '--board-column-count': ws.shownColumns.length } as CSSProperties
  const focusedItemId = useBoardKeyboardNav({
    columns: boardColumns,
    enabled: ungrouped,
    onOpen: (item) => ws.openWorkItem(item),
    onMove: (item, status, columnId) => void ws.moveWorkItem(item, status, columnId),
    onPlace:
      ws.boardSortBy === 'manual'
        ? (item, move) => {
            if (!move) {
              announce(t('tasks:boardView.cannotMoveFurther'))
              return
            }
            // A queued card changes column through the harness, as with Shift and an arrow.
            if (item.linkedHarnessTaskId && move.kind === 'column')
              void ws.moveWorkItem(item, move.status, move.columnId)
            else
              void ws.placeWorkItem(
                item,
                item.linkedHarnessTaskId ? { ...move.placement, status: undefined } : move.placement
              )
            announce(placeAnnouncement(move))
          }
        : undefined
  })

  // Me first, then everyone else with work here, then unassigned work.
  const assigneeLanes = (): Swimlane[] => [
    ...people.all
      .filter(
        (person) =>
          person.isMe || ws.filteredWorkItems.some((item) => item.assigneeId === person.id)
      )
      .map((person) => ({
        id: `assignee-${person.id}`,
        title: person.isMe ? t('tasks:boardView.you', { personName: person.name }) : person.name,
        subtitle: person.archivedAt ? t('tasks:boardView.archived') : undefined,
        items: ws.filteredWorkItems.filter((item) => item.assigneeId === person.id)
      })),
    {
      id: 'assignee-none',
      title: t('tasks:boardView.unassigned'),
      subtitle: t('tasks:boardView.tasksNobodyDoingYet'),
      items: ws.filteredWorkItems.filter(
        (item) => !item.assigneeId || !people.byId.has(item.assigneeId)
      )
    }
  ]

  // Iterations in date order, the current one first (R6.1), then the tasks in none.
  const iterationLanes = (): Swimlane[] => {
    const ordered = [
      ...ws.iterations.filter((iteration) => iteration.id === ws.currentIterationId),
      ...ws.iterations.filter((iteration) => iteration.id !== ws.currentIterationId)
    ]
    return [
      ...ordered.map((iteration) => ({
        id: `iteration-${iteration.id}`,
        title: iteration.name,
        subtitle: [iterationDates(iteration), iterationStatusLabel(iteration.status)].join(' · '),
        items: ws.filteredWorkItems.filter((item) => item.iterationId === iteration.id)
      })),
      {
        id: 'iteration-none',
        title: t('tasks:iterations.noIteration'),
        subtitle: t('tasks:iterations.laneNoneSubtitle'),
        items: ws.filteredWorkItems.filter(
          (item) =>
            !item.iterationId ||
            !ws.iterations.some((iteration) => iteration.id === item.iterationId)
        )
      }
    ]
  }

  // The project's types in its order, then the tasks with none (N2.7a): the List's grouping.
  const typeLanes = (): Swimlane[] =>
    groupTasks(ws.filteredWorkItems, 'type', {
      projectedStatus: ws.projectedStatus,
      milestones: ws.milestones,
      people: [],
      taskTypes: ws.taskTypes
    }).map((group) => ({ id: group.key, title: group.label, items: group.items }))

  // The project's workstreams in order, then the tasks with none: the List's grouping.
  const subprojectLanes = (): Swimlane[] =>
    groupTasks(ws.filteredWorkItems, 'subproject', {
      projectedStatus: ws.projectedStatus,
      milestones: ws.milestones,
      people: [],
      subprojects: groupableSubprojects(ws.subprojects, ws.filteredWorkItems)
    }).map((group) => ({ id: group.key, title: group.label, items: group.items }))

  const fieldLanes = (): Swimlane[] =>
    groupField
      ? groupByField(ws.filteredWorkItems, groupField).map((group) => ({
          id: group.key,
          title: group.label,
          items: group.items
        }))
      : []

  const lanes = groupField
    ? fieldLanes()
    : ws.boardGroupBy === 'assignee'
      ? assigneeLanes()
      : ws.boardGroupBy === 'iteration'
        ? iterationLanes()
        : ws.boardGroupBy === 'type'
          ? typeLanes()
          : ws.boardGroupBy === 'subproject'
            ? subprojectLanes()
            : ws.boardGroupBy === 'milestone'
              ? milestoneLanes()
              : ws.boardGroupBy === 'goal'
                ? goalLanes()
                : ws.boardGroupBy === 'origin'
                  ? originLanes()
                  : []

  /** One column, on the board or inside a lane. */
  const renderColumn = (target: BoardColumn, items: PlanningWorkItem[], lane?: Swimlane) => {
    const { status, key } = target
    const word = target.label
    // "Ready", or "Ready in Website launch" inside a swimlane.
    const column = lane
      ? t('tasks:boardView.columnInLane', { column: word, lane: lane.title })
      : word
    const laneId = lane?.id ?? null
    const isDropTarget = ws.dragOverStatus === key && ws.dragOverLaneId === laneId
    const insertAt =
      isDropTarget && dragged
        ? dropIndex(
            items,
            dragged,
            ws.boardSortBy,
            ws.boardSortDir,
            ws.dragOverIndex ?? items.length
          )
        : null
    const allSelected = items.length > 0 && items.every((item) => selectedSet.has(item.id))
    const onDragOver = (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (ws.dragOverStatus !== key) ws.setDragOverStatus(key)
      if (ws.dragOverLaneId !== laneId) ws.setDragOverLaneId(laneId)
      if (ws.boardSortBy === 'manual') {
        const index = pointerIndex(event.currentTarget, event.clientY, items)
        if (ws.dragOverIndex !== index) ws.setDragOverIndex(index)
      }
    }
    const Heading = lane ? 'h4' : 'h2'
    const createHere = () =>
      ws.openWorkItemCreate(
        status,
        lane && ws.boardGroupBy === 'milestone' && lane.milestoneId ? lane.milestoneId : '',
        target.columnId
      )
    // Right-click on the column's own space (MOP-36); a card keeps its own menu.
    const columnMenu = (): MenuEntry[] => [
      { label: t('tasks:boardView.newTask', { column }), icon: Plus, onSelect: createHere },
      ...(items.length > 0
        ? [
            {
              label: allSelected
                ? t('tasks:boardView.deselectAll', { column })
                : t('tasks:boardView.selectAll', { column }),
              icon: ListChecks,
              onSelect: () => toggleColumnSelected(items, !allSelected)
            }
          ]
        : []),
      { type: 'separator' },
      {
        label: t('tasks:boardView.hideColumn'),
        icon: EyeOff,
        disabled: ws.shownColumns.length <= 1,
        onSelect: () => ws.setBoardHiddenColumns([...ws.boardHiddenColumns, key])
      },
      {
        label: t('tasks:boardLayout.openMenu'),
        icon: Columns3Cog,
        onSelect: () => {
          const next = new URLSearchParams(params)
          next.set(CUSTOMISE_BOARD_PARAM, '1')
          setParams(next)
        }
      }
    ]
    return (
      <ContextMenu
        key={key}
        label={t('tasks:boardView.columnActions', { column })}
        items={columnMenu}
      >
        <section
          className={`board-column ostler-planning-column ostler-planning-column--${status}${isDropTarget ? ' is-drop-target' : ''}${ws.peekHiddenColumns && ws.boardHiddenColumns.includes(key) ? ' is-peeked' : ''}`}
          aria-label={column}
          onDragOver={onDragOver}
          onDragLeave={(event) => {
            // Leaving for one of the column's own cards is not leaving it.
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            if (isDropTarget) {
              ws.setDragOverStatus(null)
              ws.setDragOverLaneId(null)
            }
          }}
          onDrop={(event) => {
            event.preventDefault()
            const dataId = event.dataTransfer.getData('text/plain')
            const milestoneId =
              lane && ws.boardGroupBy === 'milestone' ? lane.milestoneId : undefined
            // A selected card carries the whole selection with it.
            const alongside =
              dataId && selectedSet.has(dataId) ? selectedIds.filter((id) => id !== dataId) : []
            ws.dropWorkItem(key, milestoneId, dataId || undefined, items)
            if (alongside.length > 0) moveAlongside(alongside, target, milestoneId)
          }}
        >
          <header className="board-column__header" title={target.hint}>
            <Heading className="board-column__title">
              <StatusBadge status={status} columnId={target.columnId} />
            </Heading>
            <ColumnCount
              status={status}
              count={items.length}
              ws={ws}
              limited={target.columnId === null}
            />
            <div className="board-column__actions">
              {items.length > 0 && (
                <IconButton
                  size="sm"
                  icon={ListChecks}
                  className={selecting ? 'is-visible' : undefined}
                  label={
                    allSelected
                      ? t('tasks:boardView.deselectAll', { column })
                      : t('tasks:boardView.selectAll', { column })
                  }
                  pressed={allSelected}
                  onClick={() => toggleColumnSelected(items, !allSelected)}
                />
              )}
              <IconButton
                size="sm"
                icon={Plus}
                label={t('tasks:boardView.newTask', { column })}
                disabled={!canCreate}
                onClick={createHere}
              />
            </div>
          </header>
          <div className="board-column__items">
            <BoardColumnItems
              items={items}
              insertAt={insertAt}
              draggedId={ws.draggingWorkItemId}
              focusedId={lane ? null : focusedItemId}
              renderCard={(item) => (
                <MemoPlanningCard
                  key={item.id}
                  item={item}
                  ws={ws}
                  focused={!lane && item.id === focusedItemId}
                  dragging={item.id === ws.draggingWorkItemId}
                  selected={selectedSet.has(item.id)}
                  selecting={selecting}
                  showBoxes={ws.boardShowBoxes}
                  subtaskCount={subtaskCounts.get(item.id) ?? 0}
                  onToggle={(checked) => toggleSelected(item.id, checked)}
                />
              )}
            />
            {/* Kept while a card is dragged over: removing the node under the
              pointer mid-drag makes Chromium drop the drop. */}
            {!ws.loading && items.length === 0 && (
              <p className="board-column__empty">{t('tasks:boardView.noTasks')}</p>
            )}
          </div>
        </section>
      </ContextMenu>
    )
  }

  return (
    <div
      ref={boardRef}
      className="board"
      onClick={(event) => {
        // A click on the board's empty space lets go of the selection.
        if (!selecting) return
        const target = event.target as HTMLElement
        if (!target.closest('.board__columns, .board-lane')) return
        if (target.closest(`[data-work-item-id], ${BLANK_CLICK_KEEPS}`)) return
        setSelectedIds([])
      }}
      onDragOver={(event) => {
        // Between columns and around them a dragged card is not refused.
        if (!ws.draggingWorkItemId) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        if (ws.draggingWorkItemId) event.preventDefault()
      }}
    >
      <TaskToolbarRow
        toolbar={<BoardFilterBar ws={ws} end={toolbarEnd} />}
        bulkBar={
          selecting ? (
            <TaskBulkBar ws={ws} selectedIds={selectedIds} onClear={() => setSelectedIds([])} />
          ) : null
        }
      />

      {/* Under another sort a card cannot be placed by hand: say how to get that back. */}
      <p className="board__sort-hint" role="status">
        {dragged && ws.boardSortBy !== 'manual'
          ? t('tasks:boardView.sortedHint', {
              sort: t(`tasks:boardView.sortName.${ws.boardSortBy}`)
            })
          : ''}
      </p>

      {!ws.loading && ws.workItems.length === 0 && (
        <EmptyState
          className="board__empty"
          icon={SquareKanban}
          title={t('tasks:boardView.noTasksYet')}
          description={t('tasks:boardView.tasksStepsProjectEach')}
          action={
            <Button
              variant="primary"
              icon={Plus}
              disabled={!canCreate}
              onClick={() => ws.openWorkItemCreate()}
            >
              {t('tasks:boardView.newTask2')}
            </Button>
          }
        />
      )}

      {ungrouped ? (
        <div
          className="board__columns ostler-planning-board"
          style={columnCount}
          aria-label={t('tasks:boardView.planningBoard')}
          aria-busy={ws.loading}
        >
          {boardColumns.map((column) => renderColumn(column, column.items))}
        </div>
      ) : (
        <div
          className="board__lanes ostler-planning-swimlanes"
          aria-label={t('tasks:boardView.planningSwimlanes')}
          aria-busy={ws.loading}
        >
          {lanes.map((lane) => {
            const collapsed = ws.collapsedLaneIds.includes(lane.id)
            return (
              <section
                className={`board-lane ostler-planning-swimlane${collapsed ? ' is-collapsed' : ''}`}
                key={lane.id}
                aria-label={t('tasks:boardView.swimlane', { laneTitle: lane.title })}
              >
                <header className="board-lane__header">
                  <IconButton
                    size="sm"
                    icon={ChevronRight}
                    iconClassName={chevronClass(!collapsed)}
                    aria-expanded={!collapsed}
                    label={
                      collapsed
                        ? t('tasks:boardView.expand', { laneTitle: lane.title })
                        : t('tasks:boardView.collapse', { laneTitle: lane.title })
                    }
                    onClick={() => ws.toggleLaneCollapsed(lane.id)}
                  />
                  <div className="board-lane__titles">
                    <h3>{lane.title}</h3>
                    {lane.subtitle && <p>{lane.subtitle}</p>}
                  </div>
                  <Badge>{t('tasks:boardView.tasks', { count: lane.items.length })}</Badge>
                </header>
                {!collapsed && (
                  <div className="board-lane__grid" style={columnCount}>
                    {ws.shownColumns.map((column) =>
                      renderColumn(
                        column,
                        lane.items.filter((item) => ws.columnOf(item) === column.key),
                        lane
                      )
                    )}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      <MilestoneMoveDialog ws={ws} />
    </div>
  )
}

/** Dropping a card into another milestone's lane changes its milestone: asked first. */
function MilestoneMoveDialog({ ws }: { ws: PlanningWorkspace }) {
  const move = ws.pendingMilestoneMove
  const milestoneName = (id: string | null) =>
    id
      ? (ws.milestoneNames.get(id) ?? t('tasks:boardView.milestone'))
      : t('tasks:boardView.noMilestone')
  return (
    <Dialog
      open={move !== null}
      onClose={() => ws.cancelMilestoneMove()}
      size="sm"
      title={t('tasks:boardView.moveTaskMilestone')}
      footer={
        <>
          <Button variant="secondary" onClick={() => ws.cancelMilestoneMove()}>
            {t('tasks:boardView.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void ws.confirmMilestoneMove()}>
            {t('tasks:boardView.moveTask')}
          </Button>
        </>
      }
    >
      {move && (
        <p>
          <Trans
            i18nKey={
              move.targetStatus !== ws.projectedStatus(move.item)
                ? 'tasks:boardView.moveMilestoneAndStatus'
                : 'tasks:boardView.moveMilestone'
            }
            values={{
              title: move.item.title,
              from: milestoneName(move.item.milestoneId),
              to: milestoneName(move.targetMilestoneId),
              status: ws.statusWords.label(move.targetStatus)
            }}
            components={{ strong: <strong /> }}
          />
        </p>
      )}
    </Dialog>
  )
}
