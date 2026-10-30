import { t } from '../i18n' /**
 * Milestone and project health: one
 * deterministic rule for every surface that shows it, so the Overview, the
 * Milestones view and Home never disagree. On track is success, at risk is
 * warning, blocked is danger. "On track" is never orange.
 */
export type Health = 'on-track' | 'at-risk' | 'blocked' | 'no-work' | 'ready-to-close'

export type HealthTone = 'success' | 'warning' | 'danger' | 'neutral'

export const HEALTH_TONE: Record<Health, HealthTone> = {
  'on-track': 'success',
  'at-risk': 'warning',
  blocked: 'danger',
  'no-work': 'neutral',
  'ready-to-close': 'success'
}

export const HEALTH_LABEL: Record<Health, string> = {
  get 'on-track'() {
    return t('tasks:health.track')
  },
  get 'at-risk'() {
    return t('tasks:health.risk')
  },
  get blocked() {
    return t('tasks:health.blocked')
  },
  get 'no-work'() {
    return t('tasks:health.noLinkedTasks')
  },
  get 'ready-to-close'() {
    return t('tasks:health.readyToClose')
  }
}

export interface HealthVerdict {
  health: Health
  /** Why, in words: the badge's tooltip. */
  reason: string
}

/**
 * A milestone's health from its linked tasks. Blocked work stops a milestone
 * whatever the date says, so it wins. An open milestone whose linked work is
 * all done is not "on track" towards anything: the question is whether to
 * close it, and that beats a due date there is nothing left to miss. A missed
 * due date is a risk; a milestone with nothing linked has nothing to measure.
 */
export function milestoneHealth(input: {
  linkedCount: number
  blockedCount: number
  overdue: boolean
  /** Linked tasks that are done. */
  doneCount?: number
  /** False once the milestone is complete or archived. */
  open?: boolean
}): HealthVerdict {
  if (input.blockedCount > 0)
    return {
      health: 'blocked',
      reason: t('tasks:health.linkedTasksBlocked', { count: input.blockedCount })
    }
  if (input.open !== false && input.linkedCount > 0 && input.doneCount === input.linkedCount)
    return { health: 'ready-to-close', reason: t('tasks:health.everyLinkedTaskDone') }
  if (input.overdue) return { health: 'at-risk', reason: t('tasks:health.pastDueDate') }
  if (input.linkedCount === 0)
    return { health: 'no-work', reason: t('tasks:health.noTasksLinkedSo') }
  return { health: 'on-track', reason: t('tasks:health.nothingBlockedNotPast') }
}

/** Whether an open milestone's due date (`YYYY-MM-DD`) is before today. */
export function milestoneOverdue(
  milestone: { targetDate: string | null; status: string },
  today: string
): boolean {
  return (
    milestone.targetDate !== null &&
    milestone.status !== 'complete' &&
    milestone.status !== 'archived' &&
    milestone.targetDate < today
  )
}

/** A project's health from its blocked tasks and its risk flags (portfolio-aggregation). */
export function projectHealth(input: {
  blockedCount: number
  risks: { label: string }[]
}): HealthVerdict {
  if (input.blockedCount > 0)
    return {
      health: 'blocked',
      reason: t('tasks:health.tasksBlocked', { count: input.blockedCount })
    }
  if (input.risks.length > 0)
    return { health: 'at-risk', reason: input.risks.map((risk) => risk.label).join(' · ') }
  return { health: 'on-track', reason: t('tasks:health.noBlockedTasksNo') }
}
