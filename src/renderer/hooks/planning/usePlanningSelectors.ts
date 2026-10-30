import { useCallback, useMemo } from 'react'
import { projectWorkItemStatus, workItemDeletionBlocker } from '@shared/work-item-status'
import { unmetDependencyIds } from '@shared/planning/dependencies'
import { todayLists } from '@shared/planning/board'
import { currentIteration } from '@shared/planning/iterations'
import { todayIsoDate } from '@shared/dates'
import type { PlanningWorkItem, PlanningWorkItemStatus } from '@shared/ostler-api'
import type { PlanningRecords } from './usePlanningRecords'

/**
 * Read-only answers derived from the loaded records: lookups by id, the
 * projected Board column, dependencies, and the Today lists. The rules
 * themselves live in `src/shared/planning/` and `src/shared/work-item-status`;
 * this binds them to the current records. Depends on `usePlanningRecords`.
 */
export function usePlanningSelectors(records: PlanningRecords) {
  const { goals, milestones, workItems, harnessState, iterations } = records
  const { openBlockers } = records.internal

  const milestoneNames = useMemo(
    () => new Map(milestones.map((milestone) => [milestone.id, milestone.name])),
    [milestones]
  )

  const goalNames = useMemo(() => new Map(goals.map((goal) => [goal.id, goal.title])), [goals])

  /** A milestone's goalId, looked up by milestone id — null if unlinked or the milestone itself is missing. */
  const goalIdByMilestoneId = useMemo(
    () => new Map(milestones.map((milestone) => [milestone.id, milestone.goalId])),
    [milestones]
  )

  const goalIdForItem = useCallback(
    (item: PlanningWorkItem): string | null =>
      (item.milestoneId && goalIdByMilestoneId.get(item.milestoneId)) || null,
    [goalIdByMilestoneId]
  )

  /** The project's current iteration (R6.1), for "Current iteration" filters. */
  const currentIterationId = currentIteration(iterations, todayIsoDate())?.id ?? null

  const workItemsById = useMemo(
    () => new Map(workItems.map((item) => [item.id, item])),
    [workItems]
  )

  // Stable while the harness state is, so the Board's filtered columns can
  // be memoised on it (P9.1).
  const projectedStatus = useCallback(
    (item: PlanningWorkItem): PlanningWorkItemStatus => projectWorkItemStatus(item, harnessState),
    [harnessState]
  )

  /** Why the item cannot be deleted right now (same rule the main process enforces), or null. */
  const deletionBlocker = (item: PlanningWorkItem): string | null =>
    workItemDeletionBlocker(item, harnessState)

  /**
   * The dependencies still standing between this item and being startable.
   * Board cards report the count and name them on hover, rather than the old
   * "3 dependencies" -- which never said whether any of them were outstanding.
   */
  const unmetDependencies = (item: PlanningWorkItem): PlanningWorkItem[] =>
    unmetDependencyIds(
      item,
      (id) => workItemsById.get(id),
      (dependency) => projectedStatus(dependency) === 'done'
    ).map((id) => workItemsById.get(id)!)

  const dependenciesComplete = (item: PlanningWorkItem) => unmetDependencies(item).length === 0

  /** The one rule behind both the card's Queue button and the bulk queue action. */
  const isQueueable = (item: PlanningWorkItem): boolean =>
    projectedStatus(item) === 'ready' && !item.linkedHarnessTaskId && dependenciesComplete(item)

  /** Work that cannot move until this item is finished and accepted. */
  const dependentsWaitingOn = (item: PlanningWorkItem): PlanningWorkItem[] =>
    workItems.filter((candidate) =>
      unmetDependencies(candidate).some((dependency) => dependency.id === item.id)
    )

  /** The unmet dependencies of this item that are themselves sitting in Review. */
  const unmetDependenciesInReview = (item: PlanningWorkItem): PlanningWorkItem[] =>
    unmetDependencies(item).filter((dependency) => projectedStatus(dependency) === 'review')

  const harnessTaskFor = (item: PlanningWorkItem) =>
    harnessState?.taskQueue.find((task) => task.id === item.linkedHarnessTaskId) ?? null

  // Memoised (P9.1): a Board card re-renders only when what it reads changes,
  // and these are among what it reads.
  const openBlockersByWorkItem = useMemo(() => {
    const counts = new Map<string, number>()
    for (const blocker of openBlockers) {
      counts.set(blocker.workItemId, (counts.get(blocker.workItemId) ?? 0) + 1)
    }
    return counts
  }, [openBlockers])

  const { readyNow, activeNow, blockedNow } = useMemo(
    () => todayLists(workItems, projectedStatus),
    [workItems, projectedStatus]
  )

  return {
    currentIterationId,
    milestoneNames,
    goalNames,
    goalIdForItem,
    workItemsById,
    projectedStatus,
    deletionBlocker,
    unmetDependencies,
    dependenciesComplete,
    isQueueable,
    dependentsWaitingOn,
    unmetDependenciesInReview,
    harnessTaskFor,
    openBlockersByWorkItem,
    readyNow,
    activeNow,
    blockedNow
  }
}

export type PlanningSelectors = ReturnType<typeof usePlanningSelectors>
