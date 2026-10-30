import { useMemo, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { PlanningWorkItem } from '@shared/ostler-api'
import {
  MATRIX_BOXES,
  isImportantBox,
  isUrgentBox,
  matrixBoxOf,
  priorityForRow,
  sortIntoMatrix,
  type MatrixBox
} from '@shared/planning/matrix'
import { taskPriorityLabel } from '@shared/task-labels'
import { t } from '@shared/i18n'
import type { PlanningWorkspace } from '../../../hooks/usePlanningWorkspace'
import { useToday } from '../../../hooks/useToday'
import { isTypingTarget } from '../../../utils/dom'
import { Badge, Button, Toolbar, useAnnounce, useToast } from '../../../ui'
import { shortcutText } from '../../../ui/Kbd'
import { shortcut } from '../../../navigation/shortcuts'
import { MemoPlanningCard } from '../PlanningCard'
import { TaskFilterFields } from '../TaskFilterFields'
import { HiddenTasksNote } from '../HiddenTasksNote'
import '../TaskToolbar.css'
import './MatrixView.css'

/** Where each box sits: row 0 is important, column 0 is urgent. */
const GRID: MatrixBox[][] = [
  ['urgentImportant', 'important'],
  ['urgent', 'neither']
]

function position(box: MatrixBox): { row: number; column: number } {
  return { row: isImportantBox(box) ? 0 : 1, column: isUrgentBox(box) ? 0 : 1 }
}

/**
 * The priority matrix (N7.5, N53): the Board's open tasks in four boxes, from
 * priority (important: high and critical) and due date (urgent: overdue or
 * due within three days). It shows the Board's tasks through the Board's
 * filters and search, and its cards are the Board's cards. Moving a card up
 * or down changes its priority, with undo; urgency comes from the due date,
 * so a move across is refused and explained.
 */
export function MatrixView({ ws }: { ws: PlanningWorkspace }) {
  const today = useToday()
  const announce = useAnnounce()
  const { toastUndo } = useToast()
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [dragOverBox, setDragOverBox] = useState<MatrixBox | null>(null)
  /** The task a move across was refused for, with the way to change its date. */
  const [refused, setRefused] = useState<PlanningWorkItem | null>(null)

  const { projectedStatus } = ws
  const boxes = useMemo(
    () =>
      sortIntoMatrix(
        ws.filteredWorkItems.filter((item) => projectedStatus(item) !== 'done'),
        today
      ),
    [ws.filteredWorkItems, projectedStatus, today]
  )

  const boxLabel = (box: MatrixBox) => t(`tasks:matrix.box.${box}`)

  /** Moves `item` into `target`: a new priority up or down, refused across. */
  const moveTo = (item: PlanningWorkItem, target: MatrixBox) => {
    const source = matrixBoxOf(item, today)
    if (source === target) return
    if (isUrgentBox(source) !== isUrgentBox(target)) {
      setRefused(item)
      announce(t('tasks:matrix.acrossRefused'))
      return
    }
    const priority = priorityForRow(item.priority, isImportantBox(target))
    if (!priority) return
    setRefused(null)
    const before = item.priority
    void ws.updateWorkItemInline(item, { priority }).then((saved) => {
      if (!saved) return
      const message = t('tasks:matrix.priorityChanged', {
        title: item.title,
        priority: taskPriorityLabel(priority)
      })
      announce(t('tasks:matrix.movedTo', { title: item.title, box: boxLabel(target) }))
      toastUndo(message, () => ws.updateWorkItemInline({ ...item, priority }, { priority: before }))
    })
  }

  const locate = (id: string | null) => {
    for (const box of MATRIX_BOXES) {
      const index = boxes[box].findIndex((item) => item.id === id)
      if (index >= 0) return { box, index }
    }
    return null
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.defaultPrevented || isTypingTarget(event.target)) return
    const target = event.target as HTMLElement
    // The keys belong to a card's own buttons; the matrix takes them on a card or itself.
    if (target !== event.currentTarget && !target.matches('.task-card')) return
    const key = event.key
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(key))
      return
    const current = locate(focusedId)
    if (key === 'Escape') {
      if (refused) setRefused(null)
      return
    }
    if (!current) {
      const first = MATRIX_BOXES.find((box) => boxes[box].length > 0)
      if (!first || key === 'Enter') return
      event.preventDefault()
      setFocusedId(boxes[first][0].id)
      return
    }
    const item = boxes[current.box][current.index]
    event.preventDefault()
    if (key === 'Enter') {
      ws.openWorkItem(item)
      return
    }
    const { row, column } = position(current.box)
    if (event.shiftKey) {
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        const nextRow = key === 'ArrowUp' ? 0 : 1
        if (nextRow === row) {
          announce(t('tasks:matrix.cannotMoveFurther'))
          return
        }
        moveTo(item, GRID[nextRow][column])
      } else moveTo(item, GRID[row][column === 0 ? 1 : 0])
      return
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const step = key === 'ArrowUp' ? -1 : 1
      const items = boxes[current.box]
      const next = items[current.index + step]
      if (next) {
        setFocusedId(next.id)
        return
      }
      // Past the end of a box: into the box above or below, at its near end.
      const other = boxes[GRID[row === 0 ? 1 : 0][column]]
      if ((step > 0 && row === 0) || (step < 0 && row === 1)) {
        if (other.length > 0) setFocusedId(step > 0 ? other[0].id : other[other.length - 1].id)
      }
      return
    }
    const other = boxes[GRID[row][column === 0 ? 1 : 0]]
    if ((key === 'ArrowRight' && column === 0) || (key === 'ArrowLeft' && column === 1)) {
      if (other.length > 0) setFocusedId(other[Math.min(current.index, other.length - 1)].id)
    }
  }

  const renderBox = (box: MatrixBox) => {
    const items = boxes[box]
    const label = boxLabel(box)
    const onDragOver = (event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (dragOverBox !== box) setDragOverBox(box)
    }
    return (
      <section
        key={box}
        className={`matrix-box matrix-box--${box}${dragOverBox === box ? ' is-drop-target' : ''}`}
        aria-label={t('tasks:matrix.boxRegion', { box: label, count: items.length })}
        data-matrix-box={box}
        onDragOver={onDragOver}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          if (dragOverBox === box) setDragOverBox(null)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragOverBox(null)
          const id = event.dataTransfer.getData('text/plain') || ws.draggingWorkItemId
          const item = id ? ws.workItemsById.get(id) : undefined
          ws.setDraggingWorkItemId(null)
          if (item) moveTo(item, box)
        }}
      >
        <header className="matrix-box__header">
          <h2 className="matrix-box__title">{label}</h2>
          <Badge>{items.length}</Badge>
        </header>
        <div className="matrix-box__items">
          {items.map((item) => (
            <MemoPlanningCard
              key={item.id}
              item={item}
              ws={ws}
              focused={item.id === focusedId}
              dragging={item.id === ws.draggingWorkItemId}
            />
          ))}
          {!ws.loading && items.length === 0 && (
            <p className="matrix-box__empty">{t('tasks:matrix.empty')}</p>
          )}
        </div>
      </section>
    )
  }

  return (
    <div className="matrix">
      <Toolbar
        label={t('tasks:matrix.filters')}
        className="task-toolbar"
        end={
          <>
            <span className="task-toolbar__count" aria-live="polite">
              {t('tasks:matrix.count', {
                count: MATRIX_BOXES.reduce((sum, box) => sum + boxes[box].length, 0)
              })}
            </span>
            <HiddenTasksNote hidden={ws.boardHidden} />
          </>
        }
      >
        <TaskFilterFields ws={ws} workItems={ws.workItems} filters={ws.boardView} />
      </Toolbar>

      <p className="matrix__hint">
        {t('tasks:matrix.hint', { keys: shortcutText(shortcut('move-task-matrix').keys) })}
      </p>

      <div className="matrix__note" role="status">
        {refused && (
          <>
            <span>{t('tasks:matrix.acrossRefused')}</span>
            <Button size="sm" variant="secondary" onClick={() => ws.openWorkItem(refused)}>
              {t('tasks:matrix.changeDueDate', { title: refused.title })}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRefused(null)}>
              {t('tasks:matrix.dismiss')}
            </Button>
          </>
        )}
      </div>

      <div
        className="matrix__grid"
        role="group"
        aria-label={t('tasks:matrix.label')}
        aria-busy={ws.loading}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <span className="matrix__axis matrix__axis--urgent" aria-hidden="true">
          {t('tasks:matrix.urgent')}
        </span>
        <span className="matrix__axis matrix__axis--not-urgent" aria-hidden="true">
          {t('tasks:matrix.notUrgent')}
        </span>
        {GRID.flat().map(renderBox)}
      </div>
    </div>
  )
}
