import type { PlanningAggregateMetrics, PlanningWorkItem } from '../ostler-api'

const DAY = 86_400_000

/**
 * The start of the week `now` falls in, as `aggregateMetrics` buckets
 * throughput (planning-metrics.ts): Sunday, 00:00 UTC.
 */
export function throughputWeekStart(now: number): number {
  const date = new Date(now)
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return day - new Date(day).getUTCDay() * DAY
}

export interface OverviewStats {
  open: number
  doneThisWeek: number
  overdue: number
  /** Null until something has been finished. */
  averageCycleTimeMs: number | null
}

/**
 * The Overview's four numbers. "Done this week" reads the throughput bucket
 * the metrics already count, so it never disagrees with the reports.
 */
export function overviewStats(
  items: PlanningWorkItem[],
  metrics: PlanningAggregateMetrics | null,
  now: number,
  today: string
): OverviewStats {
  const open = items.filter((item) => item.status !== 'done')
  const weekStart = throughputWeekStart(now)
  return {
    open: open.length,
    doneThisWeek:
      metrics?.throughput.find((bucket) => bucket.periodStart === weekStart)?.count ?? 0,
    overdue: open.filter((item) => item.targetDate !== null && item.targetDate < today).length,
    averageCycleTimeMs: metrics?.averageCycleTimeMs ?? null
  }
}

/** A duration in days with its unit ("3 days", "1 day", "< 1 day"), or a dash. */
export function formatDays(milliseconds: number | null): string {
  if (milliseconds === null) return '—'
  const days = Math.round(milliseconds / DAY)
  if (days === 0) return '< 1 day'
  return `${days} ${days === 1 ? 'day' : 'days'}`
}
