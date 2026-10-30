import type { PlanningDependencyLink, PlanningWorkItem } from '../ostler-api'
import { isIsoDate, isoDaysBetween } from '../dates'
import { shiftTaskDates } from './calendar'
import { dependencyLinksOf } from './dependency-links'
import { dependencyLinkConflict, taskTimelineBar } from './timeline'
import type { RescheduleChange } from './reschedule'
import { isOwnWorkingDay, nextWorkingDay, type PersonWorkingDays } from './working-days'

/**
 * Move what waits on it (N7.1, decision N49): when a task's due date moves
 * later, the tasks that wait on it and now start too early move later by the
 * same number of days, then the tasks waiting on those, and so on. Pure and
 * on `YYYY-MM-DD` strings only, so the app's offer, its preview and the
 * automation API's `moveDependents` give the same plan. "Too early" is
 * `dependencyLinkConflict`, the Timeline's rule, so each link's type and lag
 * (N7.2a) count: a start-to-start link is pushed by how far the other's first
 * day moved, the others by how far its due date moved.
 */

/** A task the plan reads, and may move. */
export type DependentTask = Pick<
  PlanningWorkItem,
  'id' | 'title' | 'status' | 'startDate' | 'targetDate' | 'dependencyIds' | 'dependencyLinks'
>

/** One task's dates before and after a change already made (or about to be). */
export interface TaskDateMove {
  id: string
  fromDue: string | null
  fromStart: string | null
  toDue: string | null
  toStart: string | null
}

/** A task the plan moves. */
export interface DependentMoveEntry extends RescheduleChange {
  fromDue: string
  toDue: string
  title: string
  /** The moved task it waits on, which pushed it. */
  dependencyId: string
  /** Days it moves: the push, plus any days to land on a working day. */
  days: number
}

/** A task that waits on a moved one but is left as it is. */
export interface DependentMoveSkip {
  id: string
  title: string
  /** `done`: finished work never moves. `undated`: it has no due date to move. */
  reason: 'done' | 'undated'
}

export interface DependentMovePlan {
  entries: DependentMoveEntry[]
  skipped: DependentMoveSkip[]
}

/**
 * How many days after `date` the first working day is (0 when it is one), by
 * the one working-day rule: the person's weekdays and their days off.
 */
function daysToWorkingDay(date: string, days: PersonWorkingDays): number {
  if (isOwnWorkingDay(date, days)) return 0
  return isoDaysBetween(date, nextWorkingDay(date, days.personId ?? null, days))
}

/** How many days a move pushes what waits on it: later due dates only. */
export function moveDays(move: Pick<TaskDateMove, 'fromDue' | 'toDue'>): number {
  if (!isIsoDate(move.fromDue) || !isIsoDate(move.toDue)) return 0
  return Math.max(0, isoDaysBetween(move.fromDue, move.toDue))
}

/** How many days a move pushes a start-to-start link: its first day, later only. */
export function startMoveDays(move: TaskDateMove): number {
  const from = taskTimelineBar({ startDate: move.fromStart, targetDate: move.fromDue })
  const to = taskTimelineBar({ startDate: move.toStart, targetDate: move.toDue })
  if (!from || !to) return 0
  return Math.max(0, isoDaysBetween(from.start, to.start))
}

/**
 * The plan for `moves` among `tasks` (the project's tasks as they were, or
 * already with the moves made: the moves' `to` dates win either way). A task
 * whose due date moved later by N days pushes each task waiting on it that
 * would now start before it is due: that task moves by N days, keeping its
 * own start-to-due gap (`shiftTaskDates`), and on to the next working day
 * when its first day is not one (later, never earlier; `working-days`' rule,
 * so a day off counts as well as the weekend). Then the same is
 * asked of the tasks waiting on it, by the days it moved. Each task moves at
 * most once, which also stops the plan at a cycle; the moved tasks themselves
 * never move again. Done tasks and tasks without a due date are listed as
 * skipped. A move earlier pulls nothing.
 */
export function planDependentMoves(
  tasks: readonly DependentTask[],
  moves: readonly TaskDateMove[],
  workingDays: PersonWorkingDays = {}
): DependentMovePlan {
  const current = new Map(tasks.map((task) => [task.id, { ...task }]))
  for (const move of moves) {
    const task = current.get(move.id)
    if (task) {
      task.targetDate = move.toDue
      task.startDate = move.toStart
    }
  }
  const waiting = new Map<string, Array<{ task: DependentTask; link: PlanningDependencyLink }>>()
  for (const task of tasks)
    for (const link of dependencyLinksOf(task)) {
      if (link.id === task.id) continue
      const list = waiting.get(link.id) ?? []
      list.push({ task, link })
      waiting.set(link.id, list)
    }

  const settled = new Set(moves.map((move) => move.id))
  const queue = moves
    .map((move) => ({ id: move.id, days: moveDays(move), startDays: startMoveDays(move) }))
    .filter((push) => push.days > 0 || push.startDays > 0)
  const plan: DependentMovePlan = { entries: [], skipped: [] }
  for (let next = queue.shift(); next; next = queue.shift()) {
    const pusher = current.get(next.id)
    if (!pusher) continue
    for (const { task: waiter, link } of waiting.get(next.id) ?? []) {
      if (settled.has(waiter.id)) continue
      const push = link.type === 'start-to-start' ? next.startDays : next.days
      if (push <= 0) continue
      const task = current.get(waiter.id)!
      if (!taskTimelineBar(task)) {
        settled.add(task.id)
        plan.skipped.push({ id: task.id, title: task.title, reason: 'undated' })
        continue
      }
      // The Timeline's own rule, on just this link.
      if (!dependencyLinkConflict(task, link, pusher)) continue
      settled.add(task.id)
      if (task.status === 'done' || !task.targetDate || !isIsoDate(task.targetDate)) {
        plan.skipped.push({
          id: task.id,
          title: task.title,
          reason: task.status === 'done' ? 'done' : 'undated'
        })
        continue
      }
      const pushed = shiftTaskDates(task, push)!
      const firstDay = pushed.startDate ?? pushed.targetDate
      const days = push + daysToWorkingDay(firstDay, workingDays)
      const patch = shiftTaskDates(task, days)!
      const toStart = patch.startDate === undefined ? (task.startDate ?? null) : patch.startDate
      plan.entries.push({
        id: task.id,
        title: task.title,
        dependencyId: pusher.id,
        days,
        fromDue: task.targetDate,
        toDue: patch.targetDate,
        fromStart: task.startDate ?? null,
        toStart
      })
      task.targetDate = patch.targetDate
      task.startDate = toStart
      queue.push({ id: task.id, days, startDays: days })
    }
  }
  return plan
}
