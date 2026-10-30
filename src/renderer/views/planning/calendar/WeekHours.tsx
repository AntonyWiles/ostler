import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from 'react'
import type { CalendarOccurrence, FillDayPiece, TimeBlock } from '@shared/ostler-api'
import { isBlockPassed, wallMoment } from '@shared/planning/free-time'
import { formatIsoDate, shiftIsoDate } from '@shared/dates'
import {
  BLOCK_STEP_MINUTES,
  MINUTES_PER_DAY,
  clockTime,
  cutAtMidnight,
  snapMinute
} from '@shared/planning/time-blocks'
import { t } from '@shared/i18n'
import { layoutHourItems, minutesOnDay, type HourItem } from '../../../ui/hour-layout'
import { blockLabel, blockTimeRange } from '../../../hooks/useTimeBlocks'
import { useNow } from '../../../time/TimerProvider'
import { cx } from '../../../ui/cx'
import '../../../components/time-blocks/time-blocks.css'
import './WeekHours.css'

/** A dragged block's id, so a drop on an hour moves it rather than making a new one. */
export const BLOCK_DRAG_TYPE = 'application/x-ostler-time-block'

const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

type HourEntry =
  | (HourItem & { kind: 'block'; block: TimeBlock })
  | (HourItem & { kind: 'event'; occurrence: CalendarOccurrence })

function minutesNow(now: number): number {
  const date = new Date(now)
  return date.getHours() * 60 + date.getMinutes()
}

/**
 * The Week's hours (N3.4a): seven day columns under the all-day row, from
 * midnight to midnight, opening on the working hours with the rest shaded.
 * Time blocks and timed events sit at their times, overlapping ones side by
 * side. Drop a task on an hour to block time (a block starts there, snapped
 * to the quarter hour); drag a block to move it, its bottom edge to change
 * its length. A focused block moves a quarter hour with Up and Down, a day
 * with Shift and an arrow, grows or shrinks with Alt and Up or Down, and
 * opens its card with Enter. The current time is a line on today.
 */
export function WeekHours({
  days,
  today,
  workingHours,
  blocks,
  events,
  renderEvent,
  onDropTask,
  onMoveBlock,
  onResizeBlock,
  onOpenBlock,
  ghosts = []
}: {
  days: readonly string[]
  today: string
  workingHours: { start: number; end: number }
  blocks: readonly TimeBlock[]
  events: readonly CalendarOccurrence[]
  renderEvent: (occurrence: CalendarOccurrence) => ReactNode
  onDropTask: (taskId: string, date: string, startMinute: number) => void
  onMoveBlock: (block: TimeBlock, date: string, startMinute: number) => void
  onResizeBlock: (block: TimeBlock, lengthMinutes: number) => void
  onOpenBlock: (block: TimeBlock, anchor: HTMLElement) => void
  /** Fill my day's preview (N3.4b): where blocks would go, drawn faintly. The list beside says the same. */
  ghosts?: readonly FillDayPiece[]
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const grab = useRef<{ blockId: string; offset: number } | null>(null)
  const [preview, setPreview] = useState<{
    date: string
    start: number
    length: number
    moving: boolean
  } | null>(null)
  const [resizing, setResizing] = useState<{ id: string; length: number } | null>(null)
  const now = useNow(days.includes(today), 60_000)
  const nowMinute = minutesNow(now)
  const moment = wallMoment(new Date(now))

  // Open on the working hours: scrolled to their start each time the week changes.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    scroller.scrollTop = (workingHours.start / MINUTES_PER_DAY) * scroller.scrollHeight
  }, [days[0], workingHours.start])

  const byDay = useMemo(() => {
    const map = new Map<string, ReturnType<typeof layoutHourItems<HourEntry>>>()
    for (const day of days) {
      const entries: HourEntry[] = []
      for (const block of blocks)
        if (block.date === day)
          entries.push({
            kind: 'block',
            id: `block:${block.id}`,
            start: block.startMinute,
            end: block.startMinute + block.lengthMinutes,
            block
          })
      for (const occurrence of events) {
        const span = minutesOnDay(day, occurrence)
        if (span) entries.push({ kind: 'event', id: `event:${occurrence.id}`, ...span, occurrence })
      }
      map.set(day, layoutHourItems(entries))
    }
    return map
  }, [days, blocks, events])

  /** The quarter hour under the pointer in an hour cell, less where a block was held. */
  const minuteAt = (event: DragEvent<HTMLElement>, hour: number): number => {
    const rect = event.currentTarget.getBoundingClientRect()
    const fraction = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0
    const offset = grab.current?.offset ?? 0
    return snapMinute(hour * 60 + Math.max(0, Math.min(1, fraction)) * 60 - offset)
  }

  const draggedBlock = (event: DragEvent<HTMLElement>): TimeBlock | null => {
    const id = grab.current?.blockId ?? event.dataTransfer?.getData(BLOCK_DRAG_TYPE)
    return (id && blocks.find((block) => block.id === id)) || null
  }

  const accepts = (event: DragEvent<HTMLElement>) => {
    const types = Array.from(event.dataTransfer?.types ?? [])
    return grab.current !== null || types.includes(BLOCK_DRAG_TYPE) || types.includes('text/plain')
  }

  const onCellDragOver = (event: DragEvent<HTMLElement>, date: string, hour: number) => {
    if (!accepts(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = grab.current ? 'move' : 'copy'
    const start = minuteAt(event, hour)
    const block = grab.current ? blocks.find((b) => b.id === grab.current!.blockId) : null
    const length = cutAtMidnight(start, block?.lengthMinutes ?? 60)
    if (!preview || preview.date !== date || preview.start !== start)
      setPreview({ date, start, length, moving: !!block })
  }

  const onCellDrop = (event: DragEvent<HTMLElement>, date: string, hour: number) => {
    if (!accepts(event)) return
    event.preventDefault()
    const start = minuteAt(event, hour)
    const block = draggedBlock(event)
    grab.current = null
    setPreview(null)
    if (block) {
      if (block.date !== date || block.startMinute !== start) onMoveBlock(block, date, start)
      return
    }
    const taskId = event.dataTransfer?.getData('text/plain')
    if (taskId) onDropTask(taskId, date, start)
  }

  const onBlockKeyDown = (event: KeyboardEvent<HTMLButtonElement>, block: TimeBlock) => {
    if (event.ctrlKey || event.metaKey) return
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 }[event.key]
    if (step === undefined) return
    const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown'
    if (event.altKey && vertical && !event.shiftKey) {
      event.preventDefault()
      const length = block.lengthMinutes + step * BLOCK_STEP_MINUTES
      if (length >= BLOCK_STEP_MINUTES && block.startMinute + length <= MINUTES_PER_DAY)
        onResizeBlock(block, length)
      return
    }
    if (event.altKey) return
    if (event.shiftKey) {
      event.preventDefault()
      onMoveBlock(block, shiftIsoDate(block.date, step), block.startMinute)
      return
    }
    if (!vertical) return
    event.preventDefault()
    const start = block.startMinute + step * BLOCK_STEP_MINUTES
    if (start >= 0 && start + block.lengthMinutes <= MINUTES_PER_DAY)
      onMoveBlock(block, block.date, start)
  }

  const onResizeStart = (event: PointerEvent<HTMLSpanElement>, block: TimeBlock) => {
    event.preventDefault()
    event.stopPropagation()
    const column = (event.currentTarget.closest('.week-hours__day') as HTMLElement | null) ?? null
    const height = column?.getBoundingClientRect().height ?? 0
    const perMinute = height > 0 ? height / MINUTES_PER_DAY : 1
    const startY = event.clientY
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    let length = block.lengthMinutes
    const move = (moveEvent: globalThis.PointerEvent) => {
      if (!Number.isFinite(moveEvent.clientY)) return
      const delta = (moveEvent.clientY - startY) / perMinute
      const raw =
        Math.round((block.lengthMinutes + delta) / BLOCK_STEP_MINUTES) * BLOCK_STEP_MINUTES
      length = Math.max(BLOCK_STEP_MINUTES, Math.min(raw, MINUTES_PER_DAY - block.startMinute))
      setResizing({ id: block.id, length })
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      setResizing(null)
      if (length !== block.lengthMinutes) onResizeBlock(block, length)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  useEffect(() => {
    const clear = () => {
      grab.current = null
      setPreview(null)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  const place = (start: number, length: number, column = 0, columns = 1): CSSProperties =>
    ({
      '--hour-top': start / MINUTES_PER_DAY,
      '--hour-height': length / MINUTES_PER_DAY,
      '--hour-column': column,
      '--hour-columns': columns
    }) as CSSProperties

  return (
    <div
      className="week-hours"
      role="group"
      aria-label={t('views:timeBlocks.hoursLabel')}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreview(null)
      }}
    >
      <div ref={scrollRef} className="week-hours__scroll">
        <div className="week-hours__grid">
          <div className="week-hours__gutter" aria-hidden="true">
            {HOURS.map((hour) => (
              <span key={hour} className="week-hours__hour-label">
                {hour === 0 ? '' : clockTime(hour * 60)}
              </span>
            ))}
          </div>
          {days.map((date) => {
            const dayName = formatIsoDate(date, { weekday: 'long', day: 'numeric', month: 'long' })
            return (
              <div
                key={date}
                className={cx('week-hours__day', date === today && 'is-today')}
                role="group"
                aria-label={dayName}
                data-hours-date={date}
              >
                {HOURS.map((hour) => {
                  const outside =
                    hour * 60 + 60 <= workingHours.start || hour * 60 >= workingHours.end
                  return (
                    <div
                      key={hour}
                      className={cx('week-hours__cell', outside && 'is-outside')}
                      data-hour={hour}
                      onDragOver={(event) => onCellDragOver(event, date, hour)}
                      onDrop={(event) => onCellDrop(event, date, hour)}
                    />
                  )
                })}
                {(byDay.get(date) ?? []).map(({ item, column, columns }) => {
                  if (item.kind === 'event')
                    return (
                      <div
                        key={item.id}
                        className="week-hours__item week-hours__item--event"
                        style={place(item.start, item.end - item.start, column, columns)}
                      >
                        {renderEvent(item.occurrence)}
                      </div>
                    )
                  const block = item.block
                  const length = resizing?.id === block.id ? resizing.length : block.lengthMinutes
                  const passed = isBlockPassed(block, moment)
                  const label = blockLabel({ ...block, lengthMinutes: length })
                  return (
                    <div
                      key={item.id}
                      className={cx(
                        'week-hours__item',
                        'week-hours__item--block',
                        `week-hours__item--${block.status}`,
                        passed && 'is-passed'
                      )}
                      style={place(block.startMinute, length, column, columns)}
                      data-block-id={block.id}
                      draggable
                      onDragStart={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect()
                        const offset =
                          rect.height > 0
                            ? ((event.clientY - rect.top) / rect.height) * block.lengthMinutes
                            : 0
                        grab.current = {
                          blockId: block.id,
                          offset: Math.floor(offset / BLOCK_STEP_MINUTES) * BLOCK_STEP_MINUTES
                        }
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData(BLOCK_DRAG_TYPE, block.id)
                      }}
                    >
                      <button
                        type="button"
                        className="time-block"
                        aria-label={passed ? t('views:blockMoves.passedLabel', { label }) : label}
                        aria-haspopup="dialog"
                        aria-keyshortcuts="ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Alt+ArrowUp Alt+ArrowDown"
                        title={`${block.title}, ${blockTimeRange({ ...block, lengthMinutes: length })}`}
                        onClick={(event) => onOpenBlock(block, event.currentTarget)}
                        onKeyDown={(event) => onBlockKeyDown(event, block)}
                      >
                        <span className="time-block__time">
                          {blockTimeRange({ ...block, lengthMinutes: length })}
                        </span>
                        <span className="time-block__title">{block.title}</span>
                      </button>
                      <span
                        className="time-block__resize"
                        aria-hidden="true"
                        onPointerDown={(event) => onResizeStart(event, block)}
                      />
                    </div>
                  )
                })}
                {ghosts
                  .filter((ghost) => ghost.date === date)
                  .map((ghost) => (
                    <div
                      key={`ghost:${ghost.workItemId}:${ghost.part}`}
                      className="week-hours__ghost"
                      style={place(ghost.startMinute, ghost.lengthMinutes)}
                      aria-hidden="true"
                    >
                      <span className="time-block__time">{blockTimeRange(ghost)}</span>
                      <span className="time-block__title">{ghost.title}</span>
                    </div>
                  ))}
                {preview?.date === date && (
                  <div
                    className="week-hours__preview"
                    style={place(preview.start, preview.length)}
                    aria-hidden="true"
                  >
                    {t(
                      preview.moving ? 'views:timeBlocks.moveTo' : 'views:timeBlocks.dropToBlock',
                      {
                        time: clockTime(preview.start)
                      }
                    )}
                  </div>
                )}
                {date === today && (
                  <div
                    className="week-hours__now"
                    style={{ '--hour-top': nowMinute / MINUTES_PER_DAY } as CSSProperties}
                    aria-hidden="true"
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
