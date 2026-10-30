import type {
  PlanningDependencyLink,
  PlanningDependencyType,
  PlanningWorkItem
} from '../ostler-api'
import {
  dependencyLinksOf,
  isPlainDependencyLink,
  type DependencyLinkSource
} from './dependency-links'
import { compareIsoDates, isIsoDate, shiftIsoDate } from '../dates'

/**
 * The Timeline view's rules (P5.5): what bar a task draws, what an edit to
 * that bar writes, and which dependencies are out of order. Pure and on
 * `YYYY-MM-DD` strings only, like the Calendar's moves (`calendar.ts`), so
 * every edit gives the same dates in every time zone.
 */

type TaskDates = Pick<PlanningWorkItem, 'startDate' | 'targetDate'>

/**
 * A task on the timeline:
 * - `range`: from the start to the due date; a task with a due date only is
 *   a one-day range ending on it (`hasStart` false).
 * - `start`: a start date only, drawn as a marker with a fade.
 * Null for a task with neither, which is listed under Unscheduled.
 */
export type TaskTimelineBar =
  | { kind: 'range'; start: string; end: string; hasStart: boolean }
  | { kind: 'start'; start: string }

export function taskTimelineBar(item: TaskDates): TaskTimelineBar | null {
  const due = item.targetDate && isIsoDate(item.targetDate) ? item.targetDate : null
  const start = item.startDate && isIsoDate(item.startDate) ? item.startDate : null
  if (due) {
    const hasStart = start !== null && compareIsoDates(start, due) <= 0
    return { kind: 'range', start: hasStart ? start! : due, end: due, hasStart }
  }
  if (start) return { kind: 'start', start }
  return null
}

/** The first and last day a bar covers (a start marker covers its day). */
export function timelineBarSpan(bar: TaskTimelineBar): { start: string; end: string } {
  return bar.kind === 'range'
    ? { start: bar.start, end: bar.end }
    : { start: bar.start, end: bar.start }
}

/** The dates a timeline edit writes, as the update call takes them. */
export interface TaskDateChange {
  targetDate?: string | null
  startDate?: string | null
}

/** Which part of a bar an edit moves: the whole bar, its start or its due end. */
export type TimelineEdit = 'move' | 'start' | 'due'

/**
 * What moving part of a task's bar by `days` writes, or null when nothing
 * would change or the result would put the start after the due date.
 * - `move`: both dates by the same number of days (a start-only task moves
 *   its start).
 * - `start`: the start date. On a due-only task the bar's left end is the
 *   due day, so dragging it earlier gives the task a start date.
 * - `due`: the due date. On a due-only task, lengthening it keeps the left
 *   end where it was by writing that day as the start; on a start-only task
 *   it gives the task a due date on or after its start.
 */
export function editTaskDates(
  item: TaskDates,
  edit: TimelineEdit,
  days: number
): TaskDateChange | null {
  const bar = taskTimelineBar(item)
  if (!bar || days === 0) return null
  if (bar.kind === 'start') {
    if (edit !== 'due') return { startDate: shiftIsoDate(bar.start, days) }
    return days < 0 ? null : { targetDate: shiftIsoDate(bar.start, days) }
  }
  if (edit === 'move') {
    const change: TaskDateChange = { targetDate: shiftIsoDate(bar.end, days) }
    if (bar.hasStart) change.startDate = shiftIsoDate(bar.start, days)
    return change
  }
  if (edit === 'start') {
    const start = shiftIsoDate(bar.start, days)
    if (compareIsoDates(start, bar.end) > 0) return null
    return { startDate: start }
  }
  const due = shiftIsoDate(bar.end, days)
  if (compareIsoDates(due, bar.start) < 0) return null
  const change: TaskDateChange = { targetDate: due }
  if (!bar.hasStart && days > 0) change.startDate = bar.start
  return change
}

/** An unscheduled task dropped on `date`: one day long, starting and due there. */
export function scheduleTaskOn(date: string): Required<TaskDateChange> {
  return { startDate: date, targetDate: date }
}

/** The dates a change replaces, as they were: what undo puts back. */
export function previousTaskDateChange(item: TaskDates, change: TaskDateChange): TaskDateChange {
  const previous: TaskDateChange = {}
  if (change.targetDate !== undefined) previous.targetDate = item.targetDate
  if (change.startDate !== undefined) previous.startDate = item.startDate
  return previous
}

/**
 * A waits-on link its dates break (P5.5, N7.2a): the task starts, or for a
 * finish-to-finish link is due, before the link allows.
 */
export interface DependencyConflict {
  /** The task that is too early. */
  taskId: string
  /** The task it waits on. */
  dependencyId: string
  /**
   * The task's date the link measures: its first day, or its due date for a
   * finish-to-finish link.
   */
  start: string
  /**
   * The waited-on task's date the link measures from: its due date, or its
   * first day for a start-to-start link.
   */
  dependencyDue: string
  /**
   * The link's type and lag, and the earliest `start` it allows
   * (`dependencyDue` plus the lag). Only on a link that is not finish to
   * start with no lag, so such a link's conflict is exactly what it was
   * before types (N7.2a).
   */
  type?: PlanningDependencyType
  lagDays?: number
  earliest?: string
}

type ConflictTask = Pick<PlanningWorkItem, 'id' | 'startDate' | 'targetDate'> & DependencyLinkSource

/**
 * The one rule for whether a waits-on link's dates are kept (N7.2a, decision
 * N50), or the conflict when they are not. A task starts on its start date,
 * or its due date when it has none (`taskTimelineBar`):
 * - finish to start: it starts on or after the other's due date plus the lag;
 * - start to start: it starts on or after the other's first day plus the lag;
 * - finish to finish: it is due on or after the other's due date plus the lag.
 * A date the link needs that is missing is no conflict. Finish to start with
 * no lag is the Timeline's rule from before types: starting on the day the
 * other is due is not "before" it.
 */
export function dependencyLinkConflict(
  task: Pick<PlanningWorkItem, 'id' | 'startDate' | 'targetDate'>,
  link: PlanningDependencyLink,
  dependency: TaskDates
): DependencyConflict | null {
  const bar = taskTimelineBar(task)
  if (!bar) return null
  const validDue = (item: TaskDates) =>
    item.targetDate && isIsoDate(item.targetDate) ? item.targetDate : null
  let date: string | null
  let from: string | null
  if (link.type === 'finish-to-finish') {
    date = validDue(task)
    from = validDue(dependency)
  } else {
    date = bar.start
    from =
      link.type === 'start-to-start'
        ? (taskTimelineBar(dependency)?.start ?? null)
        : validDue(dependency)
  }
  if (!date || !from) return null
  const earliest = shiftIsoDate(from, link.lagDays)
  if (compareIsoDates(date, earliest) >= 0) return null
  const conflict: DependencyConflict = {
    taskId: task.id,
    dependencyId: link.id,
    start: date,
    dependencyDue: from
  }
  if (isPlainDependencyLink(link)) return conflict
  return { ...conflict, type: link.type, lagDays: link.lagDays, earliest }
}

/**
 * Every waits-on link whose dates are broken (P5.5; P6.2's risk list, N7.1's
 * moves and N7.3's critical path read the same rule, `dependencyLinkConflict`).
 * A link to a task that is not among `tasks` is no conflict. Each link is
 * judged on its own, in the order the tasks and their links are listed.
 */
export function dependencyConflicts(tasks: readonly ConflictTask[]): DependencyConflict[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const conflicts: DependencyConflict[] = []
  for (const task of tasks) {
    if (!taskTimelineBar(task)) continue
    for (const link of dependencyLinksOf(task)) {
      if (link.id === task.id) continue
      const dependency = byId.get(link.id)
      if (!dependency) continue
      const conflict = dependencyLinkConflict(task, link, dependency)
      if (conflict) conflicts.push(conflict)
    }
  }
  return conflicts
}
