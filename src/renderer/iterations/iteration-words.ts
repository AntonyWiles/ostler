import type { EstimateUnit, PlanningIteration, PlanningIterationStatus } from '@shared/ostler-api'
import { formatIsoDate, shiftIsoDate, todayIsoDate } from '@shared/dates'
import { sortIterations } from '@shared/planning/iterations'
import { formatNumber } from '@shared/format'
import { t } from '@shared/i18n'

/** "8 Oct – 21 Oct 2026": an iteration's days, both ends included. */
export function iterationDates(
  iteration: Pick<PlanningIteration, 'startDate' | 'endDate'>
): string {
  return t('tasks:iterations.dates', {
    start: formatIsoDate(iteration.startDate, { day: 'numeric', month: 'short' }),
    end: formatIsoDate(iteration.endDate, { day: 'numeric', month: 'short', year: 'numeric' })
  })
}

export function iterationStatusLabel(status: PlanningIterationStatus): string {
  return t(`tasks:iterations.status.${status}`)
}

/** "13 points" or "6.5 hours". */
export function estimateAmount(value: number, unit: EstimateUnit): string {
  return t(`tasks:iterations.amount.${unit === 'hours' ? 'hours' : 'points'}`, {
    count: value,
    value: formatNumber(value)
  })
}

/** What a new iteration starts as: the day after the last one, two weeks long. */
export function nextIterationDraft(iterations: readonly PlanningIteration[]): {
  name: string
  startDate: string
  endDate: string
} {
  const last = sortIterations(iterations).at(-1)
  const today = todayIsoDate()
  const startDate = last && last.endDate >= today ? shiftIsoDate(last.endDate, 1) : today
  return {
    name: t('tasks:iterations.defaultName', { number: iterations.length + 1 }),
    startDate,
    endDate: shiftIsoDate(startDate, 13)
  }
}
