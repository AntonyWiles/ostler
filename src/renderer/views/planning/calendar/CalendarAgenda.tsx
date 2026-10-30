import type { ReactNode } from 'react'
import { parseIsoDate } from '@shared/dates'
import { dateTimeFormat } from '@shared/format'
import { t } from '@shared/i18n'
import { agendaDays, Badge, dayOffWords, type CalendarDayOff, type CalendarSpan } from '../../../ui'
import { dayHeading } from './CalendarYear'
import './CalendarAgenda.css'

/** "14 – 18 March": a span's days in the active locale. */
export function spanText(start: string, end: string): string {
  const from = parseIsoDate(start)
  const to = parseIsoDate(end)
  if (!from || !to) return `${start} – ${end}`
  return dateTimeFormat({ day: 'numeric', month: 'long' }).formatRange(from, to)
}

/**
 * Agenda (N3.1a): the focused month as a list of days, each a heading
 * followed by its milestones and tasks. A task over several days shows once,
 * on its first day in the month (`agendaDays`). Days with nothing are left
 * out. A real list of headings, so a screen reader can move day to day.
 */
export function CalendarAgenda<T extends CalendarSpan>({
  items,
  focusedDate,
  today,
  renderItem,
  dayOff
}: {
  items: readonly T[]
  focusedDate: string
  today: string
  renderItem: (item: T) => ReactNode
  /** Days off (N3.2): named beside the day's heading. */
  dayOff?: (date: string) => CalendarDayOff | null
}) {
  const days = agendaDays(items, focusedDate)
  return (
    <div className="calendar-agenda">
      {days.length > 0 && (
        <ol className="calendar-agenda__days" aria-label={t('views:calendarView.agendaLabel')}>
          {days.map((day) => (
            <li
              key={day.date}
              className={`calendar-agenda__day${day.date === today ? ' is-today' : ''}`}
            >
              <h3 className="calendar-agenda__heading" data-date={day.date} tabIndex={-1}>
                {dayHeading(day.date)}
                {day.date === today && (
                  <Badge tone="info" className="calendar-agenda__today">
                    {t('views:calendarView.today')}
                  </Badge>
                )}
                {dayOffWords(dayOff?.(day.date)).note && (
                  <Badge className="calendar-agenda__today">
                    {dayOffWords(dayOff?.(day.date)).note}
                  </Badge>
                )}
              </h3>
              <ul className="calendar-agenda__items">
                {day.items.map((item) => (
                  <li key={item.id}>{renderItem(item)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      <p className="calendar-agenda__end">
        {days.length > 0
          ? t('views:calendarView.nothingElseThisMonth')
          : t('views:calendarView.nothingThisMonth')}
      </p>
    </div>
  )
}
