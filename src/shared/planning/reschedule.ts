import type {
  EstimateUnit,
  PlanningDependencyType,
  PlanningPriority,
  PlanningWorkItem
} from '../ostler-api'
import { DEFAULT_WORKING_DAYS } from '../ostler-api'
import { compareIsoDates, isIsoDate, isoDaysBetween, shiftIsoDate } from '../dates'
import { shiftTaskDates } from './calendar'
import { dependencyConflicts } from './timeline'
import { workingDaysAfter, type DayOffSpan } from './working-days'

/**
 * Reschedule overdue work (N1.3, decision N11): the new dates for a pile of
 * tasks, worked out without saving anything. Pure and on `YYYY-MM-DD` strings
 * only, so the app's preview, its apply and the automation API give the same
 * plan, and a pile of 200 tasks plans in one pass.
 */

export const RESCHEDULE_MODES = ['today', 'tomorrow', 'date', 'spread'] as const
export type RescheduleMode = (typeof RESCHEDULE_MODES)[number]

/** How many working days spreading covers by default, and at most. */
export const DEFAULT_SPREAD_DAYS = 5
export const MAX_SPREAD_DAYS = 30
/** Without a capacity, a day takes this many tasks. */
export const TASKS_PER_DAY_WITHOUT_CAPACITY = 3
/** A task with no hour estimate (or in a points project) counts as this many hours. */
export const HOURS_WITHOUT_ESTIMATE = 1

export interface RescheduleOptions {
  mode: RescheduleMode
  /** The day for `date`, `YYYY-MM-DD`. */
  date?: string
  /** Working days to spread over, from tomorrow; `DEFAULT_SPREAD_DAYS` when left out. */
  days?: number
}

/** A task the plan may move. */
export type RescheduleTask = Pick<
  PlanningWorkItem,
  | 'id'
  | 'projectId'
  | 'title'
  | 'priority'
  | 'targetDate'
  | 'startDate'
  | 'estimate'
  | 'dependencyIds'
  | 'dependencyLinks'
  | 'createdAt'
> & { estimateUnit: EstimateUnit; recurring: boolean }

/** Another task the plan reads but never moves. */
export type RescheduleRelatedTask = Pick<
  PlanningWorkItem,
  'id' | 'title' | 'targetDate' | 'startDate' | 'dependencyIds' | 'dependencyLinks'
>

/** Open work already due on a day, which counts against that day when spreading. */
export interface RescheduleDueWork {
  targetDate: string
  estimate: number | null
  estimateUnit: EstimateUnit
}

export interface RescheduleContext {
  /** The person's local date, `YYYY-MM-DD`. */
  today: string
  /** Hours a week the person plans to work (Workload, R3.2), or null when not set. */
  weeklyCapacityHours: number | null
  /** Their working days as ISO weekdays, 1 Monday to 7 Sunday; Monday to Friday when left out. */
  workingDays?: readonly number[]
  /** Whose tasks they are (null for nobody): their leave is skipped when spreading. */
  personId?: string | null
  /** Days off (N3.2): everyone's and the person's are skipped when spreading. */
  daysOff?: readonly DayOffSpan[]
  /** The person's other open work, by due date (the tasks being moved are left out). */
  dueWork?: readonly RescheduleDueWork[]
  /** Tasks the moved ones wait on, and tasks that wait on them, as they are now. */
  related?: readonly RescheduleRelatedTask[]
}

/** A task that would start before something it waits on is due. */
export interface RescheduleWarning {
  /** The task that starts too early. */
  taskId: string
  taskTitle: string
  /** What it waits on. */
  dependencyId: string
  dependencyTitle: string
  start: string
  dependencyDue: string
  /** The link's type and lag (N7.2a). */
  type?: PlanningDependencyType
  lagDays?: number
}

/** One task's move. */
export interface RescheduleEntry {
  id: string
  projectId: string
  title: string
  fromDue: string
  toDue: string
  fromStart: string | null
  toStart: string | null
  /** It repeats: this occurrence moves, the rule does not change. */
  recurring: boolean
  /** Waits that this plan puts out of order and that involve this task. */
  warnings: RescheduleWarning[]
}

export interface ReschedulePlan {
  mode: RescheduleMode
  /** The days spreading used, in order (empty for the other modes). */
  days: string[]
  entries: RescheduleEntry[]
}

const PRIORITY_RANK: Record<PlanningPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
}

/**
 * The next `count` working days after `today`, by the one rule
 * (`working-days.ts`): the person's working days, without everyone's days
 * off and the person's own.
 */
export function nextWorkingDays(
  today: string,
  count: number,
  workingDays: readonly number[] = DEFAULT_WORKING_DAYS,
  daysOff: readonly DayOffSpan[] = [],
  personId: string | null = null
): string[] {
  return workingDaysAfter(today, count, personId, { workingDays, daysOff })
}

/** What a task weighs on a day: its hours, or one hour when it has no hour estimate. */
function hoursOf(work: { estimate: number | null; estimateUnit: EstimateUnit }): number {
  return work.estimateUnit === 'hours' && work.estimate !== null && work.estimate >= 0
    ? work.estimate
    : HOURS_WITHOUT_ESTIMATE
}

/** The person's daily hours, or null when Workload does not know their capacity. */
export function dailyCapacityHours(
  weeklyCapacityHours: number | null,
  workingDays: readonly number[] = DEFAULT_WORKING_DAYS
): number | null {
  if (weeklyCapacityHours === null || !(weeklyCapacityHours > 0)) return null
  return weeklyCapacityHours / Math.max(1, workingDays.length || DEFAULT_WORKING_DAYS.length)
}

/** Each task's new due date for the spread mode. */
function spreadDueDates(
  tasks: readonly RescheduleTask[],
  days: readonly string[],
  context: RescheduleContext
): Map<string, string> {
  const daily = dailyCapacityHours(context.weeklyCapacityHours, context.workingDays)
  const limit = daily ?? TASKS_PER_DAY_WITHOUT_CAPACITY
  const weigh = (work: { estimate: number | null; estimateUnit: EstimateUnit }) =>
    daily === null ? 1 : hoursOf(work)
  const load = new Map(days.map((day) => [day, 0]))
  for (const work of context.dueWork ?? []) {
    const current = load.get(work.targetDate)
    if (current !== undefined) load.set(work.targetDate, current + weigh(work))
  }
  const ordered = [...tasks].sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      compareIsoDates(a.targetDate ?? '', b.targetDate ?? '') ||
      a.createdAt - b.createdAt ||
      a.id.localeCompare(b.id)
  )
  const last = days[days.length - 1]
  const result = new Map<string, string>()
  for (const task of ordered) {
    const weight = weigh(task)
    // A tiny tolerance, so 8 h in quarter hours still fills an 8 h day.
    const day = days.find((candidate) => load.get(candidate)! + weight <= limit + 1e-9) ?? last
    load.set(day, load.get(day)! + weight)
    result.set(task.id, day)
  }
  return result
}

/**
 * The plan: for each task, its old and new dates. Today, Tomorrow and On a
 * date put every due date on that day. Spreading fills the next working days
 * (from tomorrow) highest priority first, then the oldest due date, each day
 * up to the person's daily hours (weekly capacity over their working days),
 * counting the work already due that day; without a capacity a day takes
 * three tasks, and what does not fit goes on the last day. A start date moves
 * with its due date, keeping the gap (`shiftTaskDates`). Tasks without a due
 * date, and tasks the plan would not move, are left out.
 */
export function planReschedule(
  tasks: readonly RescheduleTask[],
  options: RescheduleOptions,
  context: RescheduleContext
): ReschedulePlan {
  const { today } = context
  if (!isIsoDate(today)) throw new Error('today must use YYYY-MM-DD')
  const dated = tasks.filter((task) => task.targetDate && isIsoDate(task.targetDate))
  let days: string[] = []
  let dueFor: (task: RescheduleTask) => string
  if (options.mode === 'spread') {
    const count = options.days ?? DEFAULT_SPREAD_DAYS
    if (!Number.isInteger(count) || count < 1 || count > MAX_SPREAD_DAYS)
      throw new Error(`Spread over 1 to ${MAX_SPREAD_DAYS} working days`)
    days = nextWorkingDays(
      today,
      count,
      context.workingDays,
      context.daysOff,
      context.personId ?? null
    )
    const spread = spreadDueDates(dated, days, context)
    dueFor = (task) => spread.get(task.id)!
  } else {
    let day: string
    if (options.mode === 'today') day = today
    else if (options.mode === 'tomorrow') day = shiftIsoDate(today, 1)
    else if (options.mode === 'date') {
      if (!options.date || !isIsoDate(options.date)) throw new Error('Choose a date (YYYY-MM-DD)')
      day = options.date
    } else throw new Error('Choose how to reschedule: today, tomorrow, date or spread')
    dueFor = () => day
  }

  const entries: RescheduleEntry[] = []
  for (const task of dated) {
    const toDue = dueFor(task)
    if (toDue === task.targetDate) continue
    const patch = shiftTaskDates(task, isoDaysBetween(task.targetDate!, toDue))!
    entries.push({
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      fromDue: task.targetDate!,
      toDue: patch.targetDate,
      fromStart: task.startDate ?? null,
      toStart: patch.startDate === undefined ? (task.startDate ?? null) : patch.startDate,
      recurring: task.recurring,
      warnings: []
    })
  }
  attachWarnings(entries, tasks, context.related ?? [])
  return { mode: options.mode, days, entries }
}

/**
 * The waits a plan puts out of order (`dependencyConflicts`, the Timeline's
 * rule): a moved task now starting before something it waits on is due, or a
 * task waiting on a moved one now starting before it. Waits already out of
 * order before the plan are not repeated. Nothing else is moved (N7.1 does that).
 */
function attachWarnings(
  entries: RescheduleEntry[],
  tasks: readonly RescheduleTask[],
  related: readonly RescheduleRelatedTask[]
): void {
  if (entries.length === 0) return
  const before = new Map<string, RescheduleRelatedTask>()
  for (const task of related) before.set(task.id, task)
  for (const task of tasks) before.set(task.id, task)
  const moved = new Map(entries.map((entry) => [entry.id, entry]))
  const after = [...before.values()].map((task) => {
    const entry = moved.get(task.id)
    return entry ? { ...task, targetDate: entry.toDue, startDate: entry.toStart } : task
  })
  const key = (conflict: { taskId: string; dependencyId: string }) =>
    `${conflict.taskId}>${conflict.dependencyId}`
  const existing = new Set(dependencyConflicts([...before.values()]).map(key))
  for (const conflict of dependencyConflicts(after)) {
    if (existing.has(key(conflict))) continue
    const warning: RescheduleWarning = {
      ...conflict,
      taskTitle: before.get(conflict.taskId)?.title ?? '',
      dependencyTitle: before.get(conflict.dependencyId)?.title ?? ''
    }
    moved.get(conflict.taskId)?.warnings.push(warning)
    if (conflict.dependencyId !== conflict.taskId)
      moved.get(conflict.dependencyId)?.warnings.push(warning)
  }
}

/**
 * One task's dates as the apply call takes them: from what the preview saw,
 * to the new ones. A due date may be null for bulk edit's Clear due date
 * (N7.1); a reschedule plan always has both.
 */
export interface RescheduleChange {
  id: string
  fromDue: string | null
  toDue: string | null
  fromStart: string | null
  toStart: string | null
}

/** What applying a plan did. */
export interface RescheduleResult {
  /** The tasks that moved, with their dates; undo sends `undoChanges(changed)`. */
  changed: RescheduleChange[]
  /** Tasks left as they were, and why. */
  skipped: { id: string; title: string; reason: 'changed' | 'missing' }[]
}

/** The changes a plan applies. */
export function planChanges(entries: readonly RescheduleEntry[]): RescheduleChange[] {
  return entries.map(({ id, fromDue, toDue, fromStart, toStart }) => ({
    id,
    fromDue,
    toDue,
    fromStart,
    toStart
  }))
}

/** The changes that put applied ones back. */
export function undoChanges(changes: readonly RescheduleChange[]): RescheduleChange[] {
  return changes.map(({ id, fromDue, toDue, fromStart, toStart }) => ({
    id,
    fromDue: toDue,
    toDue: fromDue,
    fromStart: toStart,
    toStart: fromStart
  }))
}
