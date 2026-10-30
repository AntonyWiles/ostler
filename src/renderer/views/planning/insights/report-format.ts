import type { EstimateUnit, PlanningWorkItemStatus } from '@shared/ostler-api'
import { formatIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'

/** "8 Oct", from `YYYY-MM-DD`. */
export function shortDate(iso: string): string {
  return formatIsoDate(iso, { day: 'numeric', month: 'short' })
}

/** "points" or "hours". */
export const unitWord = (unit: EstimateUnit): string =>
  unit === 'hours' ? t('views:insightCharts.unit.hours') : t('views:insightCharts.unit.points')

/**
 * Cumulative flow, bottom first: Done on the axis so its growth reads as
 * the floor rising, then the statuses work passes through backwards. Each
 * status keeps one chart slot everywhere.
 */
export const FLOW_ORDER: ReadonlyArray<{ status: PlanningWorkItemStatus; color: number }> = [
  { status: 'done', color: 3 },
  { status: 'review', color: 2 },
  { status: 'blocked', color: 4 },
  { status: 'active', color: 5 },
  { status: 'ready', color: 1 },
  { status: 'backlog', color: 6 }
]
