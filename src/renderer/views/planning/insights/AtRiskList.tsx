import type { ReportAtRisk, ReportTaskRef } from '@shared/ostler-api'
import { Card, StatusBadge, relativeDateText } from '../../../ui'
import { CircleCheck, Icon } from '../../../ui/icons'
import { shortDate } from './report-format'
import { t } from '@shared/i18n'
import { dependencyConflictWords } from '../dependency-link-words'
import { formatList } from '@shared/format'

const DAY = 86_400_000

interface Row {
  key: string
  task?: ReportTaskRef
  title: string
  hint: string
  onOpen?: () => void
}

/**
 * Overdue, long-blocked and conflicting tasks, and milestones behind pace,
 * each task row opening that task. A forecast is a range of days, never a
 * date promise.
 */
export function AtRiskList({
  atRisk,
  now,
  onOpenTask,
  onOpenMilestones
}: {
  atRisk: ReportAtRisk
  now: number
  onOpenTask: (taskId: string) => void
  onOpenMilestones: () => void
}) {
  const groups: Array<{ label: string; rows: Row[] }> = [
    {
      label: t('views:atRiskList.overdue'),
      rows: atRisk.overdue.map((task) => ({
        key: `overdue:${task.id}`,
        task,
        title: task.title,
        hint: task.targetDate ? relativeDateText(task.targetDate) : t('views:atRiskList.overdue'),
        onOpen: () => onOpenTask(task.id)
      }))
    },
    {
      label: t('views:atRiskList.blockedMoreThan3'),
      rows: atRisk.blocked.map((task) => ({
        key: `blocked:${task.id}`,
        task,
        title: task.title,
        hint: t('views:atRiskList.blockedDays', {
          count: Math.floor((now - task.blockedSince) / DAY)
        }),
        onOpen: () => onOpenTask(task.id)
      }))
    },
    {
      label: t('views:atRiskList.dependencyConflicts'),
      rows: atRisk.conflicts.map((conflict) => ({
        key: `conflict:${conflict.task.id}:${conflict.dependency.id}`,
        task: conflict.task,
        title: conflict.task.title,
        hint:
          dependencyConflictWords(conflict.dependency.title, conflict) ??
          t('views:atRiskList.startsBeforeDue', {
            shortDate: shortDate(conflict.start),
            dependencyTitle: conflict.dependency.title,
            shortDate2: shortDate(conflict.dependencyDue)
          }),
        onOpen: () => onOpenTask(conflict.task.id)
      }))
    },
    {
      label: t('views:atRiskList.milestonesLikelyLate'),
      rows: atRisk.lateMilestones.map((milestone) => ({
        key: `milestone:${milestone.milestoneId}`,
        title: milestone.name,
        hint: milestone.reason,
        onOpen: onOpenMilestones
      }))
    }
  ].filter((group) => group.rows.length > 0)

  return (
    <section className="insights-risk" aria-labelledby="insights-risk-title">
      <h3 id="insights-risk-title" className="ui-chart-frame__title">
        {t('views:atRiskList.risk')}
      </h3>
      <p className="ui-chart-frame__summary">{atRisk.summary}</p>
      {groups.length === 0 ? (
        <Card>
          <p className="overview-quiet">
            <Icon icon={CircleCheck} />
            {t('views:atRiskList.nothingNeedsAttentionHere')}
          </p>
        </Card>
      ) : (
        groups.map((group) => (
          <div key={group.label} className="insights-risk__group">
            <h4 className="insights-risk__label">{group.label}</h4>
            <ul className="overview-rows" aria-label={group.label}>
              {group.rows.map((row) => (
                <li key={row.key}>
                  <button type="button" className="overview-row" onClick={row.onOpen}>
                    {row.task && <StatusBadge status={row.task.status} iconOnly />}
                    <span className="overview-row__title" title={row.title}>
                      {row.title}
                    </span>
                    <span className="overview-row__hint">{row.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {atRisk.unforecastMilestones.length > 0 && (
        <p className="overview-muted">
          {t('views:atRiskList.notForecastYetList', {
            milestones: formatList(atRisk.unforecastMilestones.map((milestone) => milestone.name))
          })}{' '}
          {atRisk.unforecastMilestones[0].reason}
        </p>
      )}
    </section>
  )
}
