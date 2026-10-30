import { Suspense, useState } from 'react'
import { isCountedTask } from '@shared/planning/plan-steps'
import { useOstler } from '../../../context/OstlerContext'
import { lazyNamed } from '../../../lib/lazy-named'
import { canPlanAndSplit, useFeatures } from '../../../navigation/features'
import { Button, Skeleton } from '../../../ui'
import { Plus } from '../../../ui/icons'
import type { PlanStepProps } from './plan-step-props'
import { t } from '@shared/i18n'

const ProjectNotesChat = lazyNamed(
  () => import('../../../components/ProjectNotesChat'),
  'ProjectNotesChat'
)

/** How many tasks not in a milestone the pane lists before "and N more". */
const LOOSE_TASKS_SHOWN = 10

/**
 * The Tasks step: every way to add tasks in one place — the plan grid, the
 * new task form, AI suggestions and breakdowns, and the notes chat — with the
 * empty milestones and loose tasks that keep the step to do.
 */
export function PlanTasksStep({ project, ws, suggestTasks, progress }: PlanStepProps) {
  const features = useFeatures()
  const { refreshProjects } = useOstler()
  const [talking, setTalking] = useState(false)

  const emptyIds = new Set(progress.emptyMilestoneIds)
  const emptyMilestones = ws.milestones.filter((milestone) => emptyIds.has(milestone.id))
  const activeGoals = ws.goals.filter((goal) => goal.status === 'active')
  const looseTasks = ws.workItems.filter((item) => item.milestoneId === null && isCountedTask(item))
  const hasTasks = progress.taskCount > 0

  return (
    <div className="plan-step">
      {hasTasks && (
        <p className="plan-step__note">
          {t('views:planView.tasks.counts', {
            count: progress.taskCount,
            withoutMilestone: progress.tasksWithoutMilestoneCount
          })}
        </p>
      )}

      <div className="plan-tasks__tools">
        <div className="plan-step__actions">
          <Button variant="primary" onClick={() => ws.setPlanGridOpen(true)}>
            {t('navigation:projectWorkspace.planTasks')}
          </Button>
          <Button icon={Plus} onClick={() => ws.openWorkItemCreate()}>
            {t('views:gettingStartedCard.addTask')}
          </Button>
          {features.ai && (
            <Button variant="ai" loading={suggestTasks.busy} onClick={suggestTasks.start}>
              {t('views:planView.tasks.suggest')}
            </Button>
          )}
        </div>
        <p className="plan-tasks__hint">{t('views:planView.tasks.gridHint')}</p>
      </div>

      {emptyMilestones.length > 0 && (
        <div className="plan-tasks__group">
          <p className="plan-step__note">
            {t('views:planView.milestones.empty', { count: emptyMilestones.length })}
          </p>
          <ul className="plan-step__list">
            {emptyMilestones.map((milestone) => (
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
              </li>
            ))}
          </ul>
        </div>
      )}

      {features.ai && activeGoals.length > 0 && (
        <div className="plan-tasks__group">
          <h3 className="plan-tasks__heading">{t('views:planView.tasks.fromGoals')}</h3>
          <ul className="plan-step__list">
            {activeGoals.map((goal) => (
              <li key={goal.id} className="plan-step__item">
                <div className="plan-step__item-head">
                  <span className="plan-step__item-name">{goal.title}</span>
                  <span className="plan-step__actions">
                    <Button
                      variant="ai"
                      size="sm"
                      aria-label={t('views:planView.tasks.breakDownGoal', { goal: goal.title })}
                      loading={ws.isBusyOn(goal.id)}
                      disabled={ws.busy}
                      onClick={() => void ws.breakDownGoal(goal)}
                    >
                      {t('tasks:goalsMilestonesPanel.breakDownAi')}
                    </Button>
                    {canPlanAndSplit(features) && (
                      <Button
                        size="sm"
                        aria-label={t('views:planView.tasks.planSplitGoal', { goal: goal.title })}
                        disabled={ws.busy}
                        onClick={() => ws.openAgentPlanWizard(goal)}
                      >
                        {t('tasks:goalsMilestonesPanel.planSplit')}
                      </Button>
                    )}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasTasks && looseTasks.length > 0 && (
        <div className="plan-tasks__group">
          <h3 className="plan-tasks__heading">{t('views:planView.tasks.withoutMilestone')}</h3>
          <ul className="plan-tasks__loose">
            {looseTasks.slice(0, LOOSE_TASKS_SHOWN).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="plan-tasks__task"
                  onClick={() => ws.openWorkItem(item)}
                >
                  {item.title}
                </button>
              </li>
            ))}
          </ul>
          {looseTasks.length > LOOSE_TASKS_SHOWN && (
            <p className="plan-step__note">
              {t('views:planView.tasks.more', { count: looseTasks.length - LOOSE_TASKS_SHOWN })}
            </p>
          )}
        </div>
      )}

      {hasTasks && features.ai && (
        <div className="plan-tasks__group">
          <div>
            <Button
              variant="ghost"
              aria-expanded={talking}
              onClick={() => setTalking((open) => !open)}
            >
              {t('views:planView.tasks.talk')}
            </Button>
          </div>
          {talking && (
            <Suspense fallback={<Skeleton lines={3} />}>
              <ProjectNotesChat
                projectId={project.id}
                projectName={project.name}
                onStatusSaved={() => void refreshProjects()}
              />
            </Suspense>
          )}
        </div>
      )}
    </div>
  )
}
