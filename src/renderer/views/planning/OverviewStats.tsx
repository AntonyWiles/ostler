import { formatDays, overviewStats } from '@shared/planning/stats'
import type { PlanningWorkspace } from '../../hooks/usePlanningWorkspace'
import { toIsoDate } from '../../ui'
import { t } from '@shared/i18n'

/**
 * The Overview's four numbers as tiles. The rest live in Insights below the
 * work lists (P6.2), which replaced the "More numbers" popover.
 */
export function OverviewStats({ ws }: { ws: PlanningWorkspace }) {
  const scoped = ws.subprojectScope != null
  const stats = overviewStats(ws.workItems, ws.projectMetrics, Date.now(), toIsoDate(new Date()))

  return (
    // The group's role sits on the wrapper: a role on the <dl> itself would
    // strip its terms and values of their list (P9.2).
    <div
      className="overview-stats"
      role="group"
      aria-label={t('tasks:overviewStats.projectNumbers')}
    >
      <dl className="overview-stats__tiles">
        <StatTile label={t('tasks:overviewStats.open')} value={String(stats.open)} />
        {/* Done this week and cycle time are the whole project's metrics, so a workstream omits them. */}
        {!scoped && (
          <StatTile label={t('tasks:overviewStats.doneWeek')} value={String(stats.doneThisWeek)} />
        )}
        <StatTile
          label={t('tasks:overviewStats.overdue')}
          value={String(stats.overdue)}
          tone={stats.overdue > 0 ? 'danger' : undefined}
        />
        {!scoped && (
          <StatTile
            label={t('tasks:overviewStats.averageCycleTime')}
            value={formatDays(stats.averageCycleTimeMs)}
          />
        )}
      </dl>
    </div>
  )
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    // Nothing to count ("0", "—") reads quietly, so a number worth seeing stands out.
    <div
      className="overview-stats__tile"
      data-tone={tone}
      data-empty={value === '0' || value === '—' ? true : undefined}
    >
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
