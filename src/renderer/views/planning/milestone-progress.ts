import type {
  PlanningMilestone,
  PlanningWorkItem,
  PlanningWorkItemStatus
} from '@shared/ostler-api'
import { milestoneHealth, milestoneOverdue, type HealthVerdict } from '@shared/planning/health'

export interface MilestoneProgress {
  linked: PlanningWorkItem[]
  byStatus: Record<PlanningWorkItemStatus, PlanningWorkItem[]>
  /** Done of linked, 0 to 100. */
  percent: number
  overdue: boolean
  health: HealthVerdict
}

/**
 * A milestone's linked tasks by (projected) status, its progress and its
 * health: one derivation for the Milestones view and the Overview's glance.
 */
export function milestoneProgress(
  milestone: PlanningMilestone,
  workItems: PlanningWorkItem[],
  statusOf: (item: PlanningWorkItem) => PlanningWorkItemStatus,
  today: string
): MilestoneProgress {
  const linked = workItems.filter((item) => item.milestoneId === milestone.id)
  const byStatus: Record<PlanningWorkItemStatus, PlanningWorkItem[]> = {
    backlog: [],
    ready: [],
    active: [],
    blocked: [],
    review: [],
    done: []
  }
  for (const item of linked) byStatus[statusOf(item)].push(item)
  const overdue = milestoneOverdue(milestone, today)
  return {
    linked,
    byStatus,
    percent: linked.length === 0 ? 0 : Math.round((byStatus.done.length / linked.length) * 100),
    overdue,
    health: milestoneHealth({
      linkedCount: linked.length,
      blockedCount: byStatus.blocked.length,
      overdue,
      doneCount: byStatus.done.length,
      open: milestone.status !== 'complete' && milestone.status !== 'archived'
    })
  }
}
