import type {
  HarnessProjectState,
  PlanningAggregateMetrics,
  PlanningMilestone,
  PlanningReadinessReport,
  PlanningWorkItem
} from '@shared/ostler-api'
import { todayIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import { milestoneHealth, milestoneOverdue } from '@shared/planning/health'

export interface PortfolioProjectInput {
  projectId: string
  projectName: string
  workItems: PlanningWorkItem[]
  milestones: PlanningMilestone[]
  metrics: PlanningAggregateMetrics
  readiness: PlanningReadinessReport[]
  harness: HarnessProjectState | null
  now?: number
}

export type PortfolioRiskCode = 'no-active-work' | 'overdue-milestones' | 'stale-review-backlog'

export interface PortfolioRiskFlag {
  code: PortfolioRiskCode
  label: string
  evidence: string
}

export interface PortfolioProjectSummary {
  projectId: string
  projectName: string
  metrics: PlanningAggregateMetrics
  /** Live tasks by state, from the work items themselves. */
  taskCount: number
  doneCount: number
  blockedCount: number
  activeSessions: number
  reviewSessions: number
  risks: PortfolioRiskFlag[]
  readiness: { pass: number; warning: number; fail: number }
  /** The open milestone with the soonest date (N5.3), or null when none has one. */
  nextMilestone: { id: string; name: string; targetDate: string } | null
}

/** The open (planned or active) milestone with the soonest date, for the board of projects. */
export function nextMilestone(
  milestones: PlanningMilestone[]
): PortfolioProjectSummary['nextMilestone'] {
  let next: PortfolioProjectSummary['nextMilestone'] = null
  for (const milestone of milestones) {
    if (milestone.status !== 'planned' && milestone.status !== 'active') continue
    if (!milestone.targetDate) continue
    if (next === null || milestone.targetDate < next.targetDate) {
      next = { id: milestone.id, name: milestone.name, targetDate: milestone.targetDate }
    }
  }
  return next
}

export interface PortfolioSummary {
  projects: PortfolioProjectSummary[]
  activeSessions: number
  risks: number
}

export function derivePortfolioRisks(input: PortfolioProjectInput): PortfolioRiskFlag[] {
  const now = input.now ?? Date.now()
  const risks: PortfolioRiskFlag[] = []
  const active = input.workItems.some((item) => item.status === 'active' || item.status === 'ready')
  if (!active && input.workItems.some((item) => item.status !== 'done')) {
    risks.push({
      code: 'no-active-work',
      label: t('tasks:portfolioAggregation.nothingProgress'),
      evidence: t('tasks:portfolioAggregation.thereUnfinishedTasksBut')
    })
  }
  // The milestone health rule: one whose linked work is all done is waiting to
  // be closed, not late, so it is not counted as overdue here either.
  const today = todayIsoDate(new Date(now))
  const overdue = input.milestones.filter((milestone) => {
    if (!milestoneOverdue(milestone, today)) return false
    const linked = input.workItems.filter((item) => item.milestoneId === milestone.id)
    return (
      milestoneHealth({
        linkedCount: linked.length,
        blockedCount: linked.filter((item) => item.status === 'blocked').length,
        overdue: true,
        doneCount: linked.filter((item) => item.status === 'done').length,
        open: true
      }).health !== 'ready-to-close'
    )
  })
  if (overdue.length)
    risks.push({
      code: 'overdue-milestones',
      label: t('tasks:portfolioAggregation.overdueMilestones'),
      evidence: t('tasks:portfolioAggregation.milestonesPastTheirDue', { count: overdue.length })
    })
  const staleReview = input.workItems.filter(
    (item) => item.status === 'review' && now - item.updatedAt >= 7 * 86_400_000
  )
  if (staleReview.length)
    risks.push({
      code: 'stale-review-backlog',
      label: t('tasks:portfolioAggregation.tasksWaitingLongReview'),
      evidence: t('tasks:portfolioAggregation.tasksReviewHaveBeen', { count: staleReview.length })
    })
  return risks
}

export function aggregatePortfolio(inputs: PortfolioProjectInput[]): PortfolioSummary {
  const projects = inputs.map((input) => {
    const harness = input.harness
    const readiness = input.readiness.reduce(
      (counts, report) => {
        report.checks.forEach((check) => {
          counts[check.state] += 1
        })
        return counts
      },
      { pass: 0, warning: 0, fail: 0 }
    )
    return {
      projectId: input.projectId,
      projectName: input.projectName,
      metrics: input.metrics,
      taskCount: input.workItems.length,
      doneCount: input.workItems.filter((item) => item.status === 'done').length,
      blockedCount: input.workItems.filter((item) => item.status === 'blocked').length,
      activeSessions: harness?.activeSessions.length ?? 0,
      reviewSessions: harness?.reviewSessions.length ?? 0,
      risks: derivePortfolioRisks(input),
      readiness,
      nextMilestone: nextMilestone(input.milestones)
    }
  })
  return {
    projects,
    activeSessions: projects.reduce((sum, project) => sum + project.activeSessions, 0),
    risks: projects.reduce((sum, project) => sum + project.risks.length, 0)
  }
}
