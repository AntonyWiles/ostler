import type { PlanningWorkItemStatus } from '@shared/ostler-api'
import type { PlanningService } from './planning-service'

/**
 * Moves the planning work item linked to an agent task in step with that
 * task. The one copy for the desktop app, the automation API and the
 * embedded runner. The change is the agent's (P5.2): the run moved the task,
 * whoever pressed the button that ended it. A task already in that status is
 * left alone, so frequent syncs record nothing.
 */
export function syncAgentWorkItemStatus(
  planning: Pick<PlanningService, 'listWorkItems' | 'updateWorkItem'>,
  projectId: string,
  taskId: string | null,
  status: PlanningWorkItemStatus
): void {
  if (!taskId) return
  const linked = planning
    .listWorkItems(projectId)
    .find((item) => item.linkedHarnessTaskId === taskId)
  if (!linked || linked.status === status) return
  planning.updateWorkItem(linked.id, { status }, { kind: 'agent' })
}
