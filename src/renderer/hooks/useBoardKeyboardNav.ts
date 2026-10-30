import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PlanningWorkItem,
  PlanningWorkItemPlacement,
  PlanningWorkItemStatus
} from '@shared/ostler-api'
import { columnPlacement, stepPlacement } from '@shared/planning/board'
import { isTypingTarget } from '../utils/dom'

export interface BoardColumn {
  status: PlanningWorkItemStatus
  /** A column of the project's own (MOP-26), or null for the status's own. */
  columnId: string | null
  /** The column's name, for announcements. */
  label: string
  items: PlanningWorkItem[]
}

interface BoardKeyboardNavOptions {
  columns: BoardColumn[]
  /** False while the board is not the visible surface, so the keys stay inert. */
  enabled: boolean
  onOpen: (item: PlanningWorkItem) => void
  onMove: (item: PlanningWorkItem, status: PlanningWorkItemStatus, columnId: string | null) => void
  /**
   * Under Manual order: Alt and an arrow key place the focused card (D31).
   * `move` says where it went, to be announced; null when it cannot go
   * further. Leave out to keep Alt and the arrows inert.
   */
  onPlace?: (item: PlanningWorkItem, move: BoardPlaceMove | null) => void
}

/** A keyboard move under Manual order and the words that announce it. */
export interface BoardPlaceMove {
  placement: PlanningWorkItemPlacement
  /** Above or below `neighbour` in its column, or into another column. */
  kind: 'above' | 'below' | 'column'
  neighbour?: PlanningWorkItem
  status: PlanningWorkItemStatus
  columnId: string | null
  /** The column's name. */
  label: string
  /** 1-based, among `count` cards once it has moved. */
  position: number
  count: number
}

/**
 * Arrow/hjkl movement over the board, Enter to open, Shift+left/right to move a
 * card between columns.
 *
 * Reordering used to require a drag, and opening an item required finding and
 * clicking its title. Shift+arrow in particular replaces the board's only
 * mouse-exclusive gesture -- there was previously no way at all to change an
 * item's status from the board without dragging it.
 *
 * Only the ungrouped board is covered. Swimlanes are a two-dimensional grid per
 * lane, and guessing at what "up" means across lane boundaries would be worse
 * than leaving the keys inert there.
 */
export function useBoardKeyboardNav({
  columns,
  enabled,
  onOpen,
  onMove,
  onPlace
}: BoardKeyboardNavOptions): string | null {
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null)

  // The handler reads live values through a ref so the listener is bound once
  // rather than re-bound on every board re-render (which is every poll tick).
  const stateRef = useRef({ columns, onOpen, onMove, onPlace })
  stateRef.current = { columns, onOpen, onMove, onPlace }

  const locate = useCallback((itemId: string | null) => {
    const { columns: cols } = stateRef.current
    for (let column = 0; column < cols.length; column++) {
      const row = cols[column].items.findIndex((item) => item.id === itemId)
      if (row >= 0) return { column, row }
    }
    return null
  }, [])

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.key.startsWith('Arrow')
      ) {
        placeByKey(event)
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.defaultPrevented || isTypingTarget(event.target)) return
      // An open overlay or menu owns the keyboard; the board is behind it.
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return

      const { columns: cols, onOpen: open, onMove: move } = stateRef.current
      const key = event.key
      // Enter and the arrow keys belong to whatever control has focus (a
      // button, a tab, a checkbox); the board takes them only on a card or
      // when nothing has focus (P9.2). h, j, k and l work from anywhere.
      if ((key === 'Enter' || key.startsWith('Arrow')) && !isBoardTarget(event.target)) return
      const vertical =
        key === 'j' || key === 'ArrowDown' ? 1 : key === 'k' || key === 'ArrowUp' ? -1 : 0
      const horizontal =
        key === 'l' || key === 'ArrowRight' ? 1 : key === 'h' || key === 'ArrowLeft' ? -1 : 0
      if (!vertical && !horizontal && key !== 'Enter' && key !== 'Escape') return

      const current = locate(focusedItemId)

      if (key === 'Escape') {
        if (!focusedItemId) return
        event.preventDefault()
        setFocusedItemId(null)
        return
      }

      if (key === 'Enter') {
        if (!current) return
        event.preventDefault()
        open(cols[current.column].items[current.row])
        return
      }

      // Nothing focused yet: the first key lands on the first card there is.
      if (!current) {
        const firstColumn = cols.find((column) => column.items.length > 0)
        if (!firstColumn) return
        event.preventDefault()
        setFocusedItemId(firstColumn.items[0].id)
        return
      }

      const item = cols[current.column].items[current.row]

      if (horizontal && event.shiftKey) {
        const target = cols[current.column + horizontal]
        if (!target) return
        event.preventDefault()
        // Focus follows the card, so a run of Shift+right walks it across the
        // board without the user re-finding it after each hop.
        move(item, target.status, target.columnId)
        return
      }

      event.preventDefault()
      if (vertical) {
        const items = cols[current.column].items
        const nextRow = current.row + vertical
        if (nextRow < 0 || nextRow >= items.length) return
        setFocusedItemId(items[nextRow].id)
        return
      }

      // Horizontal: land on the nearest row in the target column, so moving
      // sideways past a short column does not dump focus back at the top.
      for (
        let column = current.column + horizontal;
        column >= 0 && column < cols.length;
        column += horizontal
      ) {
        const items = cols[column].items
        if (items.length === 0) continue
        setFocusedItemId(items[Math.min(current.row, items.length - 1)].id)
        return
      }
    }

    /** Alt and an arrow key on the focused card, under Manual order (D31). */
    const placeByKey = (event: KeyboardEvent) => {
      const { columns: cols, onPlace: place } = stateRef.current
      if (!place || event.defaultPrevented || isTypingTarget(event.target)) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return
      if (!isBoardTarget(event.target)) return
      const current = locate(focusedItemId)
      if (!current) return
      event.preventDefault()
      const column = cols[current.column]
      const items = column.items
      const item = items[current.row]
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const step = event.key === 'ArrowUp' ? -1 : 1
        const placement = stepPlacement(items, item, step)
        place(
          item,
          placement && {
            placement,
            kind: step < 0 ? 'above' : 'below',
            neighbour: items[current.row + step],
            status: column.status,
            columnId: column.columnId,
            label: column.label,
            position: current.row + step + 1,
            count: items.length
          }
        )
        return
      }
      const target = cols[current.column + (event.key === 'ArrowRight' ? 1 : -1)]
      if (!target) {
        place(item, null)
        return
      }
      const row = Math.min(current.row, target.items.length)
      place(item, {
        placement: columnPlacement(target.items, current.row, target.status, target.columnId),
        kind: 'column',
        status: target.status,
        columnId: target.columnId,
        label: target.label,
        position: row + 1,
        count: target.items.length + 1
      })
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled, focusedItemId, locate])

  // Drop focus when the focused card leaves the board (filtered out, deleted).
  useEffect(() => {
    if (focusedItemId && !locate(focusedItemId)) setFocusedItemId(null)
  }, [columns, focusedItemId, locate])

  return enabled ? focusedItemId : null
}

/** Nothing in particular, or a card itself: where the board's Enter and arrows apply. */
function isBoardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target === document.body) return true
  return target.matches('.task-card')
}
