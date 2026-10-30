import type { PlanningWorkItem } from '../ostler-api'
import { dependencyLinksOf, holdsBackWork } from './dependency-links'

/**
 * The dependencies still standing between a work item and being startable, in
 * the order the item lists them. The one rule for the Board (cards, the Queue
 * button) and the main process (queueing, and every claim path the harness
 * offers an agent).
 *
 * What counts as "done" differs only in what each side can see, so the caller
 * supplies it: the renderer asks for the projected Board column, and main also
 * reads the harness's stored state for a session chaining its own work.
 *
 * - Only a finish-to-start link is ever in the way (N7.2a): start-to-start
 *   and finish-to-finish links are about dates only.
 * - A dependency that no longer exists is not in the way.
 * - A parent is never in the way of its own subtask. Rows saved before parent
 *   dependencies were rejected would otherwise wait forever: a parent is never
 *   dispatched, so it never reaches done.
 */
export function unmetDependencyIds(
  item: Pick<PlanningWorkItem, 'dependencyIds' | 'dependencyLinks' | 'parentWorkItemId'>,
  getItem: (id: string) => PlanningWorkItem | undefined,
  isDone: (dependency: PlanningWorkItem) => boolean
): string[] {
  const held = dependencyLinksOf(item)
    .filter(holdsBackWork)
    .map((link) => link.id)
  return held.filter((dependencyId) => {
    const dependency = getItem(dependencyId)
    if (!dependency) return false
    if (item.parentWorkItemId && dependencyId === item.parentWorkItemId) return false
    return !isDone(dependency)
  })
}

/**
 * The tasks `item` may be set to depend on, for the drawer's picker: never
 * itself or any of its own subtasks (a parent finishes with them, so waiting
 * on one says nothing), and for a subtask only its siblings in the same phase
 * (the main process refuses anything else, `validateDependencies`).
 */
export function dependencyCandidates(
  item: Pick<PlanningWorkItem, 'id' | 'parentWorkItemId' | 'subtaskPhaseNumber'>,
  items: PlanningWorkItem[]
): PlanningWorkItem[] {
  const descendants = new Set<string>([item.id])
  let grew = true
  while (grew) {
    grew = false
    for (const candidate of items) {
      if (
        candidate.parentWorkItemId &&
        descendants.has(candidate.parentWorkItemId) &&
        !descendants.has(candidate.id)
      ) {
        descendants.add(candidate.id)
        grew = true
      }
    }
  }
  return items.filter(
    (candidate) =>
      !descendants.has(candidate.id) &&
      (!item.parentWorkItemId ||
        (candidate.parentWorkItemId === item.parentWorkItemId &&
          candidate.subtaskPhaseNumber === item.subtaskPhaseNumber))
  )
}
