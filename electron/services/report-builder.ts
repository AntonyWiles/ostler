import type {
  BurnUpPoint,
  CumulativeFlowPoint,
  CycleTimeBucket,
  EstimateUnit,
  MilestoneBurnUp,
  MilestoneForecast,
  MilestoneRisk,
  PlanningMilestone,
  PlanningStatusTransition,
  PlanningWorkItem,
  PlanningWorkItemStatus,
  ProjectReport,
  ReportAtRisk,
  ReportKeyNumbers,
  ReportRange,
  ReportTaskRef,
  ThroughputWeek,
  WorkloadRow,
  IterationBurndownPoint,
  IterationBurndownReport,
  PlanningIteration,
  PlanningTaskType,
  ReportTypeSeries
} from '@shared/ostler-api'
import { TASK_STATUSES } from '@shared/task-labels'
import { formatList, formatNumber } from '@shared/format'
import { t } from '@shared/i18n'
import { formatIsoDate, isoDaysBetween, parseIsoDate, shiftIsoDate, toIsoDate } from '@shared/dates'
import { dependencyConflicts } from '@shared/planning/timeline'
import { throughputWeekStart } from '@shared/planning/stats'
import { lastEntryInto, metricsForItem, percentile } from './planning-metrics'
import { entrySeconds } from '@shared/time/timesheet'
import { iterationBurndown } from '@shared/planning/iterations'

/*
 * The project dashboard's numbers (P6.2), from the same per-task metrics the
 * rest of Ostler uses (planning-metrics.ts). Pure: the caller passes the
 * project's kept tasks (live and archived, never the recycle bin) with the
 * statuses the app shows, their status history and the clock, so the
 * Overview and `GET /reports` get the same answer from the same input.
 *
 * Truth over tidiness: days before a task existed are not plotted as zeros,
 * missing estimates switch the burn-up to counts and say so, and a forecast
 * without enough history says that instead of an infinite date.
 */

const DAY = 86_400_000
const BLOCKED_TOO_LONG_MS = 3 * DAY
const FORECAST_WEEKS = 4
/** A forecast needs at least this much project history. */
const FORECAST_MIN_HISTORY_MS = 14 * DAY
/** A milestone's life is drawn over at most this many days. */
const MAX_RANGE_DAYS = 730
/** Split by type (N2.7b): past this many series, the smallest share one, "Other". */
const MAX_TYPE_SERIES = 6

const CYCLE_BUCKETS: ReadonlyArray<Pick<CycleTimeBucket, 'minDays' | 'maxDays'>> = [
  { minDays: 0, maxDays: 0 },
  { minDays: 1, maxDays: 2 },
  { minDays: 3, maxDays: 5 },
  { minDays: 6, maxDays: 10 },
  { minDays: 11, maxDays: 20 },
  { minDays: 21, maxDays: null }
]

/** A cycle-time bucket's label: "Under a day", "3–5 days", "Over 20 days". */
function bucketLabel(bucket: Pick<CycleTimeBucket, 'minDays' | 'maxDays'>): string {
  if (bucket.maxDays === 0) return t('views:report.bucket.underDay')
  if (bucket.maxDays === null) return t('views:report.bucket.over', { days: bucket.minDays - 1 })
  return t('views:report.bucket.range', { from: bucket.minDays, to: bucket.maxDays })
}

export interface ReportInput {
  projectId: string
  range: ReportRange
  /** Live and archived tasks, each with the status the app shows. */
  items: PlanningWorkItem[]
  history: PlanningStatusTransition[]
  milestones: PlanningMilestone[]
  people: ReadonlyArray<{ id: string; name: string }>
  estimateUnit: EstimateUnit
  now: number
  /** The project's time entries (R2.3), for the time logged in range. */
  timeEntries?: ReadonlyArray<{ startedAt: number; durationSeconds: number | null }>
  /** The project's iterations (R6.1), for the active one's burn-down. */
  iterations?: readonly PlanningIteration[]
  /** When each task last joined the active iteration, from its change history. */
  iterationJoinedAt?: ReadonlyMap<string, number>
  /** The project's task types (N2.7a), in its order: with any, throughput and cycle time split by type. */
  taskTypes?: ReadonlyArray<Pick<PlanningTaskType, 'id' | 'name' | 'icon' | 'color'>>
}

/** `YYYY-MM-DD` in local time, as every date in Ostler is. */
export function localIsoDate(ms: number): string {
  return toIsoDate(new Date(ms))
}

/** Local midnight at the start of a calendar date. */
const parseLocal = (iso: string): Date => parseIsoDate(iso)!
const addLocalDays = shiftIsoDate
const daysBetween = isoDaysBetween

/** A duration in plain words: "under a day", "1 day", "4 days". */
function durationWords(ms: number): string {
  const days = Math.round(ms / DAY)
  return days < 1 ? t('views:report.underADay') : t('common:count.day', { count: days })
}

/** An amount of a burn-up's unit: "12 tasks", "3.5 hours", "1 point". */
function amount(value: number, word: BurnUpWord): string {
  return t(`views:report.amount.${word}`, { count: value, value: formatNumber(value) })
}

const roundOne = (value: number) => Math.round(value * 10) / 10

/** Reads a range, or throws with a message a reader can act on. */
export function parseReportRange(value: unknown): ReportRange {
  if (value === undefined || value === null || value === '') return '30d'
  if (value === '30d' || value === '90d') return value
  if (typeof value === 'string' && value.startsWith('milestone:') && value.length > 10)
    return value as ReportRange
  throw new Error('Range must be 30d, 90d or milestone:<milestoneId>')
}

interface Window {
  from: string
  to: string
  label: string
  /**
   * Which sentences describe this window: 'days' ("in the last 30 days", with
   * `days`) or 'milestone' ("since the milestone started"), as the i18next
   * context of each summary key.
   */
  context: 'days' | 'milestone'
  days: number
  milestone: PlanningMilestone | null
}

/** The burn-up's unit, singular. */
type BurnUpWord = 'task' | 'hour' | 'point'

function resolveWindow(input: ReportInput, today: string): Window {
  if (input.range === '30d' || input.range === '90d') {
    const days = input.range === '30d' ? 30 : 90
    return {
      from: addLocalDays(today, -(days - 1)),
      to: today,
      label: t('views:report.lastDays', { days }),
      context: 'days',
      days,
      milestone: null
    }
  }
  const milestoneId = input.range.slice('milestone:'.length)
  const milestone = input.milestones.find((candidate) => candidate.id === milestoneId)
  if (!milestone) throw new Error(t('views:report.milestoneNotInProject'))
  const starts = [
    milestone.createdAt,
    ...input.items.filter((item) => item.milestoneId === milestoneId).map((item) => item.createdAt)
  ]
  let from = localIsoDate(Math.min(...starts))
  if (daysBetween(from, today) >= MAX_RANGE_DAYS) from = addLocalDays(today, -(MAX_RANGE_DAYS - 1))
  if (from > today) from = today
  return {
    from,
    to: today,
    label: t('views:report.milestoneLabel', { name: milestone.name }),
    context: 'milestone',
    days: 0,
    milestone
  }
}

const STATUS_INDEX = new Map(TASK_STATUSES.map((status, index) => [status, index]))
const NOT_YET = -1

/**
 * Each task's status index at the end of each day (-1 before it existed).
 * One pass per task over its sorted history, so 90 days of 5,000 tasks stays
 * well inside the 200 ms budget. The last day, today, is the status the app
 * shows now.
 */
function statusesByDay(
  items: PlanningWorkItem[],
  historyByItem: Map<string, PlanningStatusTransition[]>,
  dayEnds: number[],
  now: number
): Int8Array[] {
  return items.map((item) => {
    const statuses = new Int8Array(dayEnds.length).fill(NOT_YET)
    const events = historyByItem.get(item.id) ?? []
    const initial = events.length > 0 ? (events[0].from ?? events[0].to) : item.status
    let pointer = 0
    let current: PlanningWorkItemStatus = initial
    for (let day = 0; day < dayEnds.length; day += 1) {
      const end = dayEnds[day]
      if (end <= item.createdAt) continue
      if (end > now) {
        statuses[day] = STATUS_INDEX.get(item.status) ?? NOT_YET
        continue
      }
      while (pointer < events.length && events[pointer].at < end) {
        current = events[pointer].to
        pointer += 1
      }
      statuses[day] = STATUS_INDEX.get(current) ?? NOT_YET
    }
    return statuses
  })
}

const DONE_INDEX = STATUS_INDEX.get('done')!

function taskRef(item: PlanningWorkItem): ReportTaskRef {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    targetDate: item.targetDate,
    assigneeId: item.assigneeId
  }
}

/**
 * Each task's status history, oldest first, and its metrics (completion,
 * cycle time): how every report counts a task, so Compare rounds (N5.7b)
 * counts the same way.
 */
export function reportItemMetrics(
  items: readonly PlanningWorkItem[],
  history: readonly PlanningStatusTransition[],
  now: number
): {
  historyByItem: Map<string, PlanningStatusTransition[]>
  metrics: Map<string, ReturnType<typeof metricsForItem>>
} {
  const historyByItem = new Map<string, PlanningStatusTransition[]>()
  for (const event of history) {
    const list = historyByItem.get(event.workItemId)
    if (list) list.push(event)
    else historyByItem.set(event.workItemId, [event])
  }
  for (const list of historyByItem.values()) list.sort((a, b) => a.at - b.at)
  const metrics = new Map(
    items.map((item) => [item.id, metricsForItem(item, historyByItem.get(item.id) ?? [], now)])
  )
  return { historyByItem, metrics }
}

/** Builds one project's report for one range. */
export function buildProjectReport(input: ReportInput): ProjectReport {
  const { now } = input
  const today = localIsoDate(now)
  const window = resolveWindow(input, today)
  const items = window.milestone
    ? input.items.filter((item) => item.milestoneId === window.milestone!.id)
    : input.items
  const live = items.filter((item) => !item.archivedAt)
  const open = live.filter((item) => item.status !== 'done')

  const { historyByItem, metrics } = reportItemMetrics(items, input.history, now)
  const windowStart = parseLocal(window.from).getTime()
  const finishedInRange = items.filter((item) => {
    const completedAt = metrics.get(item.id)?.completedAt ?? null
    return completedAt !== null && completedAt >= windowStart && completedAt <= now
  })

  // Days: from the window's start, or the first task's day if later, to today.
  const firstCreated = items.length ? Math.min(...items.map((item) => item.createdAt)) : null
  const firstDay =
    firstCreated === null
      ? today
      : localIsoDate(Math.max(windowStart, firstCreated)) > today
        ? today
        : localIsoDate(Math.max(windowStart, firstCreated))
  const dates: string[] = []
  for (let date = firstDay; date <= today; date = addLocalDays(date, 1)) dates.push(date)
  const dayEnds = dates.map((date) => parseLocal(addLocalDays(date, 1)).getTime())
  const byDay = statusesByDay(items, historyByItem, dayEnds, now)
  const dayIndexOf = new Map(items.map((item, index) => [item.id, index]))

  const keyNumbers = buildKeyNumbers(open, finishedInRange, metrics, today)
  if (input.timeEntries && input.timeEntries.length > 0)
    keyNumbers.timeLoggedSeconds = input.timeEntries
      .filter((entry) => entry.startedAt >= windowStart && entry.startedAt <= now)
      .reduce((sum, entry) => sum + entrySeconds(entry, now), 0)
  const cumulativeFlow = buildCumulativeFlow(items, byDay, dates, window, firstCreated)
  const burnUp = buildBurnUps(input, window, items, byDay, dayIndexOf, dates, input.estimateUnit)
  const throughput = buildThroughput(items, metrics, window, windowStart, firstCreated, now)
  const cycleTime = buildCycleTime(finishedInRange, metrics, window)
  if (input.taskTypes && input.taskTypes.length > 0) {
    // Split by type (N2.7b): the same builders over each series' tasks, so the parts sum to the whole.
    const split = typeSeries(finishedInRange, input.taskTypes)
    throughput.byType = split.map(({ series, keys }) => {
      const part = buildThroughput(
        items.filter((item) => keys.has(typeKey(item, input.taskTypes!))),
        metrics,
        window,
        windowStart,
        firstCreated,
        now
      )
      return {
        series,
        weeks: part.weeks,
        total: part.weeks.reduce((sum, week) => sum + week.count, 0),
        summary: t('views:report.byType.summary', { name: series.name, summary: part.summary })
      }
    })
    cycleTime.byType = split.map(({ series, keys }) => {
      const part = buildCycleTime(
        finishedInRange.filter((item) => keys.has(typeKey(item, input.taskTypes!))),
        metrics,
        window
      )
      return {
        series,
        buckets: part.buckets,
        sampleSize: part.sampleSize,
        summary: t('views:report.byType.summary', { name: series.name, summary: part.summary })
      }
    })
  }
  const workload = buildWorkload(open, input.people, today)
  const atRisk = buildAtRisk(input, live, open, items, metrics, historyByItem, today, now)

  return {
    projectId: input.projectId,
    range: input.range,
    rangeLabel: window.label,
    from: window.from,
    to: window.to,
    generatedAt: now,
    estimateUnit: input.estimateUnit,
    keyNumbers,
    burnUp,
    cumulativeFlow,
    throughput,
    cycleTime,
    workload,
    atRisk,
    iterationBurndown: buildIterationBurndown(input, today)
  }
}

/** The active iteration's burn-down (R6.1), from the status history, or null. */
function buildIterationBurndown(input: ReportInput, today: string): IterationBurndownReport | null {
  const iteration = input.iterations?.find((candidate) => candidate.status === 'active')
  if (!iteration) return null
  const series = iterationBurndown({
    iteration,
    tasks: input.items,
    transitions: input.history,
    joinedAt: input.iterationJoinedAt ?? new Map(),
    today
  })
  const word: BurnUpWord = input.estimateUnit === 'hours' ? 'hour' : 'point'
  const sentence = (
    read: (point: IterationBurndownPoint) => number | null,
    start: number,
    unit: BurnUpWord
  ): string => {
    const shown = series.days.filter((point) => read(point) !== null)
    const last = shown[shown.length - 1]
    if (!last) return t('views:report.burnDown.notStarted', { date: iteration.startDate })
    const remaining = read(last) ?? 0
    const ideal = unit === 'task' ? last.idealCount : last.idealEstimate
    const daysLeft = Math.max(0, isoDaysBetween(today, iteration.endDate))
    const values = {
      remaining: amount(remaining, unit),
      start: amount(start, unit),
      count: daysLeft
    }
    if (remaining === 0) return t('views:report.burnDown.allDone', values)
    if (remaining > ideal) return t('views:report.burnDown.behind', values)
    return t('views:report.burnDown.onTrack', values)
  }
  return {
    iterationId: iteration.id,
    name: iteration.name,
    startDate: iteration.startDate,
    endDate: iteration.endDate,
    goal: iteration.goal,
    points: series.days,
    defaultMeasure: series.allEstimated ? 'estimate' : 'count',
    summary: sentence((point) => point.remainingCount, series.startCount, 'task'),
    estimateSummary: series.allEstimated
      ? sentence((point) => point.remainingEstimate, series.startEstimate, word)
      : null
  }
}

function buildKeyNumbers(
  open: PlanningWorkItem[],
  finished: PlanningWorkItem[],
  metrics: Map<string, ReturnType<typeof metricsForItem>>,
  today: string
): ReportKeyNumbers {
  const weekAhead = addLocalDays(today, 7)
  const cycles = finished
    .map((item) => metrics.get(item.id)?.cycleTimeMs ?? null)
    .filter((value): value is number => value !== null)
  const leads = finished
    .map((item) => metrics.get(item.id)?.leadTimeMs ?? null)
    .filter((value): value is number => value !== null)
  return {
    open: open.length,
    doneInRange: finished.length,
    overdueNow: open.filter((item) => item.targetDate !== null && item.targetDate < today).length,
    dueNext7Days: open.filter(
      (item) => item.targetDate !== null && item.targetDate >= today && item.targetDate <= weekAhead
    ).length,
    cycleTimeMedianMs: percentile(cycles, 0.5),
    cycleTimeP85Ms: percentile(cycles, 0.85),
    cycleTimeSampleSize: cycles.length,
    leadTimeMedianMs: percentile(leads, 0.5),
    leadTimeSampleSize: leads.length
  }
}

function buildCumulativeFlow(
  items: PlanningWorkItem[],
  byDay: Int8Array[],
  dates: string[],
  window: Window,
  firstCreated: number | null
): ProjectReport['cumulativeFlow'] {
  if (items.length === 0 || firstCreated === null)
    return { points: [], summary: t('views:report.flow.noTasks') }
  const points: CumulativeFlowPoint[] = dates.map((date, day) => {
    const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<
      PlanningWorkItemStatus,
      number
    >
    for (const statuses of byDay) {
      const index = statuses[day]
      if (index !== NOT_YET) counts[TASK_STATUSES[index]] += 1
    }
    return { date, counts }
  })
  const inProgress = (point: CumulativeFlowPoint) =>
    point.counts.active + point.counts.blocked + point.counts.review
  const first = points[0]
  const last = points[points.length - 1]
  const lateStart = first.date > window.from
  let summary: string
  if (points.length < 2) {
    summary = t('views:report.flow.startsToday', {
      count: last.counts.done,
      inProgress: inProgress(last)
    })
  } else {
    const doneRise = last.counts.done - first.counts.done
    const wipNow = inProgress(last)
    const wipThen = inProgress(first)
    const values = {
      count: wipNow,
      then: wipThen,
      days: window.days,
      date: formatIsoDate(first.date),
      doneRise,
      context: lateStart ? 'firstTask' : window.context
    }
    summary =
      wipNow === wipThen ? t('views:report.flow.held', values) : t('views:report.flow.went', values)
  }
  return { points, summary }
}

function buildBurnUps(
  input: ReportInput,
  window: Window,
  items: PlanningWorkItem[],
  byDay: Int8Array[],
  dayIndexOf: Map<string, number>,
  dates: string[],
  unit: EstimateUnit
): MilestoneBurnUp[] {
  const milestones = window.milestone
    ? [window.milestone]
    : input.milestones.filter((milestone) => milestone.status !== 'archived')
  const result: MilestoneBurnUp[] = []
  for (const milestone of milestones) {
    const tasks = items.filter((item) => item.milestoneId === milestone.id)
    if (tasks.length === 0) continue
    const missingEstimates = tasks.filter((item) => item.estimate === null).length
    const estimated = missingEstimates === 0
    const firstTask = Math.min(...tasks.map((item) => item.createdAt))
    const points: BurnUpPoint[] = []
    dates.forEach((date, day) => {
      let scopeCount = 0
      let doneCount = 0
      let scopeEstimate = 0
      let doneEstimate = 0
      for (const task of tasks) {
        const status = byDay[dayIndexOf.get(task.id)!][day]
        if (status === NOT_YET) continue
        scopeCount += 1
        scopeEstimate += task.estimate ?? 0
        if (status === DONE_INDEX) {
          doneCount += 1
          doneEstimate += task.estimate ?? 0
        }
      }
      // Days before the milestone's first task are not zeros, they are nothing.
      if (scopeCount === 0 && localIsoDate(firstTask) > date) return
      points.push({
        date,
        scopeCount,
        doneCount,
        scopeEstimate: estimated ? scopeEstimate : null,
        doneEstimate: estimated ? doneEstimate : null
      })
    })
    const unitWord: BurnUpWord = unit === 'hours' ? 'hour' : 'point'
    result.push({
      milestoneId: milestone.id,
      name: milestone.name,
      targetDate: milestone.targetDate,
      missingEstimates,
      defaultMeasure: estimated ? 'estimate' : 'count',
      points,
      summary:
        burnUpSentence(points, window, (point) => [point.scopeCount, point.doneCount], 'task') +
        (missingEstimates > 0
          ? ` ${t('views:report.burnUp.shownInTasks', { count: missingEstimates })}`
          : ''),
      estimateSummary: estimated
        ? burnUpSentence(
            points,
            window,
            (point) => [point.scopeEstimate ?? 0, point.doneEstimate ?? 0],
            unitWord
          )
        : null
    })
  }
  return result.sort((a, b) =>
    (a.targetDate ?? '9999-12-31').localeCompare(b.targetDate ?? '9999-12-31')
  )
}

/** "Done is rising slower than scope: 12 tasks added in the last 30 days, 7 finished." */
function burnUpSentence(
  points: BurnUpPoint[],
  window: Window,
  read: (point: BurnUpPoint) => [scope: number, done: number],
  word: BurnUpWord
): string {
  if (points.length === 0) return t('views:report.burnUp.noTasks')
  const [firstScope, firstDone] = read(points[0])
  const [scope, done] = read(points[points.length - 1])
  const remaining = roundOne(scope - done)
  const added = roundOne(scope - firstScope)
  const finished = roundOne(done - firstDone)
  const values = {
    context: window.context,
    days: window.days,
    scope: amount(scope, word),
    added: amount(added, word),
    addedNumber: formatNumber(added),
    finished: formatNumber(finished),
    remaining: amount(remaining, word),
    remainingNumber: formatNumber(remaining)
  }
  if (scope === 0) return t(`views:report.burnUp.noUnits.${word}`)
  if (remaining === 0) return t('views:report.burnUp.allDone', values)
  if (added > finished) return t('views:report.burnUp.slower', values)
  if (finished > 0) return t('views:report.burnUp.keepingUp', values)
  return t('views:report.burnUp.nothingFinished', values)
}

function buildThroughput(
  items: PlanningWorkItem[],
  metrics: Map<string, ReturnType<typeof metricsForItem>>,
  window: Window,
  windowStart: number,
  firstCreated: number | null,
  now: number
): ProjectReport['throughput'] {
  const completions = items
    .map((item) => metrics.get(item.id)?.completedAt ?? null)
    .filter((value): value is number => value !== null)
  if (completions.length === 0 || firstCreated === null)
    return {
      weeks: [],
      summary: t('views:report.throughput.none')
    }
  // Weeks as the project metrics count them (Sunday, UTC), from the first
  // week anything existed in range. Weeks before that are not zeros.
  const counts = new Map<number, number>()
  for (const at of completions)
    if (at >= windowStart && at <= now) {
      const week = throughputWeekStart(at)
      counts.set(week, (counts.get(week) ?? 0) + 1)
    }
  const weeks: ThroughputWeek[] = []
  for (
    let week = throughputWeekStart(Math.max(windowStart, firstCreated));
    week <= throughputWeekStart(now);
    week += 7 * DAY
  )
    weeks.push({
      weekStart: new Date(week).toISOString().slice(0, 10),
      count: counts.get(week) ?? 0
    })
  const total = weeks.reduce((sum, week) => sum + week.count, 0)
  const summary =
    total === 0
      ? t('views:report.throughput.nothing', { context: window.context, days: window.days })
      : t('views:report.throughput.finished', {
          context: window.context,
          days: window.days,
          count: total,
          perWeek: formatNumber(roundOne(total / weeks.length))
        })
  return { weeks, summary }
}

const NO_TYPE = 'none'
const OTHER_TYPES = 'other'

/** A task's series key: its type's id, or "none" for no type or one that is gone. */
function typeKey(
  item: PlanningWorkItem,
  types: ReadonlyArray<Pick<PlanningTaskType, 'id'>>
): string {
  return item.typeId && types.some((type) => type.id === item.typeId) ? item.typeId : NO_TYPE
}

/**
 * The series a split by type draws: each type that finished something in
 * range, in the project's order, then "No type". Past six, the six that
 * finished most keep a series and the rest share "Other", drawn last.
 */
function typeSeries(
  finishedInRange: PlanningWorkItem[],
  types: ReadonlyArray<Pick<PlanningTaskType, 'id' | 'name' | 'icon' | 'color'>>
): Array<{ series: ReportTypeSeries; keys: Set<string> }> {
  const counts = new Map<string, number>()
  for (const item of finishedInRange) {
    const key = typeKey(item, types)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const candidates: ReportTypeSeries[] = [
    ...types
      .filter((type) => counts.has(type.id))
      .map((type) => ({
        key: type.id,
        name: type.name,
        icon: type.icon,
        color: type.color,
        typeIds: [type.id]
      })),
    ...(counts.has(NO_TYPE)
      ? [
          {
            key: NO_TYPE,
            name: t('views:report.byType.noType'),
            icon: null,
            color: null,
            typeIds: []
          }
        ]
      : [])
  ]
  if (candidates.length <= MAX_TYPE_SERIES)
    return candidates.map((series) => ({ series, keys: new Set([series.key]) }))
  const kept = new Set(
    [...candidates]
      .sort((a, b) => (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0))
      .slice(0, MAX_TYPE_SERIES)
      .map((series) => series.key)
  )
  const rest = candidates.filter((series) => !kept.has(series.key))
  return [
    ...candidates
      .filter((series) => kept.has(series.key))
      .map((series) => ({ series, keys: new Set([series.key]) })),
    {
      series: {
        key: OTHER_TYPES,
        name: t('views:report.byType.other'),
        icon: null,
        color: null,
        typeIds: rest.flatMap((series) => series.typeIds)
      },
      keys: new Set(rest.map((series) => series.key))
    }
  ]
}

function buildCycleTime(
  finished: PlanningWorkItem[],
  metrics: Map<string, ReturnType<typeof metricsForItem>>,
  window: Window
): ProjectReport['cycleTime'] {
  const cycles = finished
    .map((item) => metrics.get(item.id)?.cycleTimeMs ?? null)
    .filter((value): value is number => value !== null)
  const buckets: CycleTimeBucket[] = CYCLE_BUCKETS.map((bucket) => ({
    ...bucket,
    label: bucketLabel(bucket),
    count: 0
  }))
  for (const ms of cycles) {
    const days = Math.floor(ms / DAY)
    const bucket = buckets.find(
      (candidate) =>
        days >= candidate.minDays && (candidate.maxDays === null || days <= candidate.maxDays)
    )
    if (bucket) bucket.count += 1
  }
  const unstarted = finished.length - cycles.length
  if (cycles.length === 0)
    return {
      buckets,
      sampleSize: 0,
      summary:
        finished.length === 0
          ? t('views:report.cycle.noneFinished', { context: window.context, days: window.days })
          : t('views:report.cycle.noneStarted', {
              context: window.context,
              days: window.days,
              count: finished.length
            })
    }
  const median = percentile(cycles, 0.5)!
  const p85 = percentile(cycles, 0.85)!
  const skipped = unstarted > 0 ? ` ${t('views:report.cycle.skipped', { count: unstarted })}` : ''
  return {
    buckets,
    sampleSize: cycles.length,
    summary:
      (cycles.length === 1
        ? t('views:report.cycle.one', {
            context: window.context,
            days: window.days,
            duration: durationWords(median)
          })
        : t('views:report.cycle.half', {
            context: window.context,
            days: window.days,
            count: cycles.length,
            median: durationWords(median),
            p85: durationWords(p85)
          })) + skipped
  }
}

function buildWorkload(
  open: PlanningWorkItem[],
  people: ReportInput['people'],
  today: string
): ProjectReport['workload'] {
  const names = new Map(people.map((person) => [person.id, person.name]))
  const rows = new Map<string | null, WorkloadRow>()
  for (const item of open) {
    const key = item.assigneeId
    let row = rows.get(key)
    if (!row) {
      row = {
        personId: key,
        name:
          key === null
            ? t('views:report.workload.unassigned')
            : (names.get(key) ?? t('views:report.workload.unknownPerson')),
        openCount: 0,
        estimateSum: 0,
        unestimatedCount: 0,
        overdueCount: 0
      }
      rows.set(key, row)
    }
    row.openCount += 1
    if (item.estimate === null) row.unestimatedCount += 1
    else row.estimateSum = roundOne(row.estimateSum + item.estimate)
    if (item.targetDate !== null && item.targetDate < today) row.overdueCount += 1
  }
  const sorted = [...rows.values()].sort((a, b) =>
    a.personId === null
      ? 1
      : b.personId === null
        ? -1
        : b.openCount - a.openCount || a.name.localeCompare(b.name)
  )
  if (open.length === 0) return { rows: sorted, summary: t('views:report.workload.noOpenWork') }
  const unassigned = rows.get(null)?.openCount ?? 0
  const top = sorted.find((row) => row.personId !== null)
  if (!top)
    return {
      rows: sorted,
      summary:
        open.length === 1
          ? t('views:report.workload.oneUnassigned')
          : t('views:report.workload.allUnassigned', { count: open.length })
    }
  const nobody =
    unassigned > 0 ? ` ${t('views:report.workload.nobodyAssigned', { count: unassigned })}` : ''
  const mostValues = { name: top.name, count: top.openCount, overdue: top.overdueCount }
  return {
    rows: sorted,
    summary:
      (top.overdueCount > 0
        ? t('views:report.workload.mostWorkOverdue', mostValues)
        : t('views:report.workload.mostWork', mostValues)) + nobody
  }
}

/**
 * The recent pace: tasks finished in each of the last four 7-day stretches.
 * Too little project history, or nothing finished at all, is no pace.
 */
function recentWeeks(
  items: PlanningWorkItem[],
  metrics: Map<string, ReturnType<typeof metricsForItem>>,
  now: number
): number[] | string {
  const firstCreated = items.length ? Math.min(...items.map((item) => item.createdAt)) : now
  if (now - firstCreated < FORECAST_MIN_HISTORY_MS) return t('views:report.forecast.shortHistory')
  const weeks = new Array<number>(FORECAST_WEEKS).fill(0)
  for (const item of items) {
    const at = metrics.get(item.id)?.completedAt ?? null
    if (at === null || at > now) continue
    const index = Math.floor((now - at) / (7 * DAY))
    if (index < FORECAST_WEEKS) weeks[index] += 1
  }
  if (weeks.every((count) => count === 0)) return t('views:report.forecast.nothingFinished')
  return weeks
}

/** When `remaining` tasks would be done at the recent pace, as a range. */
export function forecastFinish(remaining: number, weeks: number[] | string): MilestoneForecast {
  if (typeof weeks === 'string') return { kind: 'not-enough-history', reason: weeks }
  const fastest = Math.max(...weeks)
  const slowest = Math.min(...weeks)
  const weeklyRate = weeks.reduce((sum, count) => sum + count, 0) / weeks.length
  if (fastest === 0)
    return {
      kind: 'not-enough-history',
      reason: t('views:report.forecast.nothingFinished')
    }
  return {
    kind: 'range',
    minDays: Math.ceil((remaining / fastest) * 7),
    maxDays: slowest > 0 ? Math.ceil((remaining / slowest) * 7) : null,
    weeklyRate: roundOne(weeklyRate)
  }
}

function forecastWords(forecast: Extract<MilestoneForecast, { kind: 'range' }>): string {
  return forecast.maxDays === null
    ? t('views:report.forecast.atLeast', { count: forecast.minDays })
    : forecast.maxDays === forecast.minDays
      ? t('views:report.forecast.about', { count: forecast.minDays })
      : t('views:report.forecast.range', { from: forecast.minDays, to: forecast.maxDays })
}

function buildAtRisk(
  input: ReportInput,
  live: PlanningWorkItem[],
  open: PlanningWorkItem[],
  items: PlanningWorkItem[],
  metrics: Map<string, ReturnType<typeof metricsForItem>>,
  historyByItem: Map<string, PlanningStatusTransition[]>,
  today: string,
  now: number
): ReportAtRisk {
  const overdue = open
    .filter((item) => item.targetDate !== null && item.targetDate < today)
    .sort((a, b) => a.targetDate!.localeCompare(b.targetDate!))
    .map(taskRef)

  const blocked = open
    .filter((item) => item.status === 'blocked')
    .flatMap((item) => {
      const since = lastEntryInto(historyByItem.get(item.id) ?? [], 'blocked')
      return since !== null && now - since > BLOCKED_TOO_LONG_MS
        ? [{ ...taskRef(item), blockedSince: since }]
        : []
    })
    .sort((a, b) => a.blockedSince - b.blockedSince)

  const byId = new Map(live.map((item) => [item.id, item]))
  const conflicts = dependencyConflicts(live)
    .filter((conflict) => byId.get(conflict.taskId)?.status !== 'done')
    .map((conflict) => ({
      task: taskRef(byId.get(conflict.taskId)!),
      dependency: taskRef(byId.get(conflict.dependencyId)!),
      start: conflict.start,
      dependencyDue: conflict.dependencyDue,
      ...(conflict.type ? { type: conflict.type, lagDays: conflict.lagDays } : {})
    }))

  const pace = recentWeeks(items, metrics, now)
  const lateMilestones: MilestoneRisk[] = []
  const unforecastMilestones: ReportAtRisk['unforecastMilestones'] = []
  const milestoneIds = new Set(items.map((item) => item.milestoneId))
  for (const milestone of input.milestones) {
    if (milestone.status === 'complete' || milestone.status === 'archived') continue
    if (!milestone.targetDate || !milestoneIds.has(milestone.id)) continue
    const remaining = open.filter((item) => item.milestoneId === milestone.id).length
    if (remaining === 0) continue
    const daysLeft = daysBetween(today, milestone.targetDate)
    const forecast = forecastFinish(remaining, pace)
    const left = t('common:count.task', { count: remaining })
    if (daysLeft < 0) {
      lateMilestones.push({
        milestoneId: milestone.id,
        name: milestone.name,
        targetDate: milestone.targetDate,
        remaining,
        daysLeft,
        forecast,
        reason: t('views:report.risk.datePassed', { count: -daysLeft, left })
      })
      continue
    }
    if (forecast.kind === 'not-enough-history') {
      unforecastMilestones.push({
        milestoneId: milestone.id,
        name: milestone.name,
        reason: forecast.reason
      })
      continue
    }
    const expected = Math.ceil((remaining / forecast.weeklyRate) * 7)
    if (expected > daysLeft)
      lateMilestones.push({
        milestoneId: milestone.id,
        name: milestone.name,
        targetDate: milestone.targetDate,
        remaining,
        daysLeft,
        forecast,
        reason: t('views:report.risk.behindPace', {
          left,
          toGo: t('common:count.day', { count: daysLeft }),
          rate: formatNumber(forecast.weeklyRate),
          needs: t('common:count.day', { count: expected }),
          range: forecastWords(forecast)
        })
      })
  }

  const parts = [
    overdue.length && t('views:report.risk.overdueTasks', { count: overdue.length }),
    blocked.length && t('views:report.risk.blockedTasks', { count: blocked.length }),
    conflicts.length && t('views:report.risk.conflicts', { count: conflicts.length }),
    lateMilestones.length && t('views:report.risk.lateMilestones', { count: lateMilestones.length })
  ].filter((part): part is string => typeof part === 'string')
  const listed =
    parts.length === 0
      ? t('views:report.risk.nothing')
      : t('views:report.risk.atRisk', { list: formatList(parts) })
  const unforecast = unforecastMilestones.length
    ? ` ${t('views:report.risk.unforecast', { count: unforecastMilestones.length })}`
    : ''
  return {
    overdue,
    blocked,
    conflicts,
    lateMilestones,
    unforecastMilestones,
    summary: listed + unforecast
  }
}
