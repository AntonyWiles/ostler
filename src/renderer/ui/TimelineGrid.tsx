import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { compareIsoDates, isoDaysBetween, shiftIsoDate } from '@shared/dates'
import {
  dateToX,
  dayWidth,
  pixelsToDays,
  stepZoom,
  timelineTicks,
  weekendDays,
  xToDate,
  type TimelineZoom
} from './timeline-scale'
import { cx } from './cx'
import { ContextMenu, type ContextMenuProps } from './ContextMenu'
import type { MenuEntry } from './Menu'
import {
  lagLabel,
  linkEnds,
  linkRoute,
  type TimelineBarEnd,
  type TimelineLinkType
} from './timeline-links'
import './TimelineGrid.css'
import { t } from '@shared/i18n'

/** A bar on the timeline, from its first to its last day. */
export interface TimelineBarSpec {
  id: string
  start: string
  end: string
  /**
   * `bar` (default) from start to end; `start` a start marker with a fade;
   * `milestone` a diamond on `start`.
   */
  shape?: 'bar' | 'start' | 'milestone'
  /** Whether the bar can be dragged and its ends moved (`bar` shape only). */
  editable?: boolean
  /**
   * Drawn only, never focused or clicked, and hidden from assistive tech: a
   * mark whose words another bar's name carries (a baseline, N7.4).
   */
  decorative?: boolean
}

/**
 * A span of days marked on the scale (the Timeline across projects' weeks
 * where milestones meet, N5.4): a button under the dates, named by `label`.
 */
export interface TimelineAxisMark {
  id: string
  start: string
  end: string
  /** The accessible name and tooltip. */
  label: string
  /** The short text shown, when it fits. */
  text: string
}

/** A waits-on link between two bars, drawn from the ends its type joins (N7.2b). */
export interface TimelineArrowSpec {
  id: string
  /** The bar waited on. */
  from: string
  /** The bar that waits. */
  to: string
  /** Which ends it joins; finish to start (end to start) when not given. */
  type?: TimelineLinkType
  /** Days of lag, shown as a small label ("+2d") when not 0. */
  lagDays?: number
  tone?: 'default' | 'warning'
  /** Drawn heavier, for example a link between critical tasks. */
  strong?: boolean
  /** The tooltip, for example why it is a warning. */
  title?: string
}

/** Which part of a bar a drag moved. */
export type TimelineBarEdit = 'move' | 'start' | 'end'

/** Where a bar sits, for `renderBar` to draw into (pixels, in the bar's row). */
export interface TimelineBarGeometry {
  x: number
  width: number
  height: number
}

export interface TimelineGridHandle {
  /** Scrolls so `date` sits a third of the way across the time pane. */
  scrollToDate: (date: string) => void
}

export interface TimelineGridProps<Row, Bar extends TimelineBarSpec> {
  /** The accessible name of the whole grid. */
  label: string
  rows: readonly Row[]
  getRowId: (row: Row) => string
  /** The row's label in the left pane: HTML, so text stays crisp and selectable. */
  renderLabel: (row: Row) => ReactNode
  rowClassName?: (row: Row) => string | undefined
  barsFor: (row: Row) => readonly Bar[]
  /** The bar's look, as SVG, inside a box of `geometry`. */
  renderBar: (bar: Bar, geometry: TimelineBarGeometry) => ReactNode
  /** The bar's accessible name. */
  barLabel: (bar: Bar) => string
  arrows?: readonly TimelineArrowSpec[]
  /**
   * A click, Enter or Space on an arrow (N7.2b); arrows are focusable buttons
   * only when given. `element` is the arrow, to anchor a popover to.
   */
  onArrowActivate?: (arrow: TimelineArrowSpec, element: Element) => void
  /** The arrow drawn as selected. */
  selectedArrowId?: string | null
  /** Whether a bar shows link handles at its ends (with `onLinkDraw`). */
  canLink?: (bar: Bar) => boolean
  /**
   * A link drawn by dragging from one bar's end handle to another bar (N7.2b):
   * `from` is the bar dragged from, `element` the bar it was dropped on.
   */
  onLinkDraw?: (
    from: Bar,
    fromEnd: TimelineBarEnd,
    to: Bar,
    toEnd: TimelineBarEnd,
    element: Element
  ) => void
  /** A bar's menu, on right-click, Shift+F10 or the Menu key. */
  barMenu?: (bar: Bar) => readonly MenuEntry[]
  /** The days the time pane covers (`timelineRange`). */
  range: { start: string; end: string }
  today: string
  zoom: TimelineZoom
  /** Ctrl with the mouse wheel asks for the next zoom. */
  onZoomChange?: (zoom: TimelineZoom) => void
  /** A finished drag that moved a bar, or one of its ends, by whole days. */
  onBarEdit?: (bar: Bar, edit: TimelineBarEdit, days: number) => void
  /** A click, Enter or Space on a bar. */
  onBarActivate?: (bar: Bar) => void
  /** Other keys on a focused bar (the view's own shortcuts). */
  onBarKeyDown?: (event: KeyboardEvent<SVGGElement>, bar: Bar) => void
  /** Something dragged in from outside (`text/plain`) and dropped on a day. */
  onExternalDrop?: (date: string, data: string) => void
  /** What the left pane's header says. */
  labelHeader?: ReactNode
  rowHeight?: number
  labelWidth?: number
  /**
   * Everyone's days off (N3.2), shaded at Week zoom as weekends are, but
   * striped, and named in the day's title.
   */
  daysOff?: ReadonlyMap<string, string>
  /** Spans marked on the scale, in a strip under the dates; shown only when given. */
  axisMarks?: readonly TimelineAxisMark[]
  /** A mark was pressed; `element` is its button, to anchor a popover to. */
  onAxisMarkActivate?: (id: string, element: HTMLButtonElement) => void
  className?: string
  ref?: Ref<TimelineGridHandle>
}

const SCALE_HEIGHT = 48
/** The strip of axis marks under the scale. */
const MARKS_HEIGHT = 28
const HANDLE_WIDTH = 6
/** Pixels a pointer moves before a press becomes a drag. */
const DRAG_THRESHOLD = 4

/** The link handles' size: drawn and hit radius, clear of the bar's own resize edges. */
const LINK_HANDLE_RADIUS = 5
const LINK_HANDLE_HIT = 10
const LINK_HANDLE_OFFSET = 10

interface LinkDragState {
  barId: string
  end: TimelineBarEnd
  x1: number
  y1: number
  x: number
  y: number
}

interface DragState {
  barId: string
  edit: TimelineBarEdit
  startX: number
  days: number
  moved: boolean
}

/**
 * A Gantt-style timeline (P5.5), generic over rows and bars: a left pane of
 * row labels and a time pane under a sticky two-row scale, in one scroll
 * container so both panes scroll together vertically and only the rows in
 * view render. Bars and arrows are SVG; labels are HTML. Week, Month and
 * Quarter zoom, Ctrl with the wheel to change it; weekends are shaded at
 * Week zoom and today is a line. Bars are focusable buttons that can be
 * dragged, by their middle to move or by their ends to resize, and things
 * dragged in from outside land on the day under the pointer.
 */
export function TimelineGrid<Row, Bar extends TimelineBarSpec>({
  label,
  rows,
  getRowId,
  renderLabel,
  rowClassName,
  barsFor,
  renderBar,
  barLabel,
  arrows = [],
  onArrowActivate,
  selectedArrowId,
  canLink,
  onLinkDraw,
  barMenu,
  range,
  today,
  zoom,
  onZoomChange,
  onBarEdit,
  onBarActivate,
  onBarKeyDown,
  onExternalDrop,
  labelHeader,
  rowHeight = 36,
  labelWidth = 260,
  daysOff,
  axisMarks,
  onAxisMarkActivate,
  className,
  ref
}: TimelineGridProps<Row, Bar>) {
  const HEADER_HEIGHT = SCALE_HEIGHT + (axisMarks ? MARKS_HEIGHT : 0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [linkDrag, setLinkDrag] = useState<LinkDragState | null>(null)
  const linkDragRef = useRef<LinkDragState | null>(null)
  const totalDays = isoDaysBetween(range.start, range.end) + 1
  const width = totalDays * dayWidth(zoom)
  const unit = dayWidth(zoom)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 6,
    scrollMargin: HEADER_HEIGHT
  })
  useEffect(() => virtualizer.measure(), [rowHeight, virtualizer])

  const ticks = useMemo(() => timelineTicks(range, zoom), [range, zoom])
  const weekends = useMemo(() => (zoom === 'week' ? weekendDays(range) : []), [range, zoom])
  const offDays = useMemo(
    () =>
      zoom === 'week' && daysOff
        ? [...daysOff.keys()].filter((date) => date >= range.start && date <= range.end)
        : [],
    [daysOff, range, zoom]
  )

  // Every bar's row and place, for arrows between rows that may not be rendered.
  const places = useMemo(() => {
    const map = new Map<string, { row: number; bar: Bar }>()
    rows.forEach((row, index) => {
      for (const bar of barsFor(row)) map.set(bar.id, { row: index, bar })
    })
    return map
  }, [rows, barsFor])

  const geometry = (bar: Bar): TimelineBarGeometry => {
    let start = bar.start
    let end = bar.end
    if (drag && drag.barId === bar.id && drag.days !== 0) {
      if (drag.edit !== 'end') start = shiftIsoDate(start, drag.days)
      if (drag.edit !== 'start') end = shiftIsoDate(end, drag.days)
      if (compareIsoDates(start, end) > 0) {
        if (drag.edit === 'start') start = end
        else end = start
      }
    }
    const x = dateToX(start, range.start, zoom)
    const span = isoDaysBetween(start, end) + 1
    return { x, width: Math.max(span * unit, 2), height: rowHeight }
  }

  // Keep the date at the centre (or under the pointer) in place when the zoom changes.
  const anchor = useRef<{ date: string; offset: number } | null>(null)
  const previous = useRef({ zoom, start: range.start })
  useLayoutEffect(() => {
    const element = scrollRef.current
    const before = previous.current
    previous.current = { zoom, start: range.start }
    if (!element || (before.zoom === zoom && before.start === range.start)) return
    const pane = Math.max(element.clientWidth - labelWidth, 0)
    const kept = anchor.current ?? {
      date: xToDate(element.scrollLeft + pane / 2, before.start, before.zoom),
      offset: pane / 2
    }
    anchor.current = null
    element.scrollLeft = Math.max(dateToX(kept.date, range.start, zoom) - kept.offset, 0)
  }, [zoom, range.start, labelWidth])

  const scrollToDate = (date: string) => {
    const element = scrollRef.current
    if (!element) return
    const pane = Math.max(element.clientWidth - labelWidth, 0)
    const left = Math.max(dateToX(date, range.start, zoom) - pane / 3, 0)
    if (typeof element.scrollTo === 'function') element.scrollTo({ left })
    else element.scrollLeft = left
  }
  useImperativeHandle(ref, () => ({ scrollToDate }))

  // Start at today.
  const scrolledOnce = useRef(false)
  useLayoutEffect(() => {
    if (scrolledOnce.current) return
    scrolledOnce.current = true
    scrollToDate(today)
  })

  // Ctrl with the wheel zooms. A native listener, so the page zoom can be prevented.
  const zoomRef = useRef({ zoom, onZoomChange, start: range.start, labelWidth })
  zoomRef.current = { zoom, onZoomChange, start: range.start, labelWidth }
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || event.deltaY === 0) return
      const current = zoomRef.current
      if (!current.onZoomChange) return
      event.preventDefault()
      const next = stepZoom(current.zoom, event.deltaY < 0 ? -1 : 1)
      if (next === current.zoom) return
      const offset = event.clientX - element.getBoundingClientRect().left - current.labelWidth
      if (offset >= 0)
        anchor.current = {
          date: xToDate(element.scrollLeft + offset, current.start, current.zoom),
          offset
        }
      current.onZoomChange(next)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const startDrag = (event: ReactPointerEvent, bar: Bar, edit: TimelineBarEdit) => {
    if (event.button !== 0) return
    event.stopPropagation()
    const state: DragState = { barId: bar.id, edit, startX: event.clientX, days: 0, moved: false }
    dragRef.current = state
    setDrag(state)
    const onMove = (move: PointerEvent) => {
      const current = dragRef.current
      if (!current) return
      const dx = move.clientX - current.startX
      const moved = current.moved || Math.abs(dx) >= DRAG_THRESHOLD
      const days = bar.editable && moved ? pixelsToDays(dx, zoom) : 0
      if (days !== current.days || moved !== current.moved) {
        dragRef.current = { ...current, days, moved }
        setDrag(dragRef.current)
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      const done = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!done) return
      if (!done.moved) onBarActivate?.(bar)
      else if (done.days !== 0) onBarEdit?.(bar, done.edit, done.days)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const dateAtClientX = (clientX: number): string | null => {
    const element = scrollRef.current
    if (!element) return null
    const x = clientX - element.getBoundingClientRect().left + element.scrollLeft - labelWidth
    if (!Number.isFinite(x) || x < 0 || x >= width) return null
    return xToDate(x, range.start, zoom)
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onExternalDrop || !Array.from(event.dataTransfer.types).includes('text/plain')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!onExternalDrop) return
    const data = event.dataTransfer.getData('text/plain')
    const date = dateAtClientX(event.clientX)
    if (!data || !date) return
    event.preventDefault()
    onExternalDrop(date, data)
  }

  const bodyHeight = rows.length * rowHeight
  const todayX =
    compareIsoDates(today, range.start) >= 0 && compareIsoDates(today, range.end) <= 0
      ? dateToX(today, range.start, zoom) + unit / 2
      : null

  // Arrow geometry is worked out once per layout (or drag step), not per frame.
  const arrowPaths = useMemo(
    () =>
      arrows.flatMap((arrow) => {
        const from = places.get(arrow.from)
        const to = places.get(arrow.to)
        // A decorative mark (a baseline) is never an arrow's end.
        if (!from || !to || from.bar.decorative || to.bar.decorative) return []
        const box = (place: { row: number; bar: Bar }) => {
          const g = geometry(place.bar)
          return {
            left: g.x,
            right: place.bar.shape === 'start' ? g.x + unit : g.x + g.width,
            y: place.row * rowHeight + rowHeight / 2
          }
        }
        const route = linkRoute(box(from), box(to), arrow.type ?? 'finish-to-start', rowHeight)
        return [{ ...arrow, ...route, label: lagLabel(arrow.lagDays) }]
      }),
    // `geometry` reads only these.
    [arrows, places, range.start, zoom, unit, rowHeight, drag]
  )

  const bodyPoint = (clientX: number, clientY: number) => {
    const rect = bodyRef.current?.getBoundingClientRect()
    return { x: clientX - (rect?.left ?? 0) - labelWidth, y: clientY - (rect?.top ?? 0) }
  }

  const startLinkDrag = (event: ReactPointerEvent, bar: Bar, end: TimelineBarEnd) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.preventDefault()
    const place = places.get(bar.id)
    if (!place) return
    const box = geometry(bar)
    const x1 =
      end === 'start'
        ? box.x - LINK_HANDLE_OFFSET
        : box.x + (bar.shape === 'start' ? unit : box.width) + LINK_HANDLE_OFFSET
    const y1 = place.row * rowHeight + rowHeight / 2
    const point = bodyPoint(event.clientX, event.clientY)
    const state = { barId: bar.id, end, x1, y1, x: point.x, y: point.y }
    linkDragRef.current = state
    setLinkDrag(state)
    const onMove = (move: PointerEvent) => {
      const current = linkDragRef.current
      if (!current) return
      linkDragRef.current = { ...current, ...bodyPoint(move.clientX, move.clientY) }
      setLinkDrag(linkDragRef.current)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      linkDragRef.current = null
      setLinkDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // A link drag let go over a bar: on a handle, that end; elsewhere, the nearer end.
  const finishLinkDrag = (event: ReactPointerEvent<SVGGElement>, bar: Bar) => {
    const current = linkDragRef.current
    if (!current || !onLinkDraw) return
    linkDragRef.current = null
    setLinkDrag(null)
    if (current.barId === bar.id) return
    const from = places.get(current.barId)
    if (!from) return
    const marked = (event.target as Element).closest?.('[data-link-end]')
    let end = marked?.getAttribute('data-link-end') as TimelineBarEnd | null | undefined
    if (end !== 'start' && end !== 'end') {
      const box = geometry(bar)
      end = bodyPoint(event.clientX, event.clientY).x < box.x + box.width / 2 ? 'start' : 'end'
    }
    onLinkDraw(from.bar, current.end, bar, end, event.currentTarget)
  }

  const renderBarGroup = (bar: Bar) => {
    const box = geometry(bar)
    const shape = bar.shape ?? 'bar'
    const resizable = bar.editable && shape === 'bar'
    // A decorative mark (a baseline, N7.4) is drawn only: no focus, no menu,
    // no drag, no link handles, never a link's end.
    if (bar.decorative)
      return (
        <g
          key={bar.id}
          className="ui-timeline__mark"
          aria-hidden="true"
          transform={`translate(${box.x} 0)`}
        >
          {renderBar(bar, box)}
        </g>
      )
    const linkable = !!onLinkDraw && shape !== 'milestone' && (canLink?.(bar) ?? false)
    const right = shape === 'start' ? unit : box.width
    const group = (
      <g
        key={bar.id}
        className={cx(
          'ui-timeline__bar',
          `ui-timeline__bar--${shape}`,
          bar.editable && 'is-editable',
          drag?.barId === bar.id && drag.moved && 'is-dragging'
        )}
        data-bar-id={bar.id}
        role="button"
        tabIndex={0}
        aria-label={barLabel(bar)}
        transform={`translate(${box.x} 0)`}
        onPointerDown={(event) => startDrag(event, bar, 'move')}
        onPointerUp={(event) => finishLinkDrag(event, bar)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onBarActivate?.(bar)
            return
          }
          onBarKeyDown?.(event, bar)
        }}
      >
        {renderBar(bar, box)}
        <rect
          className="ui-timeline__focus"
          x={-3}
          y={2}
          width={box.width + 6}
          height={rowHeight - 4}
          rx={6}
          fill="none"
        />
        {resizable && (
          <>
            <rect
              className="ui-timeline__handle ui-timeline__handle--start"
              x={0}
              y={4}
              width={HANDLE_WIDTH}
              height={rowHeight - 8}
              onPointerDown={(event) => startDrag(event, bar, 'start')}
            />
            <rect
              className="ui-timeline__handle ui-timeline__handle--end"
              x={box.width - HANDLE_WIDTH}
              y={4}
              width={HANDLE_WIDTH}
              height={rowHeight - 8}
              onPointerDown={(event) => startDrag(event, bar, 'end')}
            />
          </>
        )}
        {linkable &&
          (['start', 'end'] as const).map((end) => {
            const cx = end === 'start' ? -LINK_HANDLE_OFFSET : right + LINK_HANDLE_OFFSET
            return (
              <g
                key={end}
                className={`ui-timeline__link-handle ui-timeline__link-handle--${end}`}
                data-link-end={end}
                aria-hidden="true"
                onPointerDown={(event) => startLinkDrag(event, bar, end)}
              >
                <circle
                  className="ui-timeline__link-handle-hit"
                  cx={cx}
                  cy={rowHeight / 2}
                  r={LINK_HANDLE_HIT}
                />
                <circle
                  className="ui-timeline__link-handle-dot"
                  cx={cx}
                  cy={rowHeight / 2}
                  r={LINK_HANDLE_RADIUS}
                />
              </g>
            )
          })}
      </g>
    )
    if (!barMenu) return group
    return (
      <ContextMenu key={bar.id} label={barLabel(bar)} items={() => barMenu(bar)}>
        {group as unknown as ContextMenuProps['children']}
      </ContextMenu>
    )
  }

  const interactiveArrows = !!onArrowActivate
  const arrowMarker = (tone: TimelineArrowSpec['tone']) =>
    `url(#ui-timeline-arrowhead-${tone === 'warning' ? 'warning' : 'default'})`

  return (
    <div className={cx('ui-timeline', className)} role="group" aria-label={label} data-zoom={zoom}>
      <div
        ref={scrollRef}
        className="ui-timeline__scroll"
        style={
          {
            '--timeline-label-width': `${labelWidth}px`,
            // A bar that takes focus scrolls clear of the sticky scale and
            // labels, never under them (P9.2, WCAG 2.4.11).
            scrollPaddingTop: HEADER_HEIGHT,
            scrollPaddingLeft: labelWidth
          } as CSSProperties
        }
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div
          className="ui-timeline__canvas"
          style={{ width: labelWidth + width, height: HEADER_HEIGHT + bodyHeight }}
        >
          <div className="ui-timeline__header" style={{ height: HEADER_HEIGHT }}>
            {axisMarks && (
              <div
                className="ui-timeline__marks"
                style={{ left: labelWidth, width, height: MARKS_HEIGHT }}
              >
                {axisMarks.map((mark) => (
                  <button
                    key={mark.id}
                    type="button"
                    className="ui-timeline__mark"
                    data-mark-id={mark.id}
                    aria-label={mark.label}
                    title={mark.label}
                    style={{
                      left: dateToX(mark.start, range.start, zoom),
                      width: Math.max((isoDaysBetween(mark.start, mark.end) + 1) * unit, 24)
                    }}
                    onClick={(event) => onAxisMarkActivate?.(mark.id, event.currentTarget)}
                  >
                    <span className="ui-timeline__mark-text">{mark.text}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="ui-timeline__corner" style={{ width: labelWidth }}>
              {labelHeader}
            </div>
            <div
              className="ui-timeline__scale"
              style={{ width, height: SCALE_HEIGHT }}
              aria-hidden="true"
            >
              {(['major', 'minor'] as const).map((tier) => (
                <div key={tier} className={`ui-timeline__tier ui-timeline__tier--${tier}`}>
                  {ticks[tier].map((tick) => (
                    <span
                      key={tick.date}
                      className={cx(
                        'ui-timeline__tick',
                        tier === 'minor' && zoom === 'week' && tick.date === today && 'is-today'
                      )}
                      title={
                        tier === 'minor' && zoom === 'week' && daysOff?.has(tick.date)
                          ? `${tick.title}, ${t('common:daysOff.dayOffLabel', { name: daysOff.get(tick.date) })}`
                          : tick.title
                      }
                      style={{
                        left: dateToX(tick.date, range.start, zoom),
                        width: tick.days * unit
                      }}
                    >
                      {tick.days * unit >= 16 ? (
                        <span className="ui-timeline__tick-text">{tick.label}</span>
                      ) : null}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div
            ref={bodyRef}
            className={cx('ui-timeline__body', linkDrag && 'is-linking')}
            style={{ height: bodyHeight }}
          >
            <svg
              className="ui-timeline__backdrop"
              width={width}
              height={bodyHeight}
              style={{ left: labelWidth }}
              aria-hidden="true"
            >
              {weekends.map((date) => (
                <rect
                  key={date}
                  className="ui-timeline__weekend"
                  x={dateToX(date, range.start, zoom)}
                  y={0}
                  width={unit}
                  height={bodyHeight}
                />
              ))}
              {offDays.map((date) => (
                <rect
                  key={`off:${date}`}
                  className="ui-timeline__day-off"
                  x={dateToX(date, range.start, zoom)}
                  y={0}
                  width={unit}
                  height={bodyHeight}
                />
              ))}
              {todayX !== null && (
                <line
                  className="ui-timeline__today"
                  x1={todayX}
                  x2={todayX}
                  y1={0}
                  y2={bodyHeight}
                />
              )}
            </svg>
            {virtualizer.getVirtualItems().map((virtual) => {
              const row = rows[virtual.index]
              const id = getRowId(row)
              return (
                <div
                  key={id}
                  className={cx('ui-timeline__row', rowClassName?.(row))}
                  data-row-id={id}
                  style={{
                    height: rowHeight,
                    transform: `translateY(${virtual.start - HEADER_HEIGHT}px)`
                  }}
                >
                  <div className="ui-timeline__label" style={{ width: labelWidth }}>
                    {renderLabel(row)}
                  </div>
                  <svg className="ui-timeline__bars" width={width} height={rowHeight}>
                    {barsFor(row).map(renderBarGroup)}
                  </svg>
                </div>
              )
            })}
            {/* After the rows, so Tab reaches the bars first; drawn behind them. */}
            <svg
              className="ui-timeline__links"
              width={width}
              height={bodyHeight}
              style={{ left: labelWidth }}
              aria-hidden={interactiveArrows ? undefined : 'true'}
            >
              <defs>
                {(['default', 'warning'] as const).map((tone) => (
                  <marker
                    key={tone}
                    id={`ui-timeline-arrowhead-${tone}`}
                    className={`ui-timeline__arrowhead ui-timeline__arrowhead--${tone}`}
                    viewBox="0 0 8 8"
                    refX={8}
                    refY={4}
                    markerWidth={7}
                    markerHeight={7}
                    markerUnits="userSpaceOnUse"
                    orient="auto"
                  >
                    <path d="M 0 0 L 8 4 L 0 8 z" />
                  </marker>
                ))}
              </defs>
              {arrowPaths.map((arrow) => {
                const ends = linkEnds(arrow.type ?? 'finish-to-start')
                const path = (
                  <path
                    className={cx(
                      'ui-timeline__arrow',
                      arrow.tone === 'warning' && 'ui-timeline__arrow--warning',
                      arrow.strong && 'ui-timeline__arrow--strong'
                    )}
                    d={arrow.d}
                    data-arrow-id={arrow.id}
                    data-link-from={ends.from}
                    data-link-to={ends.to}
                    markerEnd={arrowMarker(arrow.tone)}
                  >
                    {arrow.title && <title>{arrow.title}</title>}
                  </path>
                )
                const label = arrow.label && (
                  <text
                    className="ui-timeline__lag"
                    x={arrow.labelX + 4}
                    y={arrow.labelY}
                    dominantBaseline="middle"
                    aria-hidden="true"
                  >
                    {arrow.label}
                  </text>
                )
                if (!interactiveArrows)
                  return (
                    <g key={arrow.id} className="ui-timeline__link">
                      {path}
                      {label}
                    </g>
                  )
                const selected = selectedArrowId === arrow.id
                return (
                  <g
                    key={arrow.id}
                    className={cx('ui-timeline__link', 'is-interactive', selected && 'is-selected')}
                    role="button"
                    tabIndex={0}
                    aria-label={arrow.title ?? arrow.id}
                    aria-pressed={selected}
                    data-link-id={arrow.id}
                    onClick={(event) => onArrowActivate(arrow, event.currentTarget)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      onArrowActivate(arrow, event.currentTarget)
                    }}
                  >
                    <path className="ui-timeline__link-hit" d={arrow.d} />
                    {path}
                    {label}
                  </g>
                )
              })}
              {linkDrag && (
                <line
                  className="ui-timeline__link-draft"
                  x1={linkDrag.x1}
                  y1={linkDrag.y1}
                  x2={linkDrag.x}
                  y2={linkDrag.y}
                />
              )}
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}
