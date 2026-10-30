import type { PlanningMilestone } from '@shared/ostler-api'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { Button, Card, ProgressBar, Section, toIsoDate } from '../../ui'
import { HealthBadge } from './HealthBadge'
import { MilestoneDue } from './MilestoneDue'
import { milestoneProgress } from './milestone-progress'
import { t } from '@shared/i18n'
import { HEALTH_TONE } from '@shared/planning/health'

/**
 * Open milestones (active first), each with its progress, due date and
 * health. A project without milestones doesn't show it: they are made from
 * New or the Milestones view.
 */
export function MilestonesGlance({
  ws,
  onOpenMilestones
}: {
  ws: PlanningWorkspace
  onOpenMilestones: () => void
}) {
  const today = toIsoDate(new Date())
  const open = ws.milestones
    .filter((milestone) => milestone.status === 'active' || milestone.status === 'planned')
    .sort(byActiveThenDue)
  if (ws.milestones.length === 0) return null

  return (
    <Section
      title={t('tasks:milestonesGlance.milestonesGlance')}
      actions={
        <Button variant="ghost" size="sm" onClick={onOpenMilestones}>
          {t('tasks:milestonesGlance.allMilestones')}
        </Button>
      }
    >
      {open.length === 0 ? (
        <Card>
          <p className="overview-quiet">{t('tasks:milestonesGlance.noOpenMilestones')}</p>
        </Card>
      ) : (
        <ul className="overview-milestones" aria-label={t('tasks:milestonesGlance.openMilestones')}>
          {open.map((milestone) => {
            const progress = milestoneProgress(milestone, ws.workItems, ws.projectedStatus, today)
            return (
              <li key={milestone.id}>
                <Card className="overview-milestone">
                  <div className="overview-milestone__head">
                    <span className="overview-milestone__name" title={milestone.name}>
                      {milestone.name}
                    </span>
                    <HealthBadge verdict={progress.health} />
                  </div>
                  <ProgressBar
                    label={t('tasks:milestonesGlance.progress', { milestoneName: milestone.name })}
                    value={progress.byStatus.done.length}
                    max={Math.max(progress.linked.length, 1)}
                    valueText={t('tasks:milestonesGlance.done', {
                      doneCount: progress.byStatus.done.length,
                      linkedCount: progress.linked.length
                    })}
                    tone={HEALTH_TONE[progress.health.health] === 'success' ? 'success' : 'accent'}
                  />
                  <div className="overview-milestone__meta">
                    <span>
                      {t('tasks:milestonesGlance.done', {
                        doneCount: progress.byStatus.done.length,
                        linkedCount: progress.linked.length
                      })}
                    </span>
                    <MilestoneDue milestone={milestone} />
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

function byActiveThenDue(left: PlanningMilestone, right: PlanningMilestone): number {
  if (left.status !== right.status) return left.status === 'active' ? -1 : 1
  if (left.targetDate && right.targetDate) return left.targetDate.localeCompare(right.targetDate)
  if (left.targetDate) return -1
  if (right.targetDate) return 1
  return left.name.localeCompare(right.name)
}
