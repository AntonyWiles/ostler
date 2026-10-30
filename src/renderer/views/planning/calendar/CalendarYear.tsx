import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { formatIsoDate, parseIsoDate, shiftIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import {
  dayOffWords,
  isWeekend,
  localeWeekStart,
  shiftPeriod,
  startOfWeek,
  weekFrom,
  workLevel,
  yearMonths,
  yearWork,
  type CalendarDayOff,
  type CalendarSpan,
  type DayWork
} from '../../../ui'
import './CalendarYear.css'

/** Arrow keys: how many days they move the focused day. */
const ARROW_DAYS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7
}

/** "Tuesday 14 March". */
export function dayHeading(date: string): string {
  return formatIsoDate(date, { weekday: 'long', day: 'numeric', month: 'long' })
}

/** A day's accessible name: "Tuesday 14 March: 3 tasks, 1 milestone". */
export function yearDayName(
  date: string,
  work: DayWork | undefined,
  dayOff: CalendarDayOff | null = null
): string {
  const name = yearWorkName(date, work)
  const off = dayOffWords(dayOff).label
  return off ? `${name}, ${off}` : name
}

function yearWorkName(date: string, work: DayWork | undefined): string {
  const longDate = dayHeading(date)
  const tasks = work?.tasks ? t('views:calendarView.taskCount', { count: work.tasks }) : null
  const milestones = work?.milestones
    ? t('views:calendarView.milestoneCount', { count: work.milestones })
    : null
  if (tasks && milestones)
    return t('views:calendarView.yearDayBoth', { longDate, tasks, milestones })
  if (tasks || milestones)
    return t('views:calendarView.yearDayWork', { longDate, work: tasks ?? milestones })
  return longDate
}

/**
 * Year (N3.1a): twelve small months in the person's week start. A day with
 * work carries a mark whose strength says how much; Enter or a click opens
 * Week at that day. One day is tabbable; the arrow keys move between days and
 * Page Up and Page Down between months. Built from plain data in one pass
 * (`yearWork`), so 365 days stay cheap however many tasks there are.
 */
export function CalendarYear<T extends CalendarSpan>({
  items,
  isMilestone,
  focusedDate,
  today,
  onFocusedDateChange,
  onOpenDay,
  dayOff
}: {
  items: readonly T[]
  isMilestone: (item: T) => boolean
  focusedDate: string
  today: string
  onFocusedDateChange: (date: string) => void
  onOpenDay: (date: string) => void
  /** Days off (N3.2), shaded and named in each day's accessible name. */
  dayOff?: (date: string) => CalendarDayOff | null
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const moved = useRef(false)
  const weekStart = localeWeekStart()
  const year = focusedDate.slice(0, 4)
  const months = useMemo(() => yearMonths(`${year}-01-01`, weekStart), [year, weekStart])
  const work = useMemo(
    () => yearWork(items, `${year}-01-01`, isMilestone),
    [items, year, isMilestone]
  )
  const weekdays = weekFrom(startOfWeek(`${year}-01-01`, weekStart))

  // After a key moves the focused day, focus follows it (into another year too).
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    rootRef.current?.querySelector<HTMLElement>(`[data-date="${focusedDate}"]`)?.focus()
  }, [focusedDate])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'Enter' || event.key === ' ') {
      const date = (event.target as HTMLElement).dataset.date
      if (!date) return
      event.preventDefault()
      onOpenDay(date)
      return
    }
    let next: string | null = null
    if (ARROW_DAYS[event.key] !== undefined) next = shiftIsoDate(focusedDate, ARROW_DAYS[event.key])
    else if (event.key === 'PageUp') next = shiftPeriod(focusedDate, 'month', -1)
    else if (event.key === 'PageDown') next = shiftPeriod(focusedDate, 'month', 1)
    if (!next) return
    event.preventDefault()
    moved.current = true
    onFocusedDateChange(next)
  }

  return (
    <div
      ref={rootRef}
      className="calendar-year"
      role="group"
      aria-label={t('views:calendarView.yearLabel', { year })}
      onKeyDown={onKeyDown}
    >
      {months.map((month) => {
        const headingId = `calendar-year-${month.first}`
        return (
          <section key={month.first} className="calendar-year__month">
            <h3 id={headingId} className="calendar-year__month-name">
              {formatIsoDate(month.first, { month: 'long' })}
            </h3>
            <table role="grid" aria-labelledby={headingId} className="calendar-year__grid">
              <thead>
                <tr>
                  {weekdays.map((date) => (
                    <th
                      key={date}
                      scope="col"
                      aria-label={formatIsoDate(date, { weekday: 'long' })}
                      className={isWeekend(date) ? 'is-weekend' : undefined}
                    >
                      {formatIsoDate(date, { weekday: 'narrow' })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {month.weeks.map((week, row) => (
                  <tr key={row}>
                    {week.map((date, column) =>
                      date ? (
                        <td
                          key={date}
                          role="gridcell"
                          className={
                            [isWeekend(date) && 'is-weekend', dayOff?.(date)?.name && 'is-day-off']
                              .filter(Boolean)
                              .join(' ') || undefined
                          }
                        >
                          <button
                            type="button"
                            data-date={date}
                            tabIndex={date === focusedDate ? 0 : -1}
                            aria-label={yearDayName(date, work.get(date), dayOff?.(date))}
                            aria-current={date === today ? 'date' : undefined}
                            className={[
                              'calendar-year__day',
                              `calendar-year__day--${workLevel(work.get(date))}`,
                              date === today && 'is-today'
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            onFocus={() => {
                              if (date !== focusedDate) onFocusedDateChange(date)
                            }}
                            onClick={() => onOpenDay(date)}
                          >
                            {parseIsoDate(date)?.getDate()}
                          </button>
                        </td>
                      ) : (
                        <td key={`blank-${column}`} role="gridcell" />
                      )
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )
      })}
    </div>
  )
}
