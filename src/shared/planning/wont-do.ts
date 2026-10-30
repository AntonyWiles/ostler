import type { PlanningWorkItem } from '../ostler-api'

/**
 * Won't do (N1.2, N8): the pure parts both the app and the main process use.
 */

/**
 * A task's open subtasks at every depth, from a list of live tasks: the ones
 * that are not done. A done subtask's own open subtasks still count. The
 * main process closes exactly these with `includeSubtasks`, and the dialog
 * counts them, so the number it shows is the number closed.
 */
export function openSubtasksOf(
  liveItems: readonly PlanningWorkItem[],
  workItemId: string
): PlanningWorkItem[] {
  const children = new Map<string, PlanningWorkItem[]>()
  for (const candidate of liveItems) {
    if (!candidate.parentWorkItemId || candidate.archivedAt || candidate.deletedAt) continue
    const list = children.get(candidate.parentWorkItemId)
    if (list) list.push(candidate)
    else children.set(candidate.parentWorkItemId, [candidate])
  }
  const found: PlanningWorkItem[] = []
  const seen = new Set<string>([workItemId])
  const visit = (id: string): void => {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      if (child.status !== 'done') found.push(child)
      visit(child.id)
    }
  }
  visit(workItemId)
  return found
}

/** Whether a task can be offered Won't do: open, not done, not already closed. */
export function canCloseAsWontDo(item: PlanningWorkItem, status = item.status): boolean {
  return status !== 'done' && !item.archivedAt && !item.deletedAt && !item.resolution
}
