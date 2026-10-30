import type { PlanningIteration, PlanningStatusTransition, PlanningWorkItem } from '../ostler-api'
import { isoDaysBetween, parseIsoDate, shiftIsoDate } from '../dates'

/**
 * Iterations (R6.1, D44): the rules every surface shares. The planning
 * service enforces them, the views and the automation API read them, so
 * "overlaps", "current" and "next" mean the same thing everywhere.
 *
 * Dates are local days written `YYYY-MM-DD`, compared as text, and an
 * iteration includes its end date.
 */

/** The filter value that means "the project's current iteration". */
export const ITERATION_CURRENT = 'current'

/** The longest iteration name and goal. */
export const MAX_ITERATION_NAME_LENGTH = 80
export const MAX_ITERATION_GOAL_LENGTH = 300

type Dated = Pick<PlanningIteration, 'id' | 'startDate' | 'endDate'>

/** Oldest first, by start date. */
export function sortIterations<T extends Dated>(iterations: readonly T[]): T[] {
  return [...iterations].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id)
  )
}

/** Whether two inclusive day ranges share a day. */
export function rangesOverlap(a: Omit<Dated, 'id'>, b: Omit<Dated, 'id'>): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate
}

/** The first of `iterations` (other than `candidate` itself) that shares a day with it. */
export function overlappingIteration<T extends Dated>(
  iterations: readonly T[],
  candidate: Omit<Dated, 'id'> & { id?: string }
): T | null {
  return (
    sortIterations(iterations).find(
      (iteration) => iteration.id !== candidate.id && rangesOverlap(iteration, candidate)
    ) ?? null
  )
}

/** Whether `today` is one of the iteration's days. */
export function iterationIncludes(iteration: Omit<Dated, 'id'>, today: string): boolean {
  return iteration.startDate <= today && today <= iteration.endDate
}

/**
 * The project's current iteration: the active one; with none active, the
 * unfinished one whose days include today (the end day too). Null when
 * there is neither.
 */
export function currentIteration<
  T extends Pick<PlanningIteration, 'id' | 'startDate' | 'endDate' | 'status'>
>(iterations: readonly T[], today: string): T | null {
  return (
    iterations.find((iteration) => iteration.status === 'active') ??
    sortIterations(iterations).find(
      (iteration) => iteration.status === 'planned' && iterationIncludes(iteration, today)
    ) ??
    null
  )
}

/** Where unfinished work goes on Finish: the earliest planned iteration after this one. */
export function nextIteration<
  T extends Pick<PlanningIteration, 'id' | 'startDate' | 'endDate' | 'status'>
>(iterations: readonly T[], after: Dated): T | null {
  return (
    sortIterations(iterations).find(
      (iteration) =>
        iteration.id !== after.id &&
        iteration.status === 'planned' &&
        iteration.startDate > after.endDate
    ) ?? null
  )
}

/** The iterations a task can be put in, in date order: every unfinished one. */
export function openIterations<
  T extends Pick<PlanningIteration, 'id' | 'startDate' | 'endDate' | 'status'>
>(iterations: readonly T[]): T[] {
  return sortIterations(iterations).filter((iteration) => iteration.status !== 'finished')
}

/** Days in an iteration, both ends included. */
export function iterationLength(iteration: Omit<Dated, 'id'>): number {
  return isoDaysBetween(iteration.startDate, iteration.endDate) + 1
}

// ─── Burn-down ──────────────────────────────────────────────────────────────

/** One day of an iteration's burn-down; the remaining values are null after today. */
export interface IterationBurndownDay {
  date: string
  remainingCount: number | null
  remainingEstimate: number | null
  idealCount: number
  idealEstimate: number
}

export interface IterationBurndownSeries {
  days: IterationBurndownDay[]
  /** Tasks and estimate in the iteration at the end of its first day: the ideal line's start. */
  startCount: number
  startEstimate: number
  /** Every task in it has an estimate, so the chart can count in estimates. */
  allEstimated: boolean
}

export interface IterationBurndownInput {
  iteration: Pick<PlanningIteration, 'id' | 'startDate' | 'endDate'>
  /** The project's kept tasks; those in the iteration are picked out here. */
  tasks: ReadonlyArray<Pick<PlanningWorkItem, 'id' | 'estimate' | 'createdAt' | 'iterationId'>>
  /** The project's status history, oldest first: the one history (no second one). */
  transitions: readonly PlanningStatusTransition[]
  /**
   * When each task last joined this iteration (from its change history);
   * a task without an entry counts from when it was created.
   */
  joinedAt: ReadonlyMap<string, number>
  /** Local today, `YYYY-MM-DD`. */
  today: string
}

/** Local midnight at the end of a day: the instant the day's state is read at. */
function endOfDay(date: string): number {
  return parseIsoDate(shiftIsoDate(date, 1))!.getTime()
}

const round = (value: number) => Math.round(value * 100) / 100

/**
 * The remaining work in an iteration at the end of each of its days, against
 * an ideal straight line to nothing on the last day. Read from the status
 * history: a task counts once it joined the iteration (scope added part-way
 * raises the line), and as remaining while its last status by then was not
 * Done (work reopened raises it again). Days after today have no remaining
 * value, so the line stops at today while the ideal runs to the end.
 */
export function iterationBurndown(input: IterationBurndownInput): IterationBurndownSeries {
  const { iteration } = input
  const tasks = input.tasks.filter((task) => task.iterationId === iteration.id)
  const history = new Map<string, PlanningStatusTransition[]>()
  for (const transition of input.transitions) {
    const list = history.get(transition.workItemId)
    if (list) list.push(transition)
    else history.set(transition.workItemId, [transition])
  }
  const doneBy = (taskId: string, at: number): boolean => {
    let status: string | null = null
    for (const transition of history.get(taskId) ?? []) {
      if (transition.at >= at) break
      status = transition.to
    }
    return status === 'done'
  }
  const length = iterationLength(iteration)
  const measure = (at: number, remainingOnly: boolean) => {
    let count = 0
    let estimate = 0
    for (const task of tasks) {
      const joined = input.joinedAt.get(task.id) ?? task.createdAt
      if (joined >= at) continue
      if (remainingOnly && doneBy(task.id, at)) continue
      count += 1
      estimate += task.estimate ?? 0
    }
    return { count, estimate }
  }
  const start = measure(endOfDay(iteration.startDate), false)
  const days: IterationBurndownDay[] = []
  for (let index = 0; index < length; index += 1) {
    const date = shiftIsoDate(iteration.startDate, index)
    const share = length === 1 ? 1 : (length - 1 - index) / (length - 1)
    const remaining = date <= input.today ? measure(endOfDay(date), true) : null
    days.push({
      date,
      remainingCount: remaining ? remaining.count : null,
      remainingEstimate: remaining ? round(remaining.estimate) : null,
      idealCount: round(start.count * share),
      idealEstimate: round(start.estimate * share)
    })
  }
  return {
    days,
    startCount: start.count,
    startEstimate: round(start.estimate),
    allEstimated: tasks.length > 0 && tasks.every((task) => task.estimate !== null)
  }
}
