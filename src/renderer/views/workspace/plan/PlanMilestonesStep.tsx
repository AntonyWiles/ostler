import { useNavigate } from 'react-router-dom'
import { isCountedTask } from '@shared/planning/plan-steps'
import { projectPath } from '../../../navigation/paths'
import { MilestoneDue } from '../../planning/MilestoneDue'
import { Button, EmptyState } from '../../../ui'
import { Plus } from '../../../ui/icons'
import type { PlanStepProps } from './plan-step-props'
import { t } from '@shared/i18n'

/** The Milestones step: each milestone's goal, date and tasks, and ways to add to them. */
export function PlanMilestonesStep({ project, ws, progress }: PlanStepProps) {
  const navigate = useNavigate()
  const milestones = ws.milestones.filter((milestone) => milestone.status !== 'archived')
  const addMilestone = () => ws.setCreateMode('milestone')

  if (milestones.length === 0) {
    return (
      <EmptyState
        headingLevel={3}
        title={t('views:planView.milestones.emptyTitle')}
        description={t('views:planView.milestones.emptyDescription')}
        action={
          <Button variant="primary" icon={Plus} onClick={addMilestone}>
            {t('views:planView.milestones.add')}
          </Button>
        }
      />
    )
  }

  const goalTitles = new Map(ws.goals.map((goal) => [goal.id, goal.title]))
  const taskCounts = new Map<string, number>()
  for (const item of ws.workItems) {
    if (item.milestoneId === null || !isCountedTask(item)) continue
    taskCounts.set(item.milestoneId, (taskCounts.get(item.milestoneId) ?? 0) + 1)
  }

  return (
    <div className="plan-step">
      {progress.emptyMilestoneIds.length > 0 && (
        <p className="plan-step__note">
          {t('views:planView.milestones.empty', { count: progress.emptyMilestoneIds.length })}
        </p>
      )}
      <ul className="plan-step__list">
        {milestones.map((milestone) => {
          const goal = milestone.goalId === null ? undefined : goalTitles.get(milestone.goalId)
          return (
            <li key={milestone.id} className="plan-step__item">
              <div className="plan-step__item-head">
                <span className="plan-step__item-name">{milestone.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Plus}
                  aria-label={t('views:planView.milestones.addTaskTo', {
                    milestone: milestone.name
                  })}
                  onClick={() => ws.openWorkItemCreate('backlog', milestone.id)}
                >
                  {t('views:gettingStartedCard.addTask')}
                </Button>
              </div>
              <p className="plan-step__item-meta">
                <span>
                  {goal === undefined
                    ? t('views:planView.milestones.noGoal')
                    : t('views:planView.milestones.forGoal', { goal })}
                </span>
                <MilestoneDue milestone={milestone} />
                <span>
                  {t('views:planView.milestones.taskCount', {
                    count: taskCounts.get(milestone.id) ?? 0
                  })}
                </span>
              </p>
            </li>
          )
        })}
      </ul>
      <div className="plan-step__actions">
        <Button icon={Plus} onClick={addMilestone}>
          {t('views:planView.milestones.add')}
        </Button>
        <Button variant="ghost" onClick={() => navigate(projectPath(project.id, 'milestones'))}>
          {t('views:planView.milestones.open')}
        </Button>
      </div>
    </div>
  )
}
