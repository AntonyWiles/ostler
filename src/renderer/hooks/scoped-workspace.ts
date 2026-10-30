import type { PlanningWorkspace } from './usePlanningWorkspace'
import type { ProjectViewId } from '../navigation/registry'

/**
 * Views whose tasks and milestones come from `ws` as they are, not through a task filter
 * (`applyTaskFilters`, which applies the scope itself).
 */
const READS_WORKSPACE_DIRECTLY: ReadonlySet<ProjectViewId> = new Set([
  'overview',
  'plan',
  'milestones',
  'matrix',
  'triage',
  'someday',
  'archive'
])

/**
 * `ws` as a view scoped to one sub-project (a workstream) should see it: the tasks and milestones
 * in that sub-project only. Goals, decisions and the rest stay the project's. Returns `ws` itself
 * when the view is not scoped, or reads its tasks through a filter.
 */
export function scopedWorkspace(ws: PlanningWorkspace, view: ProjectViewId): PlanningWorkspace {
  const scope = ws.subprojectScope
  if (!scope || !READS_WORKSPACE_DIRECTLY.has(view)) return ws
  const inScope = (item: { subprojectId?: string | null }) => item.subprojectId === scope.id
  return {
    ...ws,
    workItems: ws.workItems.filter(inScope),
    // The Overview's work lists come from the whole project's tasks, so they follow the scope too.
    readyNow: ws.readyNow.filter(inScope),
    activeNow: ws.activeNow.filter(inScope),
    blockedNow: ws.blockedNow.filter(inScope),
    milestones: ws.milestones.filter(inScope)
  }
}
