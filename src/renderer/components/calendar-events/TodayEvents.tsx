import { useState, type CSSProperties } from 'react'
import type { CalendarOccurrence } from '@shared/ostler-api'
import { occurrenceLine } from '@shared/calendar/expand-events'
import { t } from '@shared/i18n'
import { useCalendars } from '../../context/CalendarsContext'
import { useCalendarEvents } from '../../hooks/useCalendarEvents'
import { EventCard, eventLabel } from './EventCard'
import './calendar-events.css'

/** "3 events today; next: 14:00 Design review". `now` is an instant, ms. */
export function todaySummary(events: readonly CalendarOccurrence[], now: number): string {
  if (events.length === 0) return t('views:calendarEvents.todayNone')
  const count = t('views:calendarEvents.todayCount', { count: events.length })
  const timed = events.filter((event) => !event.allDay)
  if (timed.length === 0) return count
  const next = timed.find((event) => event.start >= now) ?? null
  return next
    ? `${count}; ${t('views:calendarEvents.next', { line: occurrenceLine(next) })}`
    : timed.every((event) => event.end <= now)
      ? `${count}; ${t('views:calendarEvents.allDone')}`
      : count
}

/**
 * Home's quiet strip beside Today (N3.3a): today's events from the shown
 * calendars, in time order, with a one-line summary. Each opens its
 * read-only card. Nothing shows until a calendar has been added.
 */
export function TodayEvents({ today }: { today: string }) {
  const { calendars, byId } = useCalendars()
  const events = useCalendarEvents(today, today)
  const [open, setOpen] = useState<{ occurrence: CalendarOccurrence; anchor: HTMLElement } | null>(
    null
  )
  if (!calendars.some((calendar) => !calendar.hidden)) return null
  return (
    <div className="home-events" role="group" aria-label={t('views:calendarEvents.stripLabel')}>
      <p className="home-events__summary">{todaySummary(events, Date.now())}</p>
      {events.length > 0 && (
        <ul className="home-events__list">
          {events.map((occurrence) => {
            const calendar = byId.get(occurrence.calendarId)
            return (
              <li key={occurrence.id}>
                <button
                  type="button"
                  className="calendar-event"
                  style={{ '--event-color': calendar?.color } as CSSProperties}
                  aria-label={eventLabel(occurrence, calendar?.name)}
                  aria-haspopup="dialog"
                  onClick={(event) => setOpen({ occurrence, anchor: event.currentTarget })}
                >
                  {occurrence.startTime && (
                    <span className="calendar-event__time">{occurrence.startTime}</span>
                  )}
                  <span className="calendar-event__title">{occurrence.title}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {open && (
        <EventCard
          occurrence={open.occurrence}
          anchor={open.anchor}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
