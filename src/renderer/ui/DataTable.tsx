import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowDown,
  ArrowUp,
  chevronClass,
  ChevronDown,
  ChevronRight,
  Icon,
  ListFilter
} from './icons'
import { IconButton } from './IconButton'
import { Menu, type MenuItems } from './Menu'
import { VisuallyHidden } from './VisuallyHidden'
import { nextSort, type SortKey } from './data-table-sort'
import { cx } from './cx'
import './DataTable.css'
import { t } from '@shared/i18n'

export { nextSort, sortRows, type SortKey, type SortDirection } from './data-table-sort'
export type { RowComparer } from './data-table-sort'

export interface DataTableColumn<Row> {
  /** Stable: used for widths, order and sort keys. */
  id: string
  header: string
  /** Starting width in px. */
  width?: number
  /** The narrowest a resize may make it, in px. Default 48. */
  minWidth?: number
  /** Makes the column sortable. */
  compare?: (a: Row, b: Row) => number
  /** Empty values sort last in either direction. */
  isEmpty?: (row: Row) => boolean
  align?: 'start' | 'end'
  /**
   * A drop-down in the header offering choices for the column, such as the
   * values to show. `active` marks it while a choice is applied.
   */
  filter?: { label: string; active: boolean; items: MenuItems }
  /** A plain click anywhere in the column's cell, not only on its content. Controls inside the cell keep their own clicks. */
  onCellClick?: (row: Row, event: MouseEvent) => void
  cell: (row: Row, state: { focused: boolean }) => ReactNode
}

/** A collapsible group header, with its count and an optional aggregate. */
export interface DataTableGroupEntry {
  kind: 'group'
  id: string
  label: ReactNode
  count: number
  /** Shown after the count, such as an estimate total. */
  aggregate?: ReactNode
  collapsed: boolean
}

export interface DataTableRowEntry<Row> {
  kind: 'row'
  id: string
  row: Row
  /** Plain words for the row, for its checkbox and announcements. */
  label: string
}

/** A full-width row of the caller's own, such as an "Add" row at the end of a group. */
export interface DataTableExtraEntry {
  kind: 'extra'
  id: string
  render: (state: { focused: boolean }) => ReactNode
  /** Enter on the row. */
  onActivate?: () => void
}

export type DataTableEntry<Row> = DataTableGroupEntry | DataTableRowEntry<Row> | DataTableExtraEntry

export interface DataTableProps<Row> {
  /** Names the grid. */
  label: string
  /** The visible columns, in order. */
  columns: readonly DataTableColumn<Row>[]
  entries: readonly DataTableEntry<Row>[]
  /** Widths in px by column id; a column without one uses its own `width`. */
  widths?: Readonly<Record<string, number>>
  onColumnResize?: (columnId: string, width: number) => void
  /** Moves a column to a new position among `columns`. */
  onColumnMove?: (columnId: string, toIndex: number) => void
  sort?: readonly SortKey[]
  onSortChange?: (sort: SortKey[]) => void
  /** Adds the checkbox column. */
  selectable?: boolean
  selectedIds?: ReadonlySet<string>
  onSelectionChange?: (ids: string[]) => void
  onToggleGroup?: (groupId: string) => void
  /** Enter (when a cell does not take it), Ctrl+Enter or a double click on a row. */
  onRowActivate?: (row: Row, rowId: string) => void
  /**
   * A key on a row's cell, before the table's own keys. Return true when it
   * was handled.
   */
  onCellKeyDown?: (event: KeyboardEvent<HTMLElement>, row: Row, columnId: string) => boolean
  /** The row shown as current, such as the one open in a drawer. */
  activeRowId?: string | null
  /** Moves keyboard focus to this row once (cleared by `onFocusRowDone`). */
  focusRowId?: string | null
  onFocusRowDone?: () => void
  /**
   * Rows that can be dragged to a new place, and what a drop does: the
   * dragged row's id, the row it was dropped on, and which half of it. Leave
   * out for a table whose order is not the person's to set.
   */
  rowDrag?: {
    canDrag: (rowId: string) => boolean
    onDrop: (rowId: string, targetRowId: string, side: 'before' | 'after') => void
  }
  className?: string
}

const DEFAULT_WIDTH = 160
const DEFAULT_MIN_WIDTH = 48
const SELECT_WIDTH = 40
const RESIZE_STEP = 16
const FALLBACK_ROW_HEIGHT = 36

/** Where keyboard focus is: an entry (-1 is the header row) and a column. */
interface FocusPosition {
  entry: number
  col: number
}

/** The table's row height, from the density token. */
function rowHeightOf(element: HTMLElement | null): number {
  if (!element) return FALLBACK_ROW_HEIGHT
  const value = parseFloat(getComputedStyle(element).getPropertyValue('--row-height'))
  return Number.isFinite(value) && value > 0 ? value : FALLBACK_ROW_HEIGHT
}

/**
 * A generic, virtualised data grid (ARIA grid pattern). It knows rows and
 * columns, never what they hold: arrow keys, Home, End, Page Up and Page Down
 * move between cells and group headers; headers sort (Shift adds a key);
 * columns resize and reorder by mouse or with Alt and the arrow keys; a
 * checkbox column selects rows (Shift+click for a range, Ctrl+A for all).
 * Only the rows in view are in the DOM.
 */
export function DataTable<Row>({
  label,
  columns,
  entries,
  widths = {},
  onColumnResize,
  onColumnMove,
  sort = [],
  onSortChange,
  selectable = false,
  selectedIds,
  onSelectionChange,
  onToggleGroup,
  onRowActivate,
  onCellKeyDown,
  activeRowId = null,
  focusRowId = null,
  onFocusRowDone,
  rowDrag,
  className
}: DataTableProps<Row>) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [rowHeight, setRowHeight] = useState(FALLBACK_ROW_HEIGHT)
  const [focus, setFocus] = useState<FocusPosition>({ entry: entries.length > 0 ? 0 : -1, col: 0 })
  const pendingFocus = useRef(false)
  const anchorIndex = useRef<number | null>(null)
  const resizing = useRef(false)
  const [dragWidth, setDragWidth] = useState<{ id: string; width: number } | null>(null)
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [draggedRow, setDraggedRow] = useState<string | null>(null)
  /** Where a dragged row would land: above or below this row. */
  const [rowDropAt, setRowDropAt] = useState<{ id: string; side: 'before' | 'after' } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const selected = selectedIds ?? new Set<string>()

  useLayoutEffect(() => setRowHeight(rowHeightOf(scrollRef.current)), [])

  const offset = selectable ? 1 : 0
  const colCount = columns.length + offset
  const widthOf = (column: DataTableColumn<Row>) =>
    dragWidth?.id === column.id
      ? dragWidth.width
      : (widths[column.id] ?? column.width ?? DEFAULT_WIDTH)
  const totalWidth =
    (selectable ? SELECT_WIDTH : 0) + columns.reduce((sum, column) => sum + widthOf(column), 0)

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    scrollMargin: rowHeight,
    scrollPaddingStart: rowHeight
  })
  useEffect(() => virtualizer.measure(), [rowHeight, virtualizer])

  const rowIds = useMemo(
    () => entries.flatMap((entry) => (entry.kind === 'row' ? [entry.id] : [])),
    [entries]
  )

  // Keep focus on the table when rows come and go.
  const lastEntry = entries.length - 1
  const focusEntry = Math.min(focus.entry, lastEntry)
  const focusCol = Math.min(focus.col, colCount - 1)

  const moveFocus = useCallback(
    (next: FocusPosition) => {
      pendingFocus.current = true
      setFocus(next)
      if (next.entry >= 0) virtualizer.scrollToIndex(next.entry, { align: 'auto' })
    },
    [virtualizer]
  )

  // An outside request to focus a row (the caller added or opened it).
  useEffect(() => {
    if (!focusRowId) return
    const index = entries.findIndex((entry) => entry.id === focusRowId)
    if (index === -1) return
    moveFocus({ entry: index, col: focus.col })
    onFocusRowDone?.()
  }, [focusRowId, entries])

  const virtualItems = virtualizer.getVirtualItems()

  // Focus follows the keyboard once the target cell is rendered.
  useEffect(() => {
    if (!pendingFocus.current) return
    const container = scrollRef.current
    const cell = container?.querySelector<HTMLElement>(
      `[data-entry="${focusEntry}"][data-col="${entries[focusEntry]?.kind === 'row' || focusEntry === -1 ? focusCol : 0}"]`
    )
    if (cell) {
      pendingFocus.current = false
      cell.focus()
    }
  })

  const announce = (text: string) => setAnnouncement(text)

  const setSelection = (ids: string[]) => onSelectionChange?.([...new Set(ids)])

  const toggleRow = (index: number, range: boolean) => {
    const entry = entries[index]
    if (entry?.kind !== 'row') return
    if (range && anchorIndex.current !== null) {
      const [from, to] = [
        Math.min(anchorIndex.current, index),
        Math.max(anchorIndex.current, index)
      ]
      const ids = entries
        .slice(from, to + 1)
        .flatMap((candidate) => (candidate.kind === 'row' ? [candidate.id] : []))
      setSelection([...selected, ...ids])
    } else {
      setSelection(
        selected.has(entry.id)
          ? [...selected].filter((id) => id !== entry.id)
          : [...selected, entry.id]
      )
      anchorIndex.current = index
    }
  }

  const sortBy = (column: DataTableColumn<Row>, additive: boolean) => {
    if (!column.compare || !onSortChange) return
    const next = nextSort(sort, column.id, additive)
    onSortChange(next)
    const key = next.find((candidate) => candidate.columnId === column.id)
    announce(
      key
        ? key.direction === 'asc'
          ? t('common:dataTable.sortedAscending', { header: column.header })
          : t('common:dataTable.sortedDescending', { header: column.header })
        : t('common:dataTable.noLongerSorted', { header: column.header })
    )
  }

  const moveColumn = (index: number, step: -1 | 1, entryIndex: number) => {
    const column = columns[index]
    const to = index + step
    if (!column || !onColumnMove || to < 0 || to >= columns.length) return
    onColumnMove(column.id, to)
    announce(
      t('common:dataTable.movedColumn', {
        header: column.header,
        to: to + 1,
        columnCount: columns.length
      })
    )
    moveFocus({ entry: entryIndex, col: to + offset })
  }

  const resizeColumn = (column: DataTableColumn<Row>, step: number) => {
    if (!onColumnResize) return
    const width = Math.max(column.minWidth ?? DEFAULT_MIN_WIDTH, widthOf(column) + step)
    onColumnResize(column.id, width)
    announce(t('common:dataTable.pixelsWide', { header: column.header, width }))
  }

  const pageSize = Math.max(
    1,
    Math.floor((scrollRef.current?.clientHeight ?? rowHeight * 10) / rowHeight) - 1
  )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-entry]')
    // Keys inside a cell's own control (an editor, a picker) are its own.
    if (!cell || cell !== event.target) return
    const entryIndex = Number(cell.dataset.entry)
    const col = Number(cell.dataset.col)
    const entry = entryIndex >= 0 ? entries[entryIndex] : undefined
    const dataIndex = col - offset
    const column = dataIndex >= 0 ? columns[dataIndex] : undefined
    const ctrl = event.ctrlKey || event.metaKey
    const key = event.key

    if (entry?.kind === 'row' && column && onCellKeyDown?.(event, entry.row, column.id)) {
      event.preventDefault()
      return
    }

    const handled = (() => {
      // Columns: Alt+Left/Right moves the focused column, with Shift resizes it.
      if (event.altKey && (key === 'ArrowLeft' || key === 'ArrowRight') && column) {
        if (event.shiftKey) resizeColumn(column, key === 'ArrowLeft' ? -RESIZE_STEP : RESIZE_STEP)
        else moveColumn(dataIndex, key === 'ArrowLeft' ? -1 : 1, entryIndex)
        return true
      }
      if (ctrl && key.toLowerCase() === 'a' && selectable) {
        setSelection(rowIds)
        announce(t('common:dataTable.selected', { rowIdCount: rowIds.length }))
        return true
      }
      if (entry?.kind === 'group') {
        if (
          (key === 'ArrowLeft' && !entry.collapsed) ||
          (key === 'ArrowRight' && entry.collapsed)
        ) {
          onToggleGroup?.(entry.id)
          return true
        }
        if (key === 'Enter' || key === ' ') {
          onToggleGroup?.(entry.id)
          return true
        }
      }
      if (entry?.kind === 'extra' && key === 'Enter') {
        entry.onActivate?.()
        return true
      }
      if (entryIndex === -1 && column && (key === 'Enter' || key === ' ')) {
        sortBy(column, event.shiftKey)
        return true
      }
      if (entry?.kind === 'row') {
        if (key === 'Enter') {
          onRowActivate?.(entry.row, entry.id)
          return true
        }
        if ((key === ' ' || key.toLowerCase() === 'x') && selectable && !ctrl) {
          toggleRow(entryIndex, event.shiftKey)
          return true
        }
      }
      if (key === 'Escape' && selected.size > 0) {
        setSelection([])
        return true
      }

      const plain = !ctrl && !event.altKey
      const down = key === 'ArrowDown' || (plain && key.toLowerCase() === 'j')
      const up = key === 'ArrowUp' || (plain && key.toLowerCase() === 'k')
      let next: FocusPosition | null = null
      if (down) next = { entry: Math.min(lastEntry, entryIndex + 1), col }
      else if (up) next = { entry: Math.max(-1, entryIndex - 1), col }
      else if (key === 'ArrowRight' && (entry?.kind === 'row' || entryIndex === -1))
        next = { entry: entryIndex, col: Math.min(colCount - 1, col + 1) }
      else if (key === 'ArrowLeft' && (entry?.kind === 'row' || entryIndex === -1))
        next = { entry: entryIndex, col: Math.max(0, col - 1) }
      else if (key === 'Home') next = ctrl ? { entry: 0, col } : { entry: entryIndex, col: 0 }
      else if (key === 'End')
        next = ctrl ? { entry: lastEntry, col } : { entry: entryIndex, col: colCount - 1 }
      else if (key === 'PageDown') next = { entry: Math.min(lastEntry, entryIndex + pageSize), col }
      else if (key === 'PageUp') next = { entry: Math.max(0, entryIndex - pageSize), col }
      if (!next) return false
      // Group and extra rows are one cell; the column is remembered for the next row.
      moveFocus({
        entry: next.entry,
        col: next.col !== col || entry?.kind === 'row' || entryIndex === -1 ? next.col : focus.col
      })
      return true
    })()
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  // Clicking or tabbing into a cell makes it the focused one.
  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-entry]')
    if (!cell) return
    const entry = Number(cell.dataset.entry)
    const col = Number(cell.dataset.col)
    const kind = entry >= 0 ? entries[entry]?.kind : 'header'
    setFocus((current) =>
      current.entry === entry && (kind !== 'row' && kind !== 'header' ? true : current.col === col)
        ? current
        : { entry, col: kind === 'row' || kind === 'header' ? col : current.col }
    )
  }

  const tabStop = (entry: number, col: number) =>
    entry === focusEntry &&
    (entry === -1 || entries[entry]?.kind === 'row' ? col === focusCol : true)
      ? 0
      : -1

  const startResize = (event: PointerEvent<HTMLSpanElement>, column: DataTableColumn<Row>) => {
    event.preventDefault()
    event.stopPropagation()
    resizing.current = true
    const startX = event.clientX
    const start = widthOf(column)
    const min = column.minWidth ?? DEFAULT_MIN_WIDTH
    let latest = start
    const onMove = (move: globalThis.PointerEvent) => {
      latest = Math.max(min, Math.round(start + move.clientX - startX))
      setDragWidth({ id: column.id, width: latest })
    }
    const onUp = () => {
      resizing.current = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragWidth(null)
      if (latest !== start) onColumnResize?.(column.id, latest)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onHeaderDrop = (event: DragEvent<HTMLElement>, toIndex: number) => {
    event.preventDefault()
    const id = draggedColumn
    setDraggedColumn(null)
    if (!id || !onColumnMove) return
    const from = columns.findIndex((column) => column.id === id)
    if (from === -1 || from === toIndex) return
    onColumnMove(id, toIndex)
    announce(
      t('common:dataTable.movedColumn2', {
        header: columns[from].header,
        number: toIndex + 1,
        columnCount: columns.length
      })
    )
  }

  const allSelected = rowIds.length > 0 && rowIds.every((id) => selected.has(id))
  const someSelected = !allSelected && rowIds.some((id) => selected.has(id))

  const header = (
    <div className="ui-data-table__head" role="rowgroup">
      <div
        className="ui-data-table__row ui-data-table__row--head"
        role="row"
        aria-rowindex={1}
        style={{ width: totalWidth, height: rowHeight }}
      >
        {selectable && (
          <div
            role="columnheader"
            className="ui-data-table__cell ui-data-table__cell--select"
            style={{ width: SELECT_WIDTH }}
            data-entry={-1}
            data-col={0}
            tabIndex={tabStop(-1, 0)}
            aria-colindex={1}
            onKeyDown={(event) => {
              if (
                (event.key === ' ' || event.key === 'Enter') &&
                event.target === event.currentTarget
              ) {
                event.preventDefault()
                event.stopPropagation()
                setSelection(allSelected ? [] : rowIds)
              }
            }}
          >
            <input
              type="checkbox"
              tabIndex={-1}
              className="ui-data-table__checkbox"
              aria-label={
                allSelected
                  ? t('common:dataTable.deselectAllRows')
                  : t('common:dataTable.selectAllRows')
              }
              checked={allSelected}
              ref={(node) => {
                if (node) node.indeterminate = someSelected
              }}
              onChange={() => setSelection(allSelected ? [] : rowIds)}
            />
          </div>
        )}
        {columns.map((column, index) => {
          const keyIndex = sort.findIndex((key) => key.columnId === column.id)
          const key = keyIndex >= 0 ? sort[keyIndex] : undefined
          const ariaSort = column.compare
            ? keyIndex === 0
              ? key!.direction === 'asc'
                ? 'ascending'
                : 'descending'
              : keyIndex > 0
                ? undefined
                : 'none'
            : undefined
          return (
            <div
              key={column.id}
              role="columnheader"
              aria-sort={ariaSort}
              aria-colindex={index + offset + 1}
              className={cx(
                'ui-data-table__cell',
                'ui-data-table__header',
                column.compare && 'is-sortable',
                column.align === 'end' && 'is-end',
                draggedColumn === column.id && 'is-dragging'
              )}
              style={{ width: widthOf(column) }}
              data-entry={-1}
              data-col={index + offset}
              tabIndex={tabStop(-1, index + offset)}
              draggable={!!onColumnMove}
              onDragStart={(event) => {
                if (resizing.current) {
                  event.preventDefault()
                  return
                }
                setDraggedColumn(column.id)
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', column.id)
              }}
              onDragEnd={() => setDraggedColumn(null)}
              onDragOver={(event) => {
                if (draggedColumn) event.preventDefault()
              }}
              onDrop={(event) => onHeaderDrop(event, index)}
              onClick={(event: MouseEvent) => sortBy(column, event.shiftKey)}
              title={
                column.compare
                  ? t('common:dataTable.sortShiftClickAdds', { header: column.header })
                  : undefined
              }
            >
              <span className="ui-data-table__header-text">{column.header}</span>
              {key && (
                <span className="ui-data-table__sort" aria-hidden={keyIndex === 0}>
                  <Icon icon={key.direction === 'asc' ? ArrowUp : ArrowDown} />
                  {sort.length > 1 && (
                    <span className="ui-data-table__sort-rank">{keyIndex + 1}</span>
                  )}
                  {keyIndex > 0 && (
                    <VisuallyHidden>
                      {', '}
                      {key.direction === 'asc'
                        ? t('common:dataTable.sortRankAscending', { rank: keyIndex + 1 })
                        : t('common:dataTable.sortRankDescending', { rank: keyIndex + 1 })}
                    </VisuallyHidden>
                  )}
                </span>
              )}
              {column.filter && (
                <span
                  className={cx('ui-data-table__filter', column.filter.active && 'is-active')}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <Menu
                    label={column.filter.label}
                    items={column.filter.items}
                    renderTrigger={(props) => (
                      <IconButton
                        size="sm"
                        icon={column.filter!.active ? ListFilter : ChevronDown}
                        label={column.filter!.label}
                        tabIndex={-1}
                        {...props}
                      />
                    )}
                  />
                </span>
              )}
              {onColumnResize && (
                <span
                  className="ui-data-table__resize"
                  aria-hidden="true"
                  onPointerDown={(event) => startResize(event, column)}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  const renderEntry = (entry: DataTableEntry<Row>, index: number, start: number) => {
    const ariaRowIndex = index + 2
    const rowStyle: CSSProperties = {
      width: totalWidth,
      height: rowHeight,
      transform: `translateY(${start}px)`
    }
    if (entry.kind === 'group') {
      return (
        <div
          role="row"
          aria-rowindex={ariaRowIndex}
          aria-expanded={!entry.collapsed}
          className="ui-data-table__row ui-data-table__row--group"
          style={rowStyle}
        >
          <div
            role="gridcell"
            aria-colspan={colCount}
            className="ui-data-table__cell ui-data-table__group"
            data-entry={index}
            data-col={0}
            tabIndex={tabStop(index, 0)}
            onClick={() => onToggleGroup?.(entry.id)}
          >
            <Icon icon={ChevronRight} className={chevronClass(!entry.collapsed)} />
            <span className="ui-data-table__group-label">{entry.label}</span>
            <span className="ui-data-table__group-count">{entry.count}</span>
            {entry.aggregate && (
              <span className="ui-data-table__group-aggregate">{entry.aggregate}</span>
            )}
          </div>
        </div>
      )
    }
    if (entry.kind === 'extra') {
      return (
        <div
          role="row"
          aria-rowindex={ariaRowIndex}
          className="ui-data-table__row ui-data-table__row--extra"
          style={rowStyle}
        >
          <div
            role="gridcell"
            aria-colspan={colCount}
            className="ui-data-table__cell ui-data-table__extra"
            data-entry={index}
            data-col={0}
            tabIndex={tabStop(index, 0)}
          >
            {entry.render({ focused: index === focusEntry })}
          </div>
        </div>
      )
    }
    const isSelected = selected.has(entry.id)
    const dropSide = rowDropAt?.id === entry.id ? rowDropAt.side : null
    const dragProps = rowDrag
      ? {
          draggable: rowDrag.canDrag(entry.id),
          onDragStart: (event: DragEvent<HTMLElement>) => {
            if ((event.target as HTMLElement).closest('input, select, textarea')) return
            setDraggedRow(entry.id)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', entry.id)
          },
          onDragEnd: () => {
            setDraggedRow(null)
            setRowDropAt(null)
          },
          onDragOver: (event: DragEvent<HTMLElement>) => {
            if (!draggedRow) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            const box = event.currentTarget.getBoundingClientRect()
            const side = event.clientY < box.top + box.height / 2 ? 'before' : 'after'
            if (rowDropAt?.id !== entry.id || rowDropAt.side !== side)
              setRowDropAt({ id: entry.id, side })
          },
          onDrop: (event: DragEvent<HTMLElement>) => {
            event.preventDefault()
            const id = draggedRow
            const side = rowDropAt?.id === entry.id ? rowDropAt.side : 'before'
            setDraggedRow(null)
            setRowDropAt(null)
            if (id && id !== entry.id) rowDrag.onDrop(id, entry.id, side)
          }
        }
      : {}
    return (
      <div
        role="row"
        aria-rowindex={ariaRowIndex}
        aria-selected={selectable ? isSelected : undefined}
        className={cx(
          'ui-data-table__row',
          isSelected && 'is-selected',
          activeRowId === entry.id && 'is-active',
          draggedRow === entry.id && 'is-dragging',
          dropSide && draggedRow !== entry.id && `is-drop-${dropSide}`
        )}
        style={rowStyle}
        {...dragProps}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('input, button, select, textarea')) return
          onRowActivate?.(entry.row, entry.id)
        }}
      >
        {selectable && (
          <div
            role="gridcell"
            className="ui-data-table__cell ui-data-table__cell--select"
            style={{ width: SELECT_WIDTH }}
            data-entry={index}
            data-col={0}
            aria-colindex={1}
            tabIndex={tabStop(index, 0)}
          >
            <input
              type="checkbox"
              tabIndex={-1}
              className="ui-data-table__checkbox"
              aria-label={t('common:dataTable.select', { entryLabel: entry.label })}
              checked={isSelected}
              onChange={() => {}}
              onClick={(event) => {
                event.stopPropagation()
                toggleRow(index, event.shiftKey)
              }}
            />
          </div>
        )}
        {columns.map((column, colIndex) => {
          const col = colIndex + offset
          return (
            <div
              key={column.id}
              role="gridcell"
              aria-colindex={col + 1}
              className={cx('ui-data-table__cell', column.align === 'end' && 'is-end')}
              style={{ width: widthOf(column) }}
              data-entry={index}
              data-col={col}
              data-column={column.id}
              tabIndex={tabStop(index, col)}
              onClick={
                column.onCellClick
                  ? (event: MouseEvent) => {
                      if ((event.target as HTMLElement).closest('input, button, select, textarea'))
                        return
                      column.onCellClick!(entry.row, event)
                    }
                  : undefined
              }
            >
              {column.cell(entry.row, { focused: index === focusEntry && col === focusCol })}
            </div>
          )
        })}
      </div>
    )
  }

  // With virtualisation the focused cell may be out of the DOM; the grid
  // itself then takes Tab and hands focus back to that cell.
  const focusedRendered =
    focusEntry === -1 || virtualItems.some((item) => item.index === focusEntry)

  return (
    <div className={cx('ui-data-table', className)}>
      <div
        ref={scrollRef}
        role="grid"
        aria-label={label}
        aria-rowcount={entries.length + 1}
        aria-colcount={colCount}
        aria-multiselectable={selectable || undefined}
        className="ui-data-table__scroll"
        tabIndex={focusedRendered ? -1 : 0}
        onKeyDown={onKeyDown}
        onFocusCapture={onFocusCapture}
        onFocus={(event) => {
          if (event.target === event.currentTarget && !focusedRendered)
            moveFocus({ entry: focusEntry, col: focusCol })
        }}
      >
        {header}
        <div
          role="rowgroup"
          className="ui-data-table__body"
          style={{ height: virtualizer.getTotalSize(), width: totalWidth }}
        >
          {virtualItems.map((item) => (
            <Fragment key={entries[item.index].id}>
              {renderEntry(entries[item.index], item.index, item.start - rowHeight)}
            </Fragment>
          ))}
        </div>
      </div>
      <VisuallyHidden aria-live="polite">{announcement}</VisuallyHidden>
    </div>
  )
}
