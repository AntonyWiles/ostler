import type { EstimateUnit, Person, PlanningWorkItemStatus, TimeEntry } from '../ostler-api'
import { DEFAULT_WORKING_DAYS } from '../ostler-api'
import { compareIsoDates, isoWeekday, shiftIsoDate } from '../dates'
import { entryDay, entrySeconds } from '../time/timesheet'
import {
  countWeekdays,
  countWorkingDays as countPersonWorkingDays,
  daysOffBetween,
  isoWeekdayNumber,
  type DayOffSpan
} from './working-days'

/**
 * How workload is counted (D36, R3.2): the one rule the Workload view and its
 * tests use. Pure, and built on `YYYY-MM-DD` arithmetic only (`dates.ts`), so
 * no time zone or daylight-saving change can move a day.
 *
 * - An open task's estimate in hours is spread evenly over its assignee's
 *   working days from its start date to its due date, or put all on its due
 *   date when it has no start date (on its start date when it has no due date).
 * - The share that falls before the current week is overdue, unfinished work:
 *   it counts in the current week.
 * - A task with neither date counts as Unscheduled.
 * - A task in a project that estimates in points counts as a task in points,
 *   never as hours. A task with no estimate counts as a task with no hours.
 * - A task counts as one task in every week it has working days in.
 * - A day off (N3.2), everyone's or the assignee's, is not a working day: it
 *   has no capacity and takes no share of an estimate (`working-days.ts`).
 */

/** The row key for tasks nobody is assigned to. */
export const UNASSIGNED = ''

export interface WorkloadTaskInput {
  id: string
  assigneeId: string | null
  status: PlanningWorkItemStatus
  startDate: string | null
  /** The due date. */
  targetDate: string | null
  estimate: number | null
  estimateUnit: EstimateUnit
}

/** One task's share of a cell. */
export interface WorkloadCellTask {
  taskId: string
  /** Hours in this cell; 0 for a task in points or with no estimate. */
  hours: number
  inPoints: boolean
}

export interface WorkloadCell {
  hours: number
  taskCount: number
  /** Tasks in projects that estimate in points, counted apart from hours. */
  pointsTaskCount: number
  tasks: WorkloadCellTask[]
}

export interface WorkloadRow {
  /** Keyed by the week's Monday, `YYYY-MM-DD`; every asked week is there. */
  weeks: Record<string, WorkloadCell>
  unscheduled: WorkloadCell
}

export interface WorkloadOptions {
  /** The Mondays of the weeks to count, `YYYY-MM-DD`. */
  weeks: readonly string[]
  /** Today, `YYYY-MM-DD`, where the person is. */
  today: string
  /** A person's working days as ISO weekdays; Monday to Friday for nobody or someone unknown. */
  workingDays: (personId: string) => readonly number[] | undefined
  /** Days off (N3.2) for everyone and for anyone; left out, none. */
  daysOff?: readonly DayOffSpan[]
}

/** The Monday of the week holding `day`. */
export function workloadWeekStart(day: string): string {
  return shiftIsoDate(day, -((isoWeekday(day) + 6) % 7))
}

/** The Mondays of `count` weeks from the one holding `day`. */
export function workloadWeeks(day: string, count: number): string[] {
  const first = workloadWeekStart(day)
  return Array.from({ length: count }, (_, index) => shiftIsoDate(first, index * 7))
}

/** How many of `days` (ISO weekdays) fall from `from` to `to`, inclusive, days off aside. */
export function countWorkingDays(from: string, to: string, days: ReadonlySet<number>): number {
  return countWeekdays(from, to, days)
}

/**
 * A person's capacity in one week (N3.2): their weekly hours less a day's
 * share for each day off on one of their working days that week. Null
 * without a capacity.
 */
export function weekCapacityHours(
  weeklyCapacityHours: number | null,
  week: string,
  personId: string | null,
  workingDays: readonly number[] | undefined,
  daysOff: readonly DayOffSpan[] = []
): { hours: number; daysOff: { date: string; name: string }[] } | null {
  if (weeklyCapacityHours === null) return null
  const days = workingDays && workingDays.length > 0 ? workingDays : DEFAULT_WORKING_DAYS
  const off = daysOffBetween(week, shiftIsoDate(week, 6), personId, {
    workingDays: days,
    daysOff
  })
  const perDay = weeklyCapacityHours / new Set(days).size
  return {
    hours: Math.max(0, weeklyCapacityHours - perDay * off.length),
    daysOff: off.map(({ date, dayOff }) => ({ date, name: dayOff.name }))
  }
}

function emptyCell(): WorkloadCell {
  return { hours: 0, taskCount: 0, pointsTaskCount: 0, tasks: [] }
}

function addTo(cell: WorkloadCell, task: WorkloadCellTask): void {
  cell.hours += task.hours
  cell.taskCount++
  if (task.inPoints) cell.pointsTaskCount++
  cell.tasks.push(task)
}

/** Each person's planned work per week (D36), keyed by person id, `UNASSIGNED` for nobody. */
export function computeWorkload(
  tasks: readonly WorkloadTaskInput[],
  options: WorkloadOptions
): Map<string, WorkloadRow> {
  const rows = new Map<string, WorkloadRow>()
  const rowFor = (personId: string): WorkloadRow => {
    let row = rows.get(personId)
    if (!row) {
      row = {
        weeks: Object.fromEntries(options.weeks.map((week) => [week, emptyCell()])),
        unscheduled: emptyCell()
      }
      rows.set(personId, row)
    }
    return row
  }
  const currentWeek = workloadWeekStart(options.today)
  const dayCache = new Map<string, readonly number[]>()
  const daysFor = (personId: string): readonly number[] => {
    let days = dayCache.get(personId)
    if (!days) {
      const chosen = personId === UNASSIGNED ? undefined : options.workingDays(personId)
      days = chosen && chosen.length > 0 ? chosen : DEFAULT_WORKING_DAYS
      dayCache.set(personId, days)
    }
    return days
  }
  const daysOff = options.daysOff ?? []

  for (const task of tasks) {
    if (task.status === 'done') continue
    const personId = task.assigneeId ?? UNASSIGNED
    const inPoints = task.estimateUnit === 'points'
    const totalHours = !inPoints && task.estimate !== null && task.estimate > 0 ? task.estimate : 0
    const row = rowFor(personId)

    const due = task.targetDate ?? task.startDate
    if (!due) {
      addTo(row.unscheduled, { taskId: task.id, hours: totalHours, inPoints })
      continue
    }
    let start = task.startDate && task.targetDate ? task.startDate : due
    if (compareIsoDates(start, due) > 0) start = due
    const assignee = personId === UNASSIGNED ? null : personId
    let context = { workingDays: daysFor(personId), daysOff }
    let total = countPersonWorkingDays(start, due, assignee, context)
    // No working day in the span: everything on the due date.
    if (total === 0) {
      context = { workingDays: [isoWeekdayNumber(due)], daysOff: [] }
      start = due
      total = 1
    }
    const count = (from: string, to: string) => countPersonWorkingDays(from, to, assignee, context)
    const perDay = totalHours / total

    // Before the current week is overdue: it counts in the current week.
    const overdueDays =
      compareIsoDates(start, currentWeek) < 0
        ? count(start, minDate(due, shiftIsoDate(currentWeek, -1)))
        : 0
    for (const week of options.weeks) {
      if (compareIsoDates(week, currentWeek) < 0) continue
      const from = maxDate(start, week)
      const to = minDate(due, shiftIsoDate(week, 6))
      let shares = count(from, to)
      if (week === currentWeek) shares += overdueDays
      if (shares === 0) continue
      addTo(row.weeks[week], { taskId: task.id, hours: perDay * shares, inPoints })
    }
  }
  return rows
}

function minDate(a: string, b: string): string {
  return compareIsoDates(a, b) <= 0 ? a : b
}

function maxDate(a: string, b: string): string {
  return compareIsoDates(a, b) >= 0 ? a : b
}

/**
 * Hours logged per person (`UNASSIGNED` for entries without one) and week,
 * for the weeks asked. An entry belongs to the local day it started on.
 */
export function loggedHoursByWeek(
  entries: readonly TimeEntry[],
  weeks: readonly string[],
  now: number
): Map<string, Record<string, number>> {
  const asked = new Set(weeks)
  const result = new Map<string, Record<string, number>>()
  for (const entry of entries) {
    const week = workloadWeekStart(entryDay(entry))
    if (!asked.has(week)) continue
    const key = entry.personId ?? UNASSIGNED
    const row = result.get(key) ?? {}
    row[week] = (row[week] ?? 0) + entrySeconds(entry, now) / 3600
    result.set(key, row)
  }
  return result
}

/** Hours over a capacity, rounded to a tenth; 0 when within it or with no capacity. */
export function hoursOver(hours: number, capacity: number | null): number {
  if (capacity === null) return 0
  const over = Math.round((hours - capacity) * 10) / 10
  return over > 0 ? over : 0
}

/** Every week a person is over their capacity: the Workload view's "over" (one rule). */
export function weeksOverCapacity(input: {
  rows: ReadonlyMap<string, WorkloadRow>
  people: readonly Pick<Person, 'id' | 'weeklyCapacityHours' | 'workingDays'>[]
  weeks: readonly string[]
  daysOff?: readonly DayOffSpan[]
}): { personId: string; week: string; hours: number; capacity: number; over: number }[] {
  const result = []
  for (const week of input.weeks) {
    for (const person of input.people) {
      const hours = input.rows.get(person.id)?.weeks[week]?.hours ?? 0
      const capacity = weekCapacityHours(
        person.weeklyCapacityHours,
        week,
        person.id,
        person.workingDays,
        input.daysOff
      )
      if (!capacity) continue
      const over = hoursOver(hours, capacity.hours)
      if (over > 0)
        result.push({ personId: person.id, week, hours, capacity: capacity.hours, over })
    }
  }
  return result
}
