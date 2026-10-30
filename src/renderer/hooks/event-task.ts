import type { CalendarOccurrence, CreatePlanningWorkItemInput } from '@shared/ostler-api'
import { t } from '@shared/i18n'

/**
 * Make a task from an event (N3.3a, decision N26): the one way an event
 * becomes work, and only when the person asks. The event's title, its first
 * day as the due date, and its time and location in the description fill
 * New task in the project the person picked; they review it and press
 * Create. Kept here for the one hand-off, never in the address, so an
 * event's details do not travel in a link.
 */
let pending: CreatePlanningWorkItemInput | null = null

/** New task's values for an event. The due date is the event's calendar date. */
export function taskFromEvent(
  occurrence: Pick<
    CalendarOccurrence,
    'title' | 'startDate' | 'startTime' | 'endTime' | 'location' | 'allDay'
  >
): CreatePlanningWorkItemInput {
  const lines = [
    occurrence.allDay || !occurrence.startTime
      ? t('views:calendarEvents.notesAllDay')
      : t('views:calendarEvents.notesTime', {
          start: occurrence.startTime,
          end: occurrence.endTime ?? occurrence.startTime
        }),
    occurrence.location
      ? t('views:calendarEvents.notesLocation', { location: occurrence.location })
      : null
  ].filter(Boolean)
  return {
    title: [...occurrence.title].slice(0, 200).join(''),
    description: lines.join('\n'),
    targetDate: occurrence.startDate
  }
}

export function setPendingEventTask(values: CreatePlanningWorkItemInput): void {
  pending = values
}

/** The values waiting for New task, once. */
export function takePendingEventTask(): CreatePlanningWorkItemInput | null {
  const values = pending
  pending = null
  return values
}
