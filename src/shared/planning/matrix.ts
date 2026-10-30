import type { PlanningPriority, PlanningWorkItem, PlanningWorkItemStatus } from '../ostler-api'
import { shiftIsoDate } from '../dates'
import { isHiddenNow } from './show-from'

/**
 * The priority matrix (N7.5, decision N53): the one rule for which of four
 * boxes an open task sits in. The Matrix view and the automation API's
 * GET /matrix both ask it, so they always agree.
 *
 * - **Important**: priority high or critical.
 * - **Urgent**: overdue or due within three days (today plus three), in the
 *   person's local dates, the same dates Home's Today counts overdue and due
 *   today with. A task with no due date is never urgent.
 */

export const MATRIX_BOXES = ['urgentImportant', 'important', 'urgent', 'neither'] as const
export type MatrixBox = (typeof MATRIX_BOXES)[number]

/** How many days ahead still counts as urgent. Fixed (N53). */
export const URGENT_WITHIN_DAYS = 3

type MatrixTask = Pick<PlanningWorkItem, 'priority' | 'targetDate' | 'title'>

export function isImportant(priority: PlanningPriority): boolean {
  return priority === 'high' || priority === 'critical'
}

/** Overdue or due by `today` plus three days; `today` is the local date, YYYY-MM-DD. */
export function isUrgent(task: Pick<PlanningWorkItem, 'targetDate'>, today: string): boolean {
  if (!task.targetDate) return false
  return task.targetDate <= shiftIsoDate(today, URGENT_WITHIN_DAYS)
}

export function matrixBoxOf(task: MatrixTask, today: string): MatrixBox {
  const important = isImportant(task.priority)
  const urgent = isUrgent(task, today)
  if (important) return urgent ? 'urgentImportant' : 'important'
  return urgent ? 'urgent' : 'neither'
}

/** The top row of the matrix holds the important boxes. */
export function isImportantBox(box: MatrixBox): boolean {
  return box === 'urgentImportant' || box === 'important'
}

/** The left column holds the urgent boxes. */
export function isUrgentBox(box: MatrixBox): boolean {
  return box === 'urgentImportant' || box === 'urgent'
}

const PRIORITY_RANK: Record<PlanningPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
}

/** Within a box: due date (undated last), then priority (critical first), then title. */
export function compareMatrixTasks(a: MatrixTask, b: MatrixTask): number {
  if (a.targetDate !== b.targetDate) {
    if (!a.targetDate) return 1
    if (!b.targetDate) return -1
    return a.targetDate < b.targetDate ? -1 : 1
  }
  const rank = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (rank !== 0) return rank
  return a.title.localeCompare(b.title)
}

/** `tasks` sorted into the four boxes, each in matrix order. */
export function sortIntoMatrix<T extends MatrixTask>(
  tasks: readonly T[],
  today: string
): Record<MatrixBox, T[]> {
  const boxes: Record<MatrixBox, T[]> = {
    urgentImportant: [],
    important: [],
    urgent: [],
    neither: []
  }
  for (const task of tasks) boxes[matrixBoxOf(task, today)].push(task)
  for (const box of MATRIX_BOXES) boxes[box].sort(compareMatrixTasks)
  return boxes
}

/**
 * The tasks the matrix shows when no filter narrows them: the Board's tasks
 * that are still open. `tasks` are live ones (not archived, not in the bin),
 * with `status` the Board column; Someday and shown-later tasks are left out
 * by the same rule as the Board (N1.1a).
 */
export function matrixCandidates<
  T extends Pick<PlanningWorkItem, 'showFrom' | 'someday'> & { status: PlanningWorkItemStatus }
>(tasks: readonly T[], today: string): T[] {
  return tasks.filter((task) => task.status !== 'done' && !isHiddenNow(task, today))
}

/**
 * The priority a card gets when it is dragged into the other row, or null when
 * it keeps its own: up makes it high unless it is already high or critical,
 * down makes it medium unless it is already low or medium.
 */
export function priorityForRow(
  priority: PlanningPriority,
  important: boolean
): PlanningPriority | null {
  if (important) return isImportant(priority) ? null : 'high'
  return isImportant(priority) ? 'medium' : null
}
