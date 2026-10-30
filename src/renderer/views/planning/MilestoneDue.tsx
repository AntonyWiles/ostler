import type { PlanningMilestone } from '@shared/ostler-api'
import { cardDue } from './card-due'
import './MilestoneDue.css'
import { t } from '@shared/i18n'

/** "Due Tomorrow", "Due 12 Nov", or "No due date", toned like a card's due date. */
export function MilestoneDue({ milestone }: { milestone: PlanningMilestone }) {
  if (!milestone.targetDate)
    return <span className="milestone-due">{t('tasks:milestoneDue.noDueDate')}</span>
  const due = cardDue(
    milestone.targetDate,
    milestone.status === 'complete' || milestone.status === 'archived'
  )
  if (!due)
    return (
      <span className="milestone-due">
        {t('tasks:milestoneDue.due', { targetDate: milestone.targetDate })}
      </span>
    )
  return (
    <span className="milestone-due" data-tone={due.tone} title={due.title}>
      {t('tasks:milestoneDue.due2', { dueText: due.text })}
    </span>
  )
}
