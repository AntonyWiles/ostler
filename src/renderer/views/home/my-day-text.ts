import type { MyDayTask } from '@shared/ostler-api'
import { formatIsoDate, isoDaysBetween } from '@shared/dates'
import { formatNumber } from '@shared/format'
import { t } from '@shared/i18n'

/** A task's estimate in its project's unit: "2 h", "3 pts", or null when it has none. */
export function estimateText(task: Pick<MyDayTask, 'estimate' | 'estimateUnit'>): string | null {
  if (task.estimate === null) return null
  return t(
    task.estimateUnit === 'hours' ? 'views:myDay.estimateHours' : 'views:myDay.estimatePoints',
    { count: task.estimate, formatted: formatNumber(task.estimate) }
  )
}

/** The day a list was made, by name: "Tuesday" within the last week, otherwise "14 October". */
export function listDayName(date: string, today: string): string {
  return isoDaysBetween(date, today) < 7
    ? formatIsoDate(date, { weekday: 'long' })
    : formatIsoDate(date, { day: 'numeric', month: 'long' })
}

/** Hours to one decimal place, in the person's number format. */
export function hoursText(hours: number): string {
  return formatNumber(Math.round(hours * 10) / 10, { maximumFractionDigits: 1 })
}
