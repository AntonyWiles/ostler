import type { PlanningWorkItem } from '../ostler-api'
import { compareIsoDates, isIsoDate, isoDaysBetween, shiftIsoDate } from '../dates'

/**
 * The Calendar view's rules (P5.4): which days a task covers, and what
 * moving it writes. Pure and on `YYYY-MM-DD` strings only, so a move gives
 * the same dates in every time zone; P5.5's timeline reuses the same moves.
 */

/** The dates a reschedule writes, as the update call takes them. */
export interface TaskDatePatch {
  targetDate: string
  startDate?: string | null
}

/**
 * The days a task covers on the calendar: from its start date (when it has
 * one, and it is not after the due date) to its due date. Null for a task
 * with no due date, which belongs in the Unscheduled panel.
 */
export function taskCalendarRange(
  item: Pick<PlanningWorkItem, 'startDate' | 'targetDate'>
): { start: string; end: string } | null {
  const due = item.targetDate
  if (!due || !isIsoDate(due)) return null
  const start =
    item.startDate && isIsoDate(item.startDate) && compareIsoDates(item.startDate, due) <= 0
      ? item.startDate
      : due
  return { start, end: due }
}

/**
 * A task moved by whole days: its due date, and its start date by the same
 * number, so the pair stays in order and passes validation. A task with no
 * due date has nothing to move (null).
 */
export function shiftTaskDates(
  item: Pick<PlanningWorkItem, 'startDate' | 'targetDate'>,
  days: number
): TaskDatePatch | null {
  if (!item.targetDate || !isIsoDate(item.targetDate)) return null
  const patch: TaskDatePatch = { targetDate: shiftIsoDate(item.targetDate, days) }
  if (item.startDate && isIsoDate(item.startDate))
    patch.startDate = shiftIsoDate(item.startDate, days)
  return patch
}

/**
 * What dropping a task on `date` writes. A dated task moves by the days
 * between where it was held (`grabbedDate`, else its due date) and the drop.
 * An unscheduled task gets `date` as its due date; a start date it already
 * has that would fall after it is cleared, so the update is valid.
 */
export function dropTaskOnDate(
  item: Pick<PlanningWorkItem, 'startDate' | 'targetDate'>,
  date: string,
  grabbedDate: string | null = null
): TaskDatePatch | null {
  if (item.targetDate && isIsoDate(item.targetDate)) {
    const days = isoDaysBetween(grabbedDate ?? item.targetDate, date)
    return days === 0 ? null : shiftTaskDates(item, days)
  }
  if (item.startDate && compareIsoDates(item.startDate, date) > 0)
    return { targetDate: date, startDate: null }
  return { targetDate: date }
}
