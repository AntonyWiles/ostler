import { Suspense, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { criticalPath } from '@shared/planning/critical-path'
import { formatIsoDate } from '@shared/dates'
import { lazyNamed } from '../../../lib/lazy-named'
import { projectPath } from '../../../navigation/paths'
import { Button } from '../../../ui'
import type { PlanningWorkspace } from '../../../hooks/usePlanningWorkspace'
import type { PlanStepProps } from './plan-step-props'
import { t } from '@shared/i18n'

const SaveBaselineDialog = lazyNamed(
  () => import('../../planning/baselines/BaselineDialogs'),
  'SaveBaselineDialog'
)

/** How many tasks each group lists before "and N more". */
const TASKS_SHOWN = 10

/**
 * The Schedule step: when the plan finishes, by the Timeline's critical path,
 * and the tasks the step's rules flag (no date, before what they wait on, after
 * their milestone), each opening its drawer. The Timeline fixes them.
 */
export function PlanScheduleStep({ project, ws, progress }: PlanStepProps) {
  const navigate = useNavigate()
  const [savingBaseline, setSavingBaseline] = useState(false)

  // The same tasks, with the same statuses, as the Timeline gives the rule.
  const path = useMemo(
    () =>
      criticalPath(
        ws.workItems
          .filter((item) => item.archivedAt == null && item.deletedAt == null)
          .map((item) => ({ ...item, status: ws.projectedStatus(item) }))
      ),
    [ws.workItems, ws.projectedStatus]
  )
  const criticalCount = path.tasks.filter((task) => task.critical).length
  const nothingToFix =
    progress.scheduleIssueCount === 0 &&
    progress.undatedMilestoneCount === 0 &&
    progress.taskCount > 0

  return (
    <div className="plan-step">
      {path.end && (
        <div className="plan-schedule__finish">
          <p className="plan-schedule__finish-date">
            {t('views:planView.schedule.finishes', { date: formatIsoDate(path.end) })}
          </p>
          <p className="plan-step__note">
            {t('views:planView.schedule.setBy', { count: criticalCount })}
          </p>
        </div>
      )}

      <TaskGroup
        ws={ws}
        ids={progress.unscheduledTaskIds}
        heading={t('views:planView.schedule.unscheduledHeading')}
        line={(count) => t('views:planView.schedule.unscheduled', { count })}
      />
      <TaskGroup
        ws={ws}
        ids={progress.orderConflictTaskIds}
        heading={t('views:planView.schedule.orderHeading')}
        line={(count) => t('views:planView.schedule.order', { count })}
      />
      <TaskGroup
        ws={ws}
        ids={progress.lateForMilestoneTaskIds}
        heading={t('views:planView.schedule.lateHeading')}
        line={(count) => t('views:planView.schedule.late', { count })}
      />

      {progress.undatedMilestoneCount > 0 && (
        <div className="plan-step__actions">
          <p className="plan-step__note">
            {t('views:planView.schedule.undatedMilestones', {
              count: progress.undatedMilestoneCount
            })}
          </p>
          <Button size="sm" onClick={() => navigate(projectPath(project.id, 'milestones'))}>
            {t('views:planView.milestones.open')}
          </Button>
        </div>
      )}

      {nothingToFix && <p className="plan-step__note">{t('views:planView.schedule.allSet')}</p>}

      {progress.taskCount > 0 && (
        <div className="plan-step__actions">
          <Button
            variant={nothingToFix ? 'secondary' : 'primary'}
            onClick={() => navigate(projectPath(project.id, 'timeline'))}
          >
            {t('views:planView.schedule.openTimeline')}
          </Button>
        </div>
      )}

      {progress.done.schedule && (
        <div className="plan-tasks__group">
          <div className="plan-step__actions">
            <Button onClick={() => setSavingBaseline(true)}>{t('views:baselines.save')}</Button>
          </div>
          <p className="plan-tasks__hint">{t('views:planView.schedule.baselineHint')}</p>
        </div>
      )}

      {savingBaseline && (
        <Suspense fallback={null}>
          <SaveBaselineDialog projectId={project.id} onClose={() => setSavingBaseline(false)} />
        </Suspense>
      )}
    </div>
  )
}

/** One kind of schedule problem: its heading, a count line and its first tasks. */
function TaskGroup({
  ws,
  ids,
  heading,
  line
}: {
  ws: PlanningWorkspace
  ids: readonly string[]
  heading: string
  line: (count: number) => string
}) {
  if (ids.length === 0) return null
  const byId = new Map(ws.workItems.map((item) => [item.id, item]))
  const shown = ids.slice(0, TASKS_SHOWN).flatMap((id) => {
    const item = byId.get(id)
    return item ? [item] : []
  })
  return (
    <div className="plan-tasks__group">
      <h3 className="plan-tasks__heading">{heading}</h3>
      <p className="plan-step__note">{line(ids.length)}</p>
      <ul className="plan-tasks__loose">
        {shown.map((item) => (
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
      {ids.length > TASKS_SHOWN && (
        <p className="plan-step__note">
          {t('views:planView.tasks.more', { count: ids.length - TASKS_SHOWN })}
        </p>
      )}
    </div>
  )
}
