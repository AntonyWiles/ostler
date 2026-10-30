import type { PlanningDependencyType, PlanningWorkItemStatus } from './planning-types'
import type { EstimateUnit } from './people-types'

// ─── Report Types (P6.2) ────────────────────────────────────────────────────

/**
 * Which stretch of time a report covers: the last 30 or 90 days, or one
 * milestone's life (from its creation, or its first task's, to today). A
 * milestone range also narrows every section to that milestone's tasks.
 */
export type ReportRange = '30d' | '90d' | `milestone:${string}`

/** A task a risk row names, enough to show it and open it. */
export interface ReportTaskRef {
  id: string
  title: string
  status: PlanningWorkItemStatus
  /** The due date, `YYYY-MM-DD`. */
  targetDate: string | null
  assigneeId: string | null
}

export interface ReportKeyNumbers {
  open: number
  doneInRange: number
  overdueNow: number
  dueNext7Days: number
  /** Null when nothing finished in range had a measurable cycle time. */
  cycleTimeMedianMs: number | null
  cycleTimeP85Ms: number | null
  /** How many finished tasks the cycle times are drawn from. */
  cycleTimeSampleSize: number
  leadTimeMedianMs: number | null
  leadTimeSampleSize: number
  /**
   * Seconds of time logged on entries that started in the range (R2.3), a
   * running timer counted up to now. Left out when the project has no time
   * entries at all.
   */
  timeLoggedSeconds?: number
}

export interface BurnUpPoint {
  /** `YYYY-MM-DD`, the end of that day. */
  date: string
  scopeCount: number
  doneCount: number
  /** Null unless every task in the milestone has an estimate. */
  scopeEstimate: number | null
  doneEstimate: number | null
}

export interface MilestoneBurnUp {
  milestoneId: string
  name: string
  targetDate: string | null
  /** The milestone's tasks without an estimate; estimates are drawn only at 0. */
  missingEstimates: number
  /** What the chart measures unless the reader switches: estimates when every task has one. */
  defaultMeasure: 'estimate' | 'count'
  points: BurnUpPoint[]
  /** The chart's point, in task counts. */
  summary: string
  /** The same in the project's estimate unit; null when estimates are incomplete. */
  estimateSummary: string | null
}

export interface CumulativeFlowPoint {
  date: string
  /** Tasks in each status at the end of the day. */
  counts: Record<PlanningWorkItemStatus, number>
}

export interface ThroughputWeek {
  /** The week's first day, `YYYY-MM-DD` (Sunday, as the project metrics count weeks). */
  weekStart: string
  count: number
}

export interface CycleTimeBucket {
  label: string
  /** Inclusive, in whole days. */
  minDays: number
  /** Inclusive; null for the open-ended last bucket. */
  maxDays: number | null
  count: number
}

/**
 * One series of a chart split by task type (N2.7b): a type, "No type", or
 * "Other" for the smallest types once there are more than six series.
 */
export interface ReportTypeSeries {
  /** A type's id, `none` for tasks with no type, or `other`. */
  key: string
  /** "Bug", "No type" or "Other". */
  name: string
  /** The type's icon name; null for "No type" and "Other". */
  icon: string | null
  /** The type's colour, `#rrggbb`; null for "No type" and "Other". */
  color: string | null
  /** The types this series counts: one, none for "No type", several for "Other". */
  typeIds: string[]
}

/** Throughput for one series: the same weeks as the whole chart, its tasks only. */
export interface ThroughputByType {
  series: ReportTypeSeries
  weeks: ThroughputWeek[]
  /** Tasks of this series finished in range: the sum of its weeks. */
  total: number
  /** "Bug: 4 tasks finished in the last 30 days, about 1 a week." */
  summary: string
}

/** Cycle time for one series: the same buckets as the whole chart, its tasks only. */
export interface CycleTimeByType {
  series: ReportTypeSeries
  buckets: CycleTimeBucket[]
  sampleSize: number
  summary: string
}

export interface WorkloadRow {
  /** Null for unassigned work. */
  personId: string | null
  name: string
  openCount: number
  /** The sum of the estimates that exist. */
  estimateSum: number
  /** Open tasks with no estimate, which `estimateSum` leaves out. */
  unestimatedCount: number
  overdueCount: number
}

/**
 * When a milestone's remaining tasks would be done at the recent pace, as a
 * range of days from today: the fastest and the slowest of the last four
 * weeks. `maxDays` is null when the slowest week finished nothing. Too little
 * history gives no forecast at all rather than an infinite one.
 */
export type MilestoneForecast =
  | { kind: 'range'; minDays: number; maxDays: number | null; weeklyRate: number }
  | { kind: 'not-enough-history'; reason: string }

export interface MilestoneRisk {
  milestoneId: string
  name: string
  targetDate: string
  remaining: number
  /** Days from today to the target date; negative once it has passed. */
  daysLeft: number
  forecast: MilestoneForecast
  /** Why it is listed, in words. */
  reason: string
}

export interface ReportAtRisk {
  overdue: ReportTaskRef[]
  /** Blocked for more than three days, longest first. */
  blocked: Array<ReportTaskRef & { blockedSince: number }>
  conflicts: Array<{
    task: ReportTaskRef
    dependency: ReportTaskRef
    start: string
    dependencyDue: string
    /** The link's type and lag (N7.2a): left out by older reports, finish to start, 0 days. */
    type?: PlanningDependencyType
    lagDays?: number
  }>
  /** Milestones the recent pace will not finish by their date, or already past it. */
  lateMilestones: MilestoneRisk[]
  /** Open, dated milestones that cannot be forecast yet. */
  unforecastMilestones: Array<{ milestoneId: string; name: string; reason: string }>
  summary: string
}

/** One project's dashboard: the same structure for the Overview and `GET /reports`. */
export interface ProjectReport {
  projectId: string
  range: ReportRange
  /** "Last 30 days", "Last 90 days" or "Milestone: <name>". */
  rangeLabel: string
  /** The first and last day covered, `YYYY-MM-DD`. */
  from: string
  to: string
  generatedAt: number
  estimateUnit: EstimateUnit
  keyNumbers: ReportKeyNumbers
  burnUp: MilestoneBurnUp[]
  cumulativeFlow: { points: CumulativeFlowPoint[]; summary: string }
  /**
   * `byType` (N2.7b) splits the chart by task type, its series summing to the
   * whole; present when the project has task types (the API adds it with
   * `splitBy=type`).
   */
  throughput: { weeks: ThroughputWeek[]; summary: string; byType?: ThroughputByType[] }
  cycleTime: {
    buckets: CycleTimeBucket[]
    sampleSize: number
    summary: string
    byType?: CycleTimeByType[]
  }
  workload: { rows: WorkloadRow[]; summary: string }
  atRisk: ReportAtRisk
  /**
   * The active iteration's burn-down (R6.1), whatever the range; absent when
   * no iteration is active.
   */
  iterationBurndown?: IterationBurndownReport | null
}

/** One day of an iteration's burn-down; the remaining values are null after today. */
export interface IterationBurndownPoint {
  date: string
  remainingCount: number | null
  remainingEstimate: number | null
  idealCount: number
  idealEstimate: number
}

/** The active iteration's remaining work per day against an ideal line (R6.1). */
export interface IterationBurndownReport {
  iterationId: string
  name: string
  startDate: string
  endDate: string
  goal: string
  points: IterationBurndownPoint[]
  /** `estimate` only when every task in the iteration has an estimate. */
  defaultMeasure: 'count' | 'estimate'
  /** In tasks. */
  summary: string
  /** In the project's estimate unit; null when a task has no estimate. */
  estimateSummary: string | null
}

/** One round of a series in Compare rounds (N5.7b), oldest first in `RoundComparison.rounds`. */
export interface RoundComparisonRound {
  milestoneId: string
  name: string
  /** The round's first day, `YYYY-MM-DD`, as Repeat this round reads it. */
  start: string
  targetDate: string | null
  /** The days the round was planned to last, both ends included; null without a target date. */
  plannedDays: number | null
  /** When its first task started (first Active, else first Ready), else its first finish. */
  firstStartedAt: number | null
  /** When its last task finished, once nothing is open; null until then. */
  lastFinishedAt: number | null
  /**
   * Local days from the first start to the last finish, both ends included;
   * to today while tasks are open; null while nothing has started.
   */
  tookDays: number | null
  /** True once every task is done or won't do, and at least one is done. */
  finished: boolean
  done: number
  wontDo: number
  open: number
  /** Time tracked on the round's tasks (R2.3), whole seconds. */
  timeTrackedSeconds: number
  /** The round's numbers in one sentence. */
  summary: string
}

/** One task in one round. */
export interface RoundComparisonCell {
  workItemId: string
  title: string
  outcome: 'done' | 'wont-do' | 'open'
  /** Cycle time as the reports count it; null unless done and started. */
  cycleTimeMs: number | null
  timeTrackedSeconds: number
}

/**
 * One task followed across rounds through each copy's source task, so a task
 * renamed between rounds is still one row. `cells` lines up with `rounds`:
 * null where the task is not in that round.
 */
export interface RoundComparisonRow {
  /** The task's title in the latest round it is in. */
  title: string
  cells: Array<RoundComparisonCell | null>
  /** The round (index into `rounds`) with the longest cycle time, when two or more rounds have one. */
  slowestCycleRound: number | null
  /** The round with the most time tracked, when two or more rounds have some. */
  slowestTimeRound: number | null
}

/** Compare rounds (N5.7b): a series' rounds side by side, as `GET /milestones/:id/rounds` returns it. */
export interface RoundComparison {
  projectId: string
  /** The series' name: its first round's. */
  seriesName: string
  /** Oldest first, the latest last. */
  rounds: RoundComparisonRound[]
  tasks: RoundComparisonRow[]
  /** True when any task of the series has time tracked. */
  hasTimeTracked: boolean
  generatedAt: number
  summary: string
}
