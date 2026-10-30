import type {
  PlanningStatusTransition,
  PlanningWorkItem,
  PlanningWorkItemMetrics,
  PlanningAggregateMetrics,
  PlanningWorkItemStatus
} from '@shared/ostler-api'

// Cycle time begins when work first goes Active: someone (usually an agent)
// actually picked it up. It used to begin at Ready too, but creating an item
// records a transition into its starting status, and the automation API and
// "queue a task" create items straight into Ready -- so for all of those, cycle
// time came out identical to lead time and measured nothing. Ready is only the
// fallback for an item that reached Done without ever being Active (closed by
// hand). Blocked and Review are downstream states and never move the start.
const WORK_STARTED: PlanningWorkItemStatus = 'active'
const FALLBACK_START: PlanningWorkItemStatus = 'ready'
const DAY = 86_400_000

/**
 * Lead time is creation to Done; cycle time is first Active (else first Ready)
 * to Done. "Done" is the item's last move into Done, and only while it is
 * still there: a task that was finished and reopened is open work again, not a
 * completion (P6.2), and finishing it again counts once, when it last landed.
 */
export function metricsForItem(
  item: PlanningWorkItem,
  history: PlanningStatusTransition[],
  now: number
): PlanningWorkItemMetrics {
  const ordered = history
    .filter((event) => event.workItemId === item.id)
    .sort((a, b) => a.at - b.at)
  const last = ordered[ordered.length - 1]
  const completedAt = last?.to === 'done' ? lastEntryInto(ordered, 'done') : null
  const end = completedAt ?? now
  const firstActive = workStartedEvent(ordered)
  let blockedTimeMs = 0
  ordered.forEach((event, index) => {
    if (event.to === 'blocked')
      blockedTimeMs += Math.max(0, (ordered[index + 1]?.at ?? end) - event.at)
  })
  return {
    leadTimeMs: completedAt === null ? null : Math.max(0, completedAt - item.createdAt),
    cycleTimeMs:
      completedAt === null || !firstActive ? null : Math.max(0, completedAt - firstActive.at),
    queueAgeMs: completedAt === null ? Math.max(0, now - item.createdAt) : 0,
    blockedTimeMs,
    completedAt
  }
}

/**
 * The move that started the work, as cycle time counts it: the first into
 * Active, else the first into Ready. `ordered` is one item's history, oldest
 * first.
 */
export function workStartedEvent(
  ordered: readonly PlanningStatusTransition[]
): PlanningStatusTransition | undefined {
  return (
    ordered.find((event) => event.to === WORK_STARTED) ??
    ordered.find((event) => event.to === FALLBACK_START)
  )
}

/** Throughput counts items entering Done in weekly UTC buckets over the requested window. */
export function aggregateMetrics(
  items: PlanningWorkItem[],
  histories: PlanningStatusTransition[],
  now: number,
  windowDays = 30
): PlanningAggregateMetrics {
  // Grouped once (P9.1): filtering the whole history for every item was
  // quadratic, and a 5,000-task project spent seconds here.
  const byItem = historiesByWorkItem(histories)
  const values = items.map((item) => metricsForItem(item, byItem.get(item.id) ?? [], now))
  const completed = values.filter((value) => value.completedAt !== null)
  const average = (field: 'leadTimeMs' | 'cycleTimeMs') => {
    const numbers = completed
      .map((value) => value[field])
      .filter((value): value is number => value !== null)
    return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null
  }
  const cutoff = now - windowDays * DAY
  const buckets = new Map<number, number>()
  completed.forEach((value) => {
    if (value.completedAt === null || value.completedAt < cutoff) return
    const date = new Date(value.completedAt)
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    const periodStart = day.getTime() - day.getUTCDay() * DAY
    buckets.set(periodStart, (buckets.get(periodStart) ?? 0) + 1)
  })
  return {
    itemCount: items.length,
    completedCount: completed.length,
    averageLeadTimeMs: average('leadTimeMs'),
    averageCycleTimeMs: average('cycleTimeMs'),
    averageQueueAgeMs: values.length
      ? values.reduce((sum, value) => sum + value.queueAgeMs, 0) / values.length
      : 0,
    totalBlockedTimeMs: values.reduce((sum, value) => sum + value.blockedTimeMs, 0),
    throughput: [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([periodStart, count]) => ({ periodStart, count }))
  }
}

/** Each work item's status changes, in the order given. */
export function historiesByWorkItem(
  histories: readonly PlanningStatusTransition[]
): Map<string, PlanningStatusTransition[]> {
  const grouped = new Map<string, PlanningStatusTransition[]>()
  for (const event of histories) {
    const list = grouped.get(event.workItemId)
    if (list) list.push(event)
    else grouped.set(event.workItemId, [event])
  }
  return grouped
}

/** When the item last moved into `status`, or null if it never did. */
export function lastEntryInto(
  ordered: PlanningStatusTransition[],
  status: PlanningWorkItemStatus
): number | null {
  for (let index = ordered.length - 1; index >= 0; index -= 1)
    if (ordered[index].to === status) return ordered[index].at
  return null
}

/**
 * The value at or below which `p` (0 to 1) of the values fall, by the
 * nearest-rank rule: a value that actually occurred, never an interpolation.
 * Null for no values.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil(p * sorted.length))
  return sorted[Math.min(sorted.length, rank) - 1]
}
