import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { formatIsoDate, parseIsoDate, shiftIsoDate } from '@shared/dates'
import { Popover } from './Popover'
import { cx } from './cx'
import {
  calendarWeeks,
  dayOffWords,
  isWeekend,
  itemsOnDay,
  layoutWeek,
  localeWeekStart,
  monthOf,
  shiftPeriod,
  startOfWeek,
  type CalendarDayOff,
  type CalendarMode,
  type CalendarSegment,
  type CalendarSpan,
  type Weekday
} from './calendar-layout'
import './CalendarGrid.css'
import { t } from '@shared/i18n'

/** Where an item is being drawn: a bar piece in a day, or a row in a "+N more" list. */
export interface CalendarItemPlace<T extends CalendarSpan> {
  segment: CalendarSegment<T> | null
  /** Whether Tab reaches it now: its piece starts on the focused day, or it is in a list. */
  tabbable: boolean
}

/** What was dropped on a day: an item's id and, for the grid's own items, the day it was held by. */
export interface CalendarDrop {
  itemId: string
  /** The day under the pointer when the drag began; null for a drag from outside the grid. */
  grabbedDate: string | null
}

export interface CalendarGridProps<T extends CalendarSpan> {
  /** Names the grid. */
  label: string
  mode: CalendarMode
  /** The focused day. The grid shows the month or week that holds it. */
  focusedDate: string
  onFocusedDateChange: (date: string) => void
  /** Today, `YYYY-MM-DD`, marked on the grid. */
  today: string
  /** 0 Sunday … 6 Saturday. Defaults to the OS locale's, else Monday. */
  weekStart?: Weekday
  /** In the order they should stack within a day. */
  items: readonly T[]
  renderItem: (item: T, place: CalendarItemPlace<T>) => ReactNode
  /** Items that may be dragged to another day. */
  canDrag?: (item: T) => boolean
  /** A drop on a day: one of the grid's items, or text/plain from elsewhere. */
  onDrop?: (date: string, drop: CalendarDrop) => void
  /** Enter on a day. */
  onDayActivate?: (date: string) => void
  /** Controls in a day's header, such as an "Add" button. */
  renderDayAction?: (date: string, tabbable: boolean) => ReactNode
  /** Rows of items a day shows before "+N more". Default 3 in a month, 12 in a week. */
  maxLanes?: number
  /**
   * A day off on a day (N3.2): everyone's is shaded and named, a person's
   * leave is a quiet note. Shaded apart from weekends, and always in words.
   */
  dayOff?: (date: string) => CalendarDayOff | null
  className?: string
}

const DRAG_TYPE = 'application/x-ostler-calendar-item'

function longDate(date: string): string {
  return formatIsoDate(date, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
}

function weekdayName(date: string, width: 'short' | 'long'): string {
  return formatIsoDate(date, { weekday: width }) ?? ''
}

/**
 * A month or week of days with items on them.
 * It knows days and items, not tasks. An ARIA grid: the arrow keys move the
 * focused day, Page Up and Page Down change the period, Home and End go to
 * the week's first and last day, Enter activates the day, and Tab goes into
 * the focused day's items. An item covering several days is a bar across
 * them, cut into one piece per week. A day with more items than it has room
 * for shows "+N more", which opens the day's list.
 */
export function CalendarGrid<T extends CalendarSpan>({
  label,
  mode,
  focusedDate,
  onFocusedDateChange,
  today,
  weekStart: weekStartProp,
  items,
  renderItem,
  canDrag,
  onDrop,
  onDayActivate,
  renderDayAction,
  maxLanes,
  dayOff,
  className
}: CalendarGridProps<T>) {
  const weekStart = useMemo(() => weekStartProp ?? localeWeekStart(), [weekStartProp])
  const lanes = maxLanes ?? (mode === 'month' ? 3 : 12)
  const weeks = useMemo(
    () => calendarWeeks(focusedDate, mode, weekStart),
    [focusedDate, mode, weekStart]
  )
  const layouts = useMemo(
    () => weeks.map((week) => layoutWeek(items, week, lanes)),
    [weeks, items, lanes]
  )
  const month = monthOf(focusedDate)

  const gridRef = useRef<HTMLDivElement | null>(null)
  const moveFocus = useRef(false)
  const drag = useRef<CalendarDrop | null>(null)
  const moreRefs = useRef(new Map<string, HTMLButtonElement | null>())
  const [moreDate, setMoreDate] = useState<string | null>(null)
  const [dropDate, setDropDate] = useState<string | null>(null)

  // Keyboard moves focus with the focused day, once the new period renders.
  useEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${focusedDate}"]`)?.focus()
  }, [focusedDate])

  const go = (date: string) => {
    moveFocus.current = true
    onFocusedDateChange(date)
  }

  const onCellKeyDown = (event: KeyboardEvent<HTMLDivElement>, date: string) => {
    if (event.target !== event.currentTarget) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const weekFirst = startOfWeek(date, weekStart)
    const moves: Record<string, () => string> = {
      ArrowLeft: () => shiftIsoDate(date, -1),
      ArrowRight: () => shiftIsoDate(date, 1),
      ArrowUp: () => shiftIsoDate(date, -7),
      ArrowDown: () => shiftIsoDate(date, 7),
      PageUp: () => shiftPeriod(date, mode, -1),
      PageDown: () => shiftPeriod(date, mode, 1),
      Home: () => weekFirst,
      End: () => shiftIsoDate(weekFirst, 6)
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      go(move())
    } else if (event.key === 'Enter' && onDayActivate) {
      event.preventDefault()
      onDayActivate(date)
    }
  }

  const onItemDragStart = (event: DragEvent<HTMLDivElement>, segment: CalendarSegment<T>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const dayWidth = rect.width / segment.span
    const offset =
      dayWidth > 0
        ? Math.min(
            segment.span - 1,
            Math.max(0, Math.floor((event.clientX - rect.left) / dayWidth))
          )
        : 0
    drag.current = { itemId: segment.item.id, grabbedDate: shiftIsoDate(segment.start, offset) }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', segment.item.id)
    event.dataTransfer.setData(DRAG_TYPE, segment.item.id)
  }

  const accepts = (event: DragEvent) =>
    !!onDrop &&
    (drag.current !== null || Array.from(event.dataTransfer?.types ?? []).includes('text/plain'))

  const onDayDrop = (event: DragEvent<HTMLDivElement>, date: string) => {
    setDropDate(null)
    if (!accepts(event)) return
    event.preventDefault()
    const own = drag.current
    drag.current = null
    if (own) {
      onDrop!(date, own)
      return
    }
    const itemId = event.dataTransfer.getData('text/plain')
    if (itemId) onDrop!(date, { itemId, grabbedDate: null })
  }

  const header = weeks[0]

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={label}
      aria-readonly="true"
      className={cx('ui-calendar', `ui-calendar--${mode}`, className)}
      style={{ '--calendar-lanes': lanes } as CSSProperties}
    >
      <div role="row" className="ui-calendar__head">
        {header.map((date) => (
          <div
            key={date}
            role="columnheader"
            aria-label={weekdayName(date, 'long')}
            className={cx(
              'ui-calendar__weekday',
              isWeekend(date) && 'is-weekend',
              mode === 'week' && date === today && 'is-today'
            )}
          >
            {weekdayName(date, 'short')}
            {mode === 'week' && (
              <span className="ui-calendar__weekday-date"> {parseIsoDate(date)?.getDate()}</span>
            )}
          </div>
        ))}
      </div>
      <div className="ui-calendar__body">
        {weeks.map((week, weekIndex) => {
          const { segments, hidden } = layouts[weekIndex]
          return (
            <div key={week[0]} role="row" className="ui-calendar__week">
              {week.map((date, column) => {
                const focused = date === focusedDate
                const outside = mode === 'month' && monthOf(date) !== month
                const isToday = date === today
                const own = segments.filter((segment) => segment.column === column)
                const more = hidden.get(date) ?? []
                const total = itemsOnDay(items, date).length
                const off = dayOff?.(date) ?? null
                const offWords = dayOffWords(off)
                const dayLabel = [
                  longDate(date),
                  isToday ? 'today' : null,
                  offWords.label,
                  total === 1
                    ? t('common:calendarGrid.n1Item')
                    : total > 1
                      ? t('common:calendarGrid.items', { total })
                      : null
                ]
                  .filter(Boolean)
                  .join(', ')
                return (
                  <div
                    key={date}
                    role="gridcell"
                    data-date={date}
                    aria-label={dayLabel}
                    aria-selected={focused}
                    aria-current={isToday ? 'date' : undefined}
                    tabIndex={focused ? 0 : -1}
                    className={cx(
                      'ui-calendar__day',
                      isWeekend(date) && 'is-weekend',
                      off?.name && 'is-day-off',
                      outside && 'is-outside',
                      isToday && 'is-today',
                      dropDate === date && 'is-drop-target'
                    )}
                    onKeyDown={(event) => onCellKeyDown(event, date)}
                    onFocus={(event) => {
                      if (event.target === event.currentTarget && !focused)
                        onFocusedDateChange(date)
                    }}
                    onDragOver={(event) => {
                      if (!accepts(event)) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      if (dropDate !== date) setDropDate(date)
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                        setDropDate((current) => (current === date ? null : current))
                    }}
                    onDrop={(event) => onDayDrop(event, date)}
                  >
                    <div className="ui-calendar__day-head">
                      {mode === 'month' ? (
                        <span className="ui-calendar__day-number" aria-hidden="true">
                          {parseIsoDate(date)?.getDate()}
                        </span>
                      ) : (
                        <span />
                      )}
                      {offWords.note && (
                        <span
                          className={cx(
                            'ui-calendar__day-off',
                            !off?.name && 'ui-calendar__day-off--person'
                          )}
                          aria-hidden="true"
                          title={offWords.note}
                        >
                          {offWords.note}
                        </span>
                      )}
                      {renderDayAction?.(date, focused)}
                    </div>
                    {own.map((segment) => (
                      <div
                        key={`${segment.item.id}:${segment.column}`}
                        data-item-id={segment.item.id}
                        className={cx(
                          'ui-calendar__item',
                          segment.continuesBefore && 'continues-before',
                          segment.continuesAfter && 'continues-after'
                        )}
                        style={
                          {
                            '--calendar-span': segment.span,
                            '--calendar-lane': segment.lane
                          } as CSSProperties
                        }
                        draggable={canDrag?.(segment.item) ?? false}
                        onDragStart={(event) => onItemDragStart(event, segment)}
                        onDragEnd={() => {
                          drag.current = null
                          setDropDate(null)
                        }}
                      >
                        {renderItem(segment.item, { segment, tabbable: focused })}
                      </div>
                    ))}
                    {more.length > 0 && (
                      <button
                        ref={(node) => {
                          moreRefs.current.set(date, node)
                        }}
                        type="button"
                        tabIndex={focused ? 0 : -1}
                        className="ui-calendar__more"
                        aria-haspopup="dialog"
                        aria-expanded={moreDate === date}
                        aria-label={t('common:calendarGrid.more2', {
                          moreCount: more.length,
                          longDate: longDate(date)
                        })}
                        onClick={() => setMoreDate(date)}
                      >
                        {t('common:calendarGrid.more', { moreCount: more.length })}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      {moreDate && (
        <Popover
          open
          onClose={() => setMoreDate(null)}
          anchorRef={{ current: moreRefs.current.get(moreDate) ?? null }}
          label={longDate(moreDate)}
          className="ui-calendar__popover"
        >
          <p className="ui-calendar__popover-title">{longDate(moreDate)}</p>
          <ul className="ui-calendar__popover-list">
            {itemsOnDay(items, moreDate).map((item) => (
              <li key={item.id}>{renderItem(item, { segment: null, tabbable: true })}</li>
            ))}
          </ul>
        </Popover>
      )}
    </div>
  )
}
