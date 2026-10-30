import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CalendarOccurrence } from '@shared/ostler-api'
import { formatIsoDate } from '@shared/dates'
import { meetingLink } from '@shared/calendar/meeting-link'
import { t } from '@shared/i18n'
import { useCalendars } from '../../context/CalendarsContext'
import { useProjectList } from '../../context/OstlerContext'
import { projectPath } from '../../navigation/paths'
import { setPendingEventTask, taskFromEvent } from '../../hooks/event-task'
import { Button, Popover, Select } from '../../ui'
import { Plus } from '../../ui/icons'
import './calendar-events.css'

function longDate(date: string): string {
  return formatIsoDate(date, { weekday: 'long', day: 'numeric', month: 'long' })
}

/** "Monday 19 October, 09:30 – 09:45", "All day", or the days an event covers. */
export function eventWhen(
  occurrence: Pick<CalendarOccurrence, 'allDay' | 'startDate' | 'endDate' | 'startTime' | 'endTime'>
): string {
  const days =
    occurrence.startDate === occurrence.endDate
      ? longDate(occurrence.startDate)
      : t('views:calendarEvents.days', {
          first: longDate(occurrence.startDate),
          last: longDate(occurrence.endDate)
        })
  if (occurrence.allDay || !occurrence.startTime)
    return t('views:calendarEvents.allDayOn', { days })
  return t('views:calendarEvents.timeOn', {
    days,
    start: occurrence.startTime,
    end: occurrence.endTime ?? occurrence.startTime
  })
}

/** An event's accessible name: "Stand-up, event, Monday 19 October, 09:30 – 09:45, Work". */
export function eventLabel(
  occurrence: CalendarOccurrence,
  calendarName: string | undefined
): string {
  return [
    occurrence.title,
    t('views:calendarEvents.event'),
    eventWhen(occurrence),
    calendarName ?? null
  ]
    .filter(Boolean)
    .join(', ')
}

/**
 * An event's read-only card (N3.3a): its title, time, location, description
 * as plain text and its calendar, and Make a task, which fills New task in a
 * project the person picks. Events cannot be edited here or anywhere.
 */
export function EventCard({
  occurrence,
  anchor,
  onClose,
  projectId
}: {
  occurrence: CalendarOccurrence
  anchor: HTMLElement | null
  onClose: () => void
  /** The project to offer first (the Calendar's own); otherwise the first project. */
  projectId?: string
}) {
  const navigate = useNavigate()
  const { byId } = useCalendars()
  const projects = useProjectList().filter((project) => project.enabled)
  const calendar = byId.get(occurrence.calendarId)
  const join = meetingLink(occurrence.location ?? '', occurrence.description ?? '')
  const [picking, setPicking] = useState(false)
  const [target, setTarget] = useState(
    projectId && projects.some((project) => project.id === projectId)
      ? projectId
      : (projects[0]?.id ?? '')
  )

  const makeTask = () => {
    if (!target) return
    setPendingEventTask(taskFromEvent(occurrence))
    onClose()
    navigate(projectPath(target, undefined, { newTask: '1' }))
  }

  return (
    <Popover
      open
      onClose={onClose}
      anchorRef={{ current: anchor }}
      label={occurrence.title}
      className="calendar-event-card"
    >
      <h3 className="calendar-event-card__title">{occurrence.title}</h3>
      <p className="calendar-event-card__when">{eventWhen(occurrence)}</p>
      {occurrence.location && (
        <p className="calendar-event-card__location">
          {t('views:calendarEvents.location', { location: occurrence.location })}
        </p>
      )}
      {occurrence.description && (
        <p className="calendar-event-card__description">{occurrence.description}</p>
      )}
      {calendar && (
        <p className="calendar-event-card__calendar">
          <span
            className="calendar-event-card__mark"
            style={{ backgroundColor: calendar.color }}
            aria-hidden="true"
          />
          {t('views:calendarEvents.fromCalendar', { name: calendar.name })}
        </p>
      )}
      <p className="calendar-event-card__note">{t('views:calendarEvents.readOnly')}</p>
      {picking ? (
        <div className="calendar-event-card__make">
          <Select
            label={t('views:calendarEvents.inProject')}
            options={projects.map((project) => ({ value: project.id, label: project.name }))}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          />
          <div className="calendar-event-card__actions">
            <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
              {t('views:calendarEvents.cancel')}
            </Button>
            <Button size="sm" variant="primary" disabled={!target} onClick={makeTask}>
              {t('views:calendarEvents.continue')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="calendar-event-card__actions">
          {join && (
            <Button
              size="sm"
              variant="primary"
              aria-label={t('views:calendarEvents.joinLabel', { title: occurrence.title })}
              onClick={() => void window.ostlerAPI.openExternalLink(join)}
            >
              {t('views:calendarEvents.join')}
            </Button>
          )}
          <Button
            size="sm"
            icon={Plus}
            disabled={projects.length === 0}
            onClick={() => setPicking(true)}
          >
            {t('views:calendarEvents.makeTask')}
          </Button>
        </div>
      )}
    </Popover>
  )
}
