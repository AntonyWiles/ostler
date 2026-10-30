import { useNavigate } from 'react-router-dom'
import { formatIsoDate } from '@shared/dates'
import { formatNumber } from '@shared/format'
import { isCountedTask } from '@shared/planning/plan-steps'
import { usePeople } from '../../../context/PeopleContext'
import { settingsPath, workloadPath } from '../../../navigation/paths'
import { Button, InlineAlert, Skeleton } from '../../../ui'
import type { PlanStepProps } from './plan-step-props'
import { t } from '@shared/i18n'

/** How many rows each list shows before "and N more". */
const SHOWN = 10

/**
 * The People step: the weeks where someone with work here has more than they
 * can do (the Workload view's rule), who has no weekly hours set, and the tasks
 * with nobody on them or no estimate. The Workload view moves the work.
 */
export function PlanPeopleStep({ project, ws, progress, people: planPeople }: PlanStepProps) {
  const navigate = useNavigate()
  const people = usePeople()
  if (!planPeople) return null

  const { overWeeks } = planPeople
  const unassigned = ws.workItems.filter((item) => isCountedTask(item) && item.assigneeId === null)

  return (
    <div className="plan-step">
      {planPeople.loading ? (
        <Skeleton lines={3} />
      ) : planPeople.error !== null ? (
        <InlineAlert tone="danger">
          {t('views:planView.people.loadFailed', { error: planPeople.error })}
        </InlineAlert>
      ) : overWeeks.length > 0 ? (
        <div className="plan-tasks__group">
          <p className="plan-step__note">
            {t('views:planView.people.over', { count: overWeeks.length })}
          </p>
          <ul className="plan-people__over">
            {overWeeks.slice(0, SHOWN).map((entry) => (
              <li key={`${entry.personId} ${entry.week}`}>
                {t('views:planView.people.overRow', {
                  name: people.byId.get(entry.personId)?.name ?? '',
                  hours: formatNumber(entry.over, { maximumFractionDigits: 1 }),
                  date: formatIsoDate(entry.week, { day: 'numeric', month: 'short' })
                })}
              </li>
            ))}
          </ul>
          {overWeeks.length > SHOWN && (
            <p className="plan-step__note">
              {t('views:planView.tasks.more', { count: overWeeks.length - SHOWN })}
            </p>
          )}
        </div>
      ) : (
        <p className="plan-step__note">{t('views:planView.people.noneOver')}</p>
      )}

      {planPeople.noCapacityCount > 0 && (
        <div className="plan-step__actions">
          <p className="plan-step__note">
            {t('views:planView.people.noCapacity', { count: planPeople.noCapacityCount })}
          </p>
          <Button size="sm" variant="ghost" onClick={() => navigate(settingsPath('people'))}>
            {t('views:planView.people.setCapacity')}
          </Button>
        </div>
      )}

      {progress.unassignedTaskCount > 0 && (
        <div className="plan-tasks__group">
          <p className="plan-step__note">
            {t('views:planView.people.unassigned', { count: progress.unassignedTaskCount })}
          </p>
          <ul className="plan-tasks__loose">
            {unassigned.slice(0, SHOWN).map((item) => (
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
          {progress.unassignedTaskCount > SHOWN && (
            <p className="plan-step__note">
              {t('views:planView.tasks.more', { count: progress.unassignedTaskCount - SHOWN })}
            </p>
          )}
        </div>
      )}

      {progress.unestimatedTaskCount > 0 && (
        <p className="plan-step__note">
          {t('views:planView.people.unestimated', { count: progress.unestimatedTaskCount })}
        </p>
      )}

      <div className="plan-step__actions">
        <Button onClick={() => navigate(workloadPath(undefined, { project: project.id }))}>
          {t('views:planView.people.openWorkload')}
        </Button>
      </div>
    </div>
  )
}
