import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import type { PlanningWorkItem } from '@shared/ostler-api'

/** Columns with more cards than this render only the cards near the screen (P9.1). */
export const VIRTUALIZE_ABOVE = 100

/** A first guess at a card's height with its gap; each card is measured once it renders. */
const CARD_ESTIMATE_PX = 104
const OVERSCAN = 6

interface ColumnItemsProps {
  items: PlanningWorkItem[]
  /** Where the drop line goes while a card is dragged over (index into `items`), or null. */
  insertAt: number | null
  /** Cards that must stay rendered even off screen: the dragged one and the keyboard cursor. */
  draggedId: string | null
  focusedId: string | null
  renderCard: (item: PlanningWorkItem) => ReactNode
}

const dropLine = <div className="board-column__drop-line" aria-hidden="true" />

/**
 * A Board column's cards. Up to `VIRTUALIZE_ABOVE` they all render; above
 * that, only those near the visible part of the page do, measured as they
 * render, inside a spacer as tall as the whole column. The dragged card and
 * the keyboard cursor's card always stay rendered, so a drag survives
 * scrolling and j/k can move to a card that was off screen (the column
 * scrolls it into view). Dropping works on the column as before.
 */
export function BoardColumnItems(props: ColumnItemsProps) {
  if (props.items.length <= VIRTUALIZE_ABOVE) {
    const { items, insertAt, renderCard } = props
    return (
      <>
        {items.map((item, index) => (
          <Fragment key={item.id}>
            {insertAt === index && dropLine}
            {renderCard(item)}
          </Fragment>
        ))}
        {insertAt !== null && insertAt >= items.length && dropLine}
      </>
    )
  }
  return <VirtualColumnItems {...props} />
}

/**
 * The nearest ancestor that scrolls vertically: the page's content area.
 * An ancestor that could scroll but is as tall as its content is passed over:
 * the Board's columns scroll sideways (`overflow-x: auto`), which makes their
 * `overflow-y` auto too, yet they grow with their cards and never scroll down.
 * Taking them for the scroller made every card of a long column count as on
 * screen, so all of them rendered. When nothing scrolls yet (a short page),
 * the nearest that could is the answer.
 */
export function scrollParent(element: HTMLElement | null): HTMLElement | null {
  let nearest: HTMLElement | null = null
  let current = element?.parentElement ?? null
  while (current) {
    const { overflowY } = getComputedStyle(current)
    if (overflowY === 'auto' || overflowY === 'scroll') {
      if (current.scrollHeight > current.clientHeight) return current
      nearest ??= current
    }
    current = current.parentElement
  }
  return nearest
}

/** The indexes to render: the visible range plus the pinned ones, in order. */
export function withPinned(range: Range, pinned: number[]): number[] {
  const indexes = new Set(defaultRangeExtractor(range))
  for (const index of pinned) if (index >= 0 && index < range.count) indexes.add(index)
  return [...indexes].sort((a, b) => a - b)
}

function VirtualColumnItems({
  items,
  insertAt,
  draggedId,
  focusedId,
  renderCard
}: ColumnItemsProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [scroller, setScroller] = useState<HTMLElement | null>(null)
  const [margin, setMargin] = useState(0)

  // Where the list starts inside the scrolling page; it moves when the
  // toolbar wraps or a banner appears, so it is checked after every render.
  useLayoutEffect(() => {
    const list = listRef.current
    const parent = scrollParent(list)
    if (parent !== scroller) setScroller(parent)
    if (!list || !parent) return
    const offset = Math.round(
      list.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop
    )
    if (offset !== margin) setMargin(offset)
  })

  const pinned = useMemo(() => {
    const indexes: number[] = []
    for (const id of [draggedId, focusedId]) {
      if (!id) continue
      const index = items.findIndex((item) => item.id === id)
      if (index >= 0) indexes.push(index)
    }
    return indexes
  }, [items, draggedId, focusedId])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller,
    estimateSize: () => CARD_ESTIMATE_PX,
    overscan: OVERSCAN,
    scrollMargin: margin,
    getItemKey: (index) => items[index].id,
    rangeExtractor: (range) => withPinned(range, pinned)
  })

  // The keyboard cursor moved to a card: bring it on screen.
  const focusedIndex = focusedId ? items.findIndex((item) => item.id === focusedId) : -1
  useEffect(() => {
    if (focusedIndex >= 0) virtualizer.scrollToIndex(focusedIndex, { align: 'auto' })
  }, [focusedIndex])

  const rows = virtualizer.getVirtualItems()
  return (
    <div
      ref={listRef}
      className="board-column__virtual"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {rows.map((row) => (
        <div
          key={row.key}
          ref={virtualizer.measureElement}
          data-index={row.index}
          className="board-column__virtual-row"
          style={{ transform: `translateY(${row.start - margin}px)` }}
        >
          {insertAt === row.index && dropLine}
          {renderCard(items[row.index])}
          {row.index === items.length - 1 &&
            insertAt !== null &&
            insertAt >= items.length &&
            dropLine}
        </div>
      ))}
    </div>
  )
}
