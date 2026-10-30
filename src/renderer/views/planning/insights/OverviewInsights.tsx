import { useMemo, useState } from 'react'
import type { ProjectReport, ReportRange } from '@shared/ostler-api'
import { formatDays } from '@shared/planning/stats'
import { groupRounds } from '@shared/milestone-rounds'
import type { PlanningWorkspace } from '../../../hooks/usePlanningWorkspace'
import {
  Button,
  Checkbox,
  InlineAlert,
  Section,
  SegmentedControl,
  Select,
  Skeleton
} from '../../../ui'
import { CompareRoundsDialog } from '../rounds/CompareRoundsDialog'
import { AtRiskList } from './AtRiskList'
import {
  BurnDownChart,
  BurnUpChart,
  CumulativeFlowChart,
  CycleTimeChart,
  ThroughputChart,
  WorkloadChart,
  type Measure
} from './InsightCharts'
import { useProjectReport } from './useProjectReport'
import { unitWord } from './report-format'
import './Insights.css'
import { formatHours } from '@shared/time/duration'
import { t } from '@shared/i18n'

/**
 * Overview's Insights (P6.2): the project dashboard for a range, from the
 * same report `GET /reports` returns. Key numbers, then burn-up, cumulative
 * flow, throughput, cycle time, workload and the at-risk list. Each chart
 * states its point in one sentence and can be read as a table.
 */
export function OverviewInsights({
  ws,
  onOpenMilestones
}: {
  ws: PlanningWorkspace
  onOpenMilestones: () => void
}) {
  const [range, setRange] = useState<ReportRange>('30d')
  const [measure, setMeasure] = useState<Measure>('estimate')
  const [burnMilestone, setBurnMilestone] = useState<string | null>(null)
  const [comparing, setComparing] = useState(false)
  // Split by type (N2.7b): throughput and cycle time, a series per task type.
  const [splitByType, setSplitByType] = useState(false)
  const revision = useMemo(
    () => [ws.workItems, ws.milestones, ws.iterations, ws.taskTypes],
    [ws.workItems, ws.milestones, ws.iterations, ws.taskTypes]
  )
  const { report, error, loading } = useProjectReport(ws.projectId, range, revision)

  const milestones = ws.milestones.filter((milestone) => milestone.status !== 'archived')
  const rangeOptions = [
    { value: '30d', label: t('views:overviewInsights.last30Days') },
    { value: '90d', label: t('views:overviewInsights.last90Days') },
    // A series of rounds (N5.7a) under its own heading, latest round first.
    ...groupRounds(milestones).flatMap((series) =>
      [series.latest, ...series.earlier].map((milestone) => ({
        value: `milestone:${milestone.id}`,
        label: t('views:overviewInsights.milestone', { milestoneName: milestone.name }),
        ...(series.earlier.length > 0
          ? { group: t('views:overviewInsights.rounds', { name: series.name }) }
          : {})
      }))
    )
  ]
  // Compare rounds (N5.7b) once the range is a round of a series of two or more.
  const chosenId = range.startsWith('milestone:') ? range.slice('milestone:'.length) : null
  const chosenSeries = chosenId
    ? groupRounds(milestones).find(
        (series) =>
          series.earlier.length > 0 &&
          [series.latest, ...series.earlier].some((milestone) => milestone.id === chosenId)
      )
    : undefined
  const anyEstimates = report?.burnUp.some((burn) => burn.defaultMeasure === 'estimate') ?? false
  const units = report ? unitWord(report.estimateUnit) : 'points'

  const openTask = (taskId: string) => {
    const task = ws.workItems.find((item) => item.id === taskId)
    if (task) ws.openWorkItem(task)
  }

  return (
    <Section
      title={t('views:overviewInsights.insights')}
      className="insights"
      description={report ? `${report.rangeLabel}: ${shortRange(report)}` : undefined}
      actions={
        <div className="insights__controls">
          <Select
            label={t('views:overviewInsights.range')}
            hideLabel
            size="sm"
            value={range}
            onChange={(event) => {
              setRange(event.target.value as ReportRange)
              setBurnMilestone(null)
            }}
            options={rangeOptions}
          />
          {chosenSeries && (
            <Button
              size="sm"
              aria-label={t('views:compareRounds.compareNamed', { name: chosenSeries.name })}
              onClick={() => setComparing(true)}
            >
              {t('views:compareRounds.compare')}
            </Button>
          )}
          {report?.throughput.byType && (
            <Checkbox
              label={t('views:overviewInsights.splitByType')}
              className="insights__split"
              checked={splitByType}
              onChange={(event) => setSplitByType(event.target.checked)}
            />
          )}
          <SegmentedControl<Measure>
            label={t('views:overviewInsights.measureWork')}
            size="sm"
            value={measure}
            onChange={setMeasure}
            options={[
              { value: 'count', label: t('views:overviewInsights.tasks') },
              { value: 'estimate', label: t('views:overviewInsights.estimates', { units }) }
            ]}
          />
        </div>
      }
    >
      {error && (
        <InlineAlert tone="danger" title={t('views:overviewInsights.insightsCouldNotWorked')}>
          {error}
        </InlineAlert>
      )}
      {!report && loading && <Skeleton lines={4} />}
      {report && (
        <div className="insights__body" aria-busy={loading || undefined}>
          <KeyNumbers report={report} />
          {measure === 'estimate' && !anyEstimates && report.burnUp.length > 0 && (
            <p className="overview-muted">{t('views:overviewInsights.burnUpShowsTask')}</p>
          )}
          <div className="insights__grid">
            {report.iterationBurndown && (
              <BurnDownChart
                burnDown={report.iterationBurndown}
                measure={measure}
                unit={report.estimateUnit}
              />
            )}
            <BurnUpChart
              burnUps={report.burnUp}
              selectedId={burnMilestone}
              onSelect={setBurnMilestone}
              measure={measure}
              unit={report.estimateUnit}
              pickable={!range.startsWith('milestone:')}
            />
            <CumulativeFlowChart report={report} />
            <ThroughputChart report={report} splitByType={splitByType} />
            <CycleTimeChart report={report} splitByType={splitByType} />
            <WorkloadChart report={report} measure={measure} />
            <AtRiskList
              atRisk={report.atRisk}
              now={report.generatedAt}
              onOpenTask={openTask}
              onOpenMilestones={onOpenMilestones}
            />
          </div>
        </div>
      )}
      {comparing && chosenId && ws.projectId && (
        <CompareRoundsDialog
          projectId={ws.projectId}
          milestoneId={chosenId}
          onClose={() => setComparing(false)}
        />
      )}
    </Section>
  )
}

function shortRange(report: ProjectReport): string {
  return report.from === report.to
    ? report.from
    : t('views:overviewInsights.to', { from: report.from, to: report.to })
}

function KeyNumbers({ report }: { report: ProjectReport }) {
  const numbers = report.keyNumbers
  const sample = (size: number, value: number | null) =>
    size === 0 || value === null ? '—' : formatDays(value)
  const tiles: Array<{ label: string; value: string; hint?: string; tone?: 'danger' }> = [
    { label: t('views:overviewInsights.open'), value: String(numbers.open) },
    { label: t('views:overviewInsights.doneRange'), value: String(numbers.doneInRange) },
    {
      label: t('views:overviewInsights.overdueNow'),
      value: String(numbers.overdueNow),
      tone: numbers.overdueNow > 0 ? 'danger' : undefined
    },
    { label: t('views:overviewInsights.dueNext7Days'), value: String(numbers.dueNext7Days) },
    {
      label: t('views:overviewInsights.medianCycleTime'),
      value: sample(numbers.cycleTimeSampleSize, numbers.cycleTimeMedianMs),
      hint:
        numbers.cycleTimeSampleSize === 0
          ? t('views:overviewInsights.nothingFinishedRange')
          : t('views:overviewInsights.finished', {
              cycleTimeSampleSize: numbers.cycleTimeSampleSize
            })
    },
    {
      label: t('views:overviewInsights.n85FinishWithin'),
      value: sample(numbers.cycleTimeSampleSize, numbers.cycleTimeP85Ms),
      hint:
        numbers.cycleTimeSampleSize === 0
          ? t('views:overviewInsights.nothingFinishedRange')
          : t('views:overviewInsights.startDone')
    },
    {
      label: t('views:overviewInsights.medianLeadTime'),
      value: sample(numbers.leadTimeSampleSize, numbers.leadTimeMedianMs),
      hint:
        numbers.leadTimeSampleSize === 0
          ? t('views:overviewInsights.nothingFinishedRange')
          : t('views:overviewInsights.addedDone')
    },
    // Time logged in the range (R2.3), once the project has any time entries.
    ...(numbers.timeLoggedSeconds === undefined
      ? []
      : [
          {
            label: t('views:overviewInsights.timeLogged'),
            value: formatHours(numbers.timeLoggedSeconds)
          }
        ])
  ]
  return (
    // The group's role sits on a wrapper: on the <dl> itself it would strip
    // the terms and values of their list (P9.2).
    <div role="group" aria-label={t('views:overviewInsights.keyNumbers')}>
      <dl className="insights__numbers">
        {tiles.map((tile) => (
          <div key={tile.label} className="insights__tile" data-tone={tile.tone}>
            <dt>{tile.label}</dt>
            <dd className="insights__value">{tile.value}</dd>
            {tile.hint && <dd className="insights__hint">{tile.hint}</dd>}
          </div>
        ))}
      </dl>
    </div>
  )
}
