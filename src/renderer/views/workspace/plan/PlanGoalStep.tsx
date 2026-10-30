import { ProjectBriefCard } from '../../project-detail/ProjectBriefCard'
import { Badge, Button, EmptyState } from '../../../ui'
import { Plus } from '../../../ui/icons'
import type { PlanStepProps } from './plan-step-props'
import { t } from '@shared/i18n'

/** The Goal step: the project's goals, a way to add one, and its brief. */
export function PlanGoalStep({ project, ws }: PlanStepProps) {
  const goals = ws.goals.filter((goal) => goal.status !== 'archived')
  const addGoal = () => ws.setCreateMode('goal')

  return (
    <>
      {goals.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title={t('views:planView.goal.emptyTitle')}
          description={t('views:planView.goal.emptyDescription')}
          action={
            <Button variant="primary" icon={Plus} onClick={addGoal}>
              {t('views:planView.goal.add')}
            </Button>
          }
        />
      ) : (
        <div className="plan-step">
          <ul className="plan-step__list">
            {goals.map((goal) => (
              <li key={goal.id} className="plan-step__item">
                <div className="plan-step__item-head">
                  <span className="plan-step__item-name">{goal.title}</span>
                  {goal.status === 'achieved' && (
                    <Badge tone="success">{t('views:planView.goal.achieved')}</Badge>
                  )}
                </div>
                <p className="plan-step__item-meta">
                  {goal.outcome.trim() || t('views:planView.goal.noOutcome')}
                </p>
              </li>
            ))}
          </ul>
          <div className="plan-step__actions">
            <Button icon={Plus} onClick={addGoal}>
              {t('views:planView.goal.add')}
            </Button>
          </div>
        </div>
      )}
      <ProjectBriefCard projectId={project.id} />
    </>
  )
}
