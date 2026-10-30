import type {
  PlanningPriority,
  PlanningWorkItem,
  PlanningWorkItemPlacement,
  PlanningWorkItemStatus
} from '../ostler-api'
import { orderKeyBetween } from './order-key'

export type BoardSortBy = 'manual' | 'priority' | 'targetDate' | 'title' | 'created'
export type BoardSortDir = 'asc' | 'desc'

const PRIORITY_SORT_ORDER: Record<PlanningPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
}

/**
 * Tasks in the project's manual order (D31): by their stored order key, byte
 * by byte as the database sorts them. Stable, so records without a key keep
 * the order they came in.
 */
export function inManualOrder<T extends Pick<PlanningWorkItem, 'orderKey'>>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const left = a.orderKey ?? ''
    const right = b.orderKey ?? ''
    return left < right ? -1 : left > right ? 1 : 0
  })
}

/** Board order. `manual` keeps the order the items arrived in (the stored order); undated items sort last either way. */
export function sortWorkItems(
  items: PlanningWorkItem[],
  sortBy: BoardSortBy,
  sortDir: BoardSortDir
): PlanningWorkItem[] {
  if (sortBy === 'manual') return items
  const dir = sortDir === 'asc' ? 1 : -1
  return [...items].sort((a, b) => {
    switch (sortBy) {
      case 'priority':
        return (PRIORITY_SORT_ORDER[a.priority] - PRIORITY_SORT_ORDER[b.priority]) * dir
      case 'targetDate': {
        if (!a.targetDate && !b.targetDate) return 0
        if (!a.targetDate) return 1
        if (!b.targetDate) return -1
        return a.targetDate.localeCompare(b.targetDate) * dir
      }
      case 'title':
        return a.title.localeCompare(b.title) * dir
      case 'created':
        return (a.createdAt - b.createdAt) * dir
      default:
        return 0
    }
  })
}

/**
 * Where the drop line goes while a card is dragged over a column (an index
 * into `columnItems`: the line is drawn before that card, or after the last
 * one), or null when a drop there would not move it.
 *
 * - Manual order: exactly where the pointer is (`pointerIndex`), between two
 *   cards. A drop just above or below the card itself is no move.
 * - Any other sort: the card goes where that sort puts it, so a drag within
 *   its own column is not offered.
 */
export function dropIndex(
  columnItems: PlanningWorkItem[],
  dragged: PlanningWorkItem,
  sortBy: BoardSortBy,
  sortDir: BoardSortDir,
  pointerIndex: number = 0
): number | null {
  const own = columnItems.findIndex((item) => item.id === dragged.id)
  if (sortBy === 'manual') {
    const at = Math.max(0, Math.min(pointerIndex, columnItems.length))
    if (own >= 0 && (at === own || at === own + 1)) return null
    return at
  }
  if (own >= 0) return null
  return sortWorkItems([dragged, ...columnItems], sortBy, sortDir).indexOf(dragged)
}

/**
 * The move a drop at `insertAt` (from `dropIndex`) makes: before the card
 * the line is above, else after the column's last card, else to the end of
 * an empty column. Every placement names `status`, so a drop into another
 * column also changes the task's status.
 */
/** A placement's column (MOP-26), left out for the status's own. */
function inColumn(columnId: string | null): { columnId?: string } {
  return columnId ? { columnId } : {}
}

export function dropPlacement(
  columnItems: PlanningWorkItem[],
  dragged: PlanningWorkItem,
  insertAt: number,
  status: PlanningWorkItemStatus,
  columnId: string | null = null
): PlanningWorkItemPlacement {
  const own = columnItems.findIndex((item) => item.id === dragged.id)
  const rest = columnItems.filter((item) => item.id !== dragged.id)
  const at = own >= 0 && own < insertAt ? insertAt - 1 : insertAt
  if (at < rest.length) return { beforeId: rest[at].id, status, ...inColumn(columnId) }
  if (rest.length > 0) return { afterId: rest[rest.length - 1].id, status, ...inColumn(columnId) }
  return { position: 'end', status, ...inColumn(columnId) }
}

/**
 * Alt and an arrow key on a focused task in a list in manual order: one
 * place up (`-1`) or down (`1`). Null at either end.
 */
export function stepPlacement(
  items: PlanningWorkItem[],
  item: PlanningWorkItem,
  step: -1 | 1
): PlanningWorkItemPlacement | null {
  const index = items.findIndex((candidate) => candidate.id === item.id)
  const neighbour = index < 0 ? undefined : items[index + step]
  if (!neighbour) return null
  return step < 0 ? { beforeId: neighbour.id } : { afterId: neighbour.id }
}

/**
 * Alt and Left or Right on a focused card: into the next column at the same
 * height (`row`), or at its end when that column is shorter.
 */
export function columnPlacement(
  targetItems: PlanningWorkItem[],
  row: number,
  status: PlanningWorkItemStatus,
  columnId: string | null = null
): PlanningWorkItemPlacement {
  if (row < targetItems.length)
    return { beforeId: targetItems[row].id, status, ...inColumn(columnId) }
  return { position: 'end', status, ...inColumn(columnId) }
}

/**
 * The key the main process will give a moved task, worked out from the
 * project's tasks in manual order, so the move shows before the answer comes
 * back. Undefined when it cannot tell (an empty column, records without keys).
 */
export function predictOrderKey(
  items: PlanningWorkItem[],
  itemId: string,
  placement: PlanningWorkItemPlacement
): string | undefined {
  const anchorId = placement.beforeId ?? placement.afterId
  if (!anchorId) return undefined
  const rest = items.filter((item) => item.id !== itemId)
  const index = rest.findIndex((item) => item.id === anchorId)
  if (index < 0) return undefined
  const [low, high] =
    placement.beforeId !== undefined
      ? [rest[index - 1], rest[index]]
      : [rest[index], rest[index + 1]]
  try {
    return orderKeyBetween(low?.orderKey || null, high?.orderKey || null)
  } catch {
    return undefined
  }
}

export interface BoardFilter {
  query: string
  priority: PlanningPriority | 'all'
  /** A milestone id, `all`, or `none` for unlinked work. */
  milestoneId: string
  /** A goal id, `all`, or `none` for work under no goal. */
  goalId: string
  /** A person id, `all`, or `none` for unassigned work. Optional: older callers leave it out. */
  assigneeId?: string
  hideDone: boolean
}

/**
 * Whether an item passes the Board's filters. The query matches the title,
 * description and labels; Hide done uses the projected column, so finished
 * agent work hides even while its stored status lags.
 */
export function matchesBoardFilter(
  item: PlanningWorkItem,
  filter: BoardFilter,
  projectedStatus: (item: PlanningWorkItem) => PlanningWorkItemStatus,
  goalIdForItem: (item: PlanningWorkItem) => string | null
): boolean {
  const query = filter.query.trim().toLowerCase()
  const matchesQuery =
    !query ||
    item.title.toLowerCase().includes(query) ||
    item.description.toLowerCase().includes(query) ||
    item.labels.some((label) => label.toLowerCase().includes(query))
  const matchesPriority = filter.priority === 'all' || item.priority === filter.priority
  const matchesMilestone =
    filter.milestoneId === 'all' ||
    (filter.milestoneId === 'none' ? !item.milestoneId : item.milestoneId === filter.milestoneId)
  const matchesGoal =
    filter.goalId === 'all' ||
    (filter.goalId === 'none' ? !goalIdForItem(item) : goalIdForItem(item) === filter.goalId)
  const assignee = filter.assigneeId ?? 'all'
  const matchesAssignee =
    assignee === 'all' || (assignee === 'none' ? !item.assigneeId : item.assigneeId === assignee)
  const matchesVisibility = !filter.hideDone || projectedStatus(item) !== 'done'
  return (
    matchesQuery &&
    matchesPriority &&
    matchesMilestone &&
    matchesGoal &&
    matchesAssignee &&
    matchesVisibility
  )
}

/** Items per Board column, in the given order, keyed by every status in `statuses`. */
export function groupByProjectedStatus(
  items: PlanningWorkItem[],
  statuses: PlanningWorkItemStatus[],
  projectedStatus: (item: PlanningWorkItem) => PlanningWorkItemStatus
): Map<PlanningWorkItemStatus, PlanningWorkItem[]> {
  return new Map(
    statuses.map((status) => [status, items.filter((item) => projectedStatus(item) === status)])
  )
}

/**
 * Today's three lists. "Ready now" is everything a human could hand to an
 * agent: unmet dependencies no longer hide work here, because the queue is the
 * waiting room and releases queued work when its dependencies finish. Each row
 * says what it is still waiting on instead.
 */
export function todayLists(
  items: PlanningWorkItem[],
  projectedStatus: (item: PlanningWorkItem) => PlanningWorkItemStatus
): { readyNow: PlanningWorkItem[]; activeNow: PlanningWorkItem[]; blockedNow: PlanningWorkItem[] } {
  return {
    readyNow: items.filter(
      (item) => projectedStatus(item) === 'ready' && !item.linkedHarnessTaskId
    ),
    activeNow: items.filter((item) => projectedStatus(item) === 'active'),
    blockedNow: items.filter((item) => projectedStatus(item) === 'blocked')
  }
}
