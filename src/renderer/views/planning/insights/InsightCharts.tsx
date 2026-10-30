import type { ReactNode } from 'react'
import type {
  IterationBurndownReport,
  MilestoneBurnUp,
  ProjectReport,
  ReportTypeSeries
} from '@shared/ostler-api'
import { TaskTypeIcon } from '../../../task-types/TaskTypeIcon'
import { isStatusHidden } from '@shared/board-columns'
import { useStatusWords } from '../../../context/ColumnsContext'
import {
  BarChart,
  ChartFrame,
  LineChart,
  Select,
  StackedAreaChart,
  type DataTableColumn
} from '../../../ui'
import { FLOW_ORDER, shortDate, unitWord } from './report-format'
import { t } from '@shared/i18n'

export type Measure = 'count' | 'estimate'

function column<Row>(
  id: string,
  header: string,
  read: (row: Row) => string | number,
  options: { width?: number; numeric?: boolean } = {}
): DataTableColumn<Row> {
  return {
    id,
    header,
    width: options.width ?? (options.numeric ? 110 : 160),
    align: options.numeric ? 'end' : undefined,
    cell: (row) => String(read(row))
  }
}
type BurnRow = { date: string; scope: number | null; done: number | null }

/** Scope against done for one milestone, in tasks or in estimates. */
export function BurnUpChart({
  burnUps,
  selectedId,
  onSelect,
  measure,
  unit,
  pickable
}: {
  burnUps: MilestoneBurnUp[]
  selectedId: string | null
  onSelect: (milestoneId: string) => void
  measure: Measure
  unit: ProjectReport['estimateUnit']
  pickable: boolean
}) {
  const burn = burnUps.find((candidate) => candidate.milestoneId === selectedId) ?? burnUps[0]
  const useEstimates = measure === 'estimate' && burn?.defaultMeasure === 'estimate'
  const units = useEstimates ? unitWord(unit) : t('views:insightCharts.unit.tasks')
  const scope =
    burn?.points.map((point) => (useEstimates ? point.scopeEstimate : point.scopeCount)) ?? []
  const done =
    burn?.points.map((point) => (useEstimates ? point.doneEstimate : point.doneCount)) ?? []
  // Estimates only where every task has one; otherwise counts, and the
  // summary says why.
  const summary = !burn
    ? t('views:insightCharts.noMilestoneHasTasks')
    : useEstimates
      ? (burn.estimateSummary ?? burn.summary)
      : burn.summary
  return (
    <ChartFrame
      title={t('views:insightCharts.burnUp')}
      summary={summary}
      empty={!burn ? t('views:insightCharts.linkTasksMilestoneSee') : undefined}
      legend={[
        { label: t('views:insightCharts.scope', { units }), color: 2, dashed: true },
        { label: t('views:insightCharts.done', { units }), color: 3 }
      ]}
      actions={
        pickable && burnUps.length > 1 ? (
          <Select
            label={t('views:insightCharts.milestone')}
            hideLabel
            size="sm"
            value={burn?.milestoneId ?? ''}
            onChange={(event) => onSelect(event.target.value)}
            options={burnUps.map((candidate) => ({
              value: candidate.milestoneId,
              label: candidate.name
            }))}
          />
        ) : undefined
      }
      table={{
        columns: [
          column<BurnRow>('date', t('views:insightCharts.day'), (row) => row.date, { width: 120 }),
          column<BurnRow>(
            'scope',
            t('views:insightCharts.scope', { units }),
            (row) => row.scope ?? '—',
            {
              numeric: true,
              width: 130
            }
          ),
          column<BurnRow>(
            'done',
            t('views:insightCharts.done', { units }),
            (row) => row.done ?? '—',
            {
              numeric: true,
              width: 130
            }
          )
        ],
        rows: (burn?.points ?? []).map((point, index) => ({
          id: point.date,
          label: point.date,
          row: { date: point.date, scope: scope[index], done: done[index] }
        }))
      }}
    >
      {burn && (
        <LineChart
          categories={burn.points.map((point) => point.date)}
          formatCategory={shortDate}
          series={[
            {
              id: 'scope',
              label: t('views:insightCharts.scope2'),
              color: 2,
              values: scope,
              dashed: true
            },
            {
              id: 'done',
              label: t('views:insightCharts.done2'),
              color: 3,
              values: done,
              area: true
            }
          ]}
        />
      )}
    </ChartFrame>
  )
}

type BurnDownRow = { date: string; remaining: number | null; ideal: number }

/**
 * The active iteration's burn-down (R6.1): remaining work at the end of each
 * day against an ideal straight line to nothing on its last day, in tasks or
 * estimates as the Overview's switch says (estimates only when every task in
 * it has one).
 */
export function BurnDownChart({
  burnDown,
  measure,
  unit
}: {
  burnDown: IterationBurndownReport
  measure: Measure
  unit: ProjectReport['estimateUnit']
}) {
  const useEstimates = measure === 'estimate' && burnDown.defaultMeasure === 'estimate'
  const units = useEstimates ? unitWord(unit) : t('views:insightCharts.unit.tasks')
  const remaining = burnDown.points.map((point) =>
    useEstimates ? point.remainingEstimate : point.remainingCount
  )
  const ideal = burnDown.points.map((point) =>
    useEstimates ? point.idealEstimate : point.idealCount
  )
  const summary = useEstimates ? (burnDown.estimateSummary ?? burnDown.summary) : burnDown.summary
  return (
    <ChartFrame
      title={t('views:insightCharts.burnDown', { name: burnDown.name })}
      summary={
        measure === 'estimate' && !useEstimates
          ? `${summary} ${t('views:insightCharts.burnDownInTasks')}`
          : summary
      }
      legend={[
        { label: t('views:insightCharts.remaining', { units }), color: 1 },
        { label: t('views:insightCharts.ideal', { units }), color: 2, dashed: true }
      ]}
      table={{
        columns: [
          column<BurnDownRow>('date', t('views:insightCharts.day'), (row) => row.date, {
            width: 120
          }),
          column<BurnDownRow>(
            'remaining',
            t('views:insightCharts.remaining', { units }),
            (row) => row.remaining ?? '—',
            { numeric: true, width: 140 }
          ),
          column<BurnDownRow>(
            'ideal',
            t('views:insightCharts.ideal', { units }),
            (row) => row.ideal,
            { numeric: true, width: 140 }
          )
        ],
        rows: burnDown.points.map((point, index) => ({
          id: point.date,
          label: point.date,
          row: { date: point.date, remaining: remaining[index], ideal: ideal[index] }
        }))
      }}
    >
      <LineChart
        categories={burnDown.points.map((point) => point.date)}
        formatCategory={shortDate}
        series={[
          {
            id: 'remaining',
            label: t('views:insightCharts.remaining2'),
            color: 1,
            values: remaining,
            area: true
          },
          {
            id: 'ideal',
            label: t('views:insightCharts.ideal2'),
            color: 2,
            values: ideal,
            dashed: true
          }
        ]}
      />
    </ChartFrame>
  )
}

type FlowRow = { date: string } & ProjectReport['cumulativeFlow']['points'][number]['counts']

export function CumulativeFlowChart({ report }: { report: ProjectReport }) {
  const { points, summary } = report.cumulativeFlow
  // The project's words, and its shown columns: a hidden one still shows
  // while it held tasks in the period (R2.4).
  const words = useStatusWords()
  const flow = FLOW_ORDER.filter(
    ({ status }) =>
      !isStatusHidden(status, words.columns) || points.some((point) => point.counts[status] > 0)
  )
  return (
    <ChartFrame
      title={t('views:insightCharts.cumulativeFlow')}
      summary={summary}
      empty={points.length === 0 ? t('views:insightCharts.addTasksSeeHow') : undefined}
      legend={[...flow].reverse().map(({ status, color }) => ({
        label: words.label(status),
        color
      }))}
      table={{
        columns: [
          column<FlowRow>('date', t('views:insightCharts.day'), (row) => row.date, { width: 120 }),
          ...flow.map(({ status }) =>
            column<FlowRow>(status, words.label(status), (row) => row[status], {
              numeric: true,
              width: 100
            })
          )
        ],
        rows: points.map((point) => ({
          id: point.date,
          label: point.date,
          row: { date: point.date, ...point.counts }
        }))
      }}
    >
      <StackedAreaChart
        categories={points.map((point) => point.date)}
        formatCategory={shortDate}
        series={flow.map(({ status, color }) => ({
          id: status,
          label: words.label(status),
          color,
          values: points.map((point) => point.counts[status])
        }))}
      />
    </ChartFrame>
  )
}

/** A split chart's series colour: the type's own, else a chart slot for "No type" and "Other". */
function seriesColor(series: ReportTypeSeries): number | string {
  return series.color ?? (series.key === 'none' ? 6 : 4)
}

function seriesLegend(byType: ReadonlyArray<{ series: ReportTypeSeries }>) {
  return byType.map(({ series }) => ({
    label: series.name,
    color: seriesColor(series),
    icon:
      series.icon && series.color ? (
        <TaskTypeIcon type={{ name: series.name, icon: series.icon, color: series.color }} />
      ) : undefined
  }))
}

/** The whole chart's sentence, then one per type (N2.7b). */
function splitSummary(summary: string, byType: ReadonlyArray<{ summary: string }>): ReactNode {
  return (
    <>
      {summary}
      {byType.map((part) => (
        <span key={part.summary} className="insights__type-summary">
          {' '}
          {part.summary}
        </span>
      ))}
    </>
  )
}

type CountRow = { label: string; total: number; byType: number[] }

/**
 * Tasks finished per week. `splitByType` (N2.7b) draws a series per task
 * type, from the report's own split, so the numbers are the API's.
 */
export function ThroughputChart({
  report,
  splitByType = false
}: {
  report: ProjectReport
  splitByType?: boolean
}) {
  const { weeks, summary } = report.throughput
  const byType = splitByType ? (report.throughput.byType ?? null) : null
  const rows: CountRow[] = weeks.map((week, index) => ({
    label: week.weekStart,
    total: week.count,
    byType: (byType ?? []).map((part) => part.weeks[index]?.count ?? 0)
  }))
  return (
    <ChartFrame
      title={t('views:insightCharts.throughput')}
      summary={byType ? splitSummary(summary, byType) : summary}
      empty={weeks.length === 0 ? t('views:insightCharts.finishTaskStartCounting') : undefined}
      legend={
        byType
          ? seriesLegend(byType)
          : [{ label: t('views:insightCharts.tasksFinishedPerWeek'), color: 1 }]
      }
      table={{
        columns: [
          column<CountRow>('week', t('views:insightCharts.weekStarting'), (row) => row.label, {
            width: 140
          }),
          ...(byType ?? []).map((part, index) =>
            column<CountRow>(
              `type-${part.series.key}`,
              part.series.name,
              (row) => row.byType[index],
              {
                numeric: true
              }
            )
          ),
          column<CountRow>(
            'count',
            byType ? t('views:insightCharts.allTypes') : t('views:insightCharts.finished'),
            (row) => row.total,
            { numeric: true }
          )
        ],
        rows: rows.map((row) => ({ id: row.label, label: row.label, row }))
      }}
    >
      <BarChart
        categories={weeks.map((week) => week.weekStart)}
        formatCategory={shortDate}
        series={
          byType
            ? byType.map((part) => ({
                id: part.series.key,
                label: part.series.name,
                color: seriesColor(part.series),
                values: part.weeks.map((week) => week.count)
              }))
            : [
                {
                  id: 'finished',
                  label: t('views:insightCharts.finished'),
                  color: 1,
                  values: weeks.map((week) => week.count)
                }
              ]
        }
      />
    </ChartFrame>
  )
}

/** Finished tasks by how long they took; `splitByType` (N2.7b) as for throughput. */
export function CycleTimeChart({
  report,
  splitByType = false
}: {
  report: ProjectReport
  splitByType?: boolean
}) {
  const { buckets, sampleSize, summary } = report.cycleTime
  const byType = splitByType ? (report.cycleTime.byType ?? null) : null
  const rows: CountRow[] = buckets.map((bucket, index) => ({
    label: bucket.label,
    total: bucket.count,
    byType: (byType ?? []).map((part) => part.buckets[index]?.count ?? 0)
  }))
  return (
    <ChartFrame
      title={t('views:insightCharts.cycleTime')}
      summary={byType ? splitSummary(summary, byType) : summary}
      empty={sampleSize === 0 ? t('views:insightCharts.cycleTimeAppearsOnce') : undefined}
      legend={
        byType
          ? seriesLegend(byType)
          : [{ label: t('views:insightCharts.tasksDaysStartDone'), color: 5 }]
      }
      table={{
        columns: [
          column<CountRow>('bucket', t('views:insightCharts.startDone'), (row) => row.label),
          ...(byType ?? []).map((part, index) =>
            column<CountRow>(
              `type-${part.series.key}`,
              part.series.name,
              (row) => row.byType[index],
              {
                numeric: true
              }
            )
          ),
          column<CountRow>(
            'count',
            byType ? t('views:insightCharts.allTypes') : t('views:insightCharts.tasksColumn'),
            (row) => row.total,
            { numeric: true }
          )
        ],
        rows: rows.map((row) => ({ id: row.label, label: row.label, row }))
      }}
    >
      <BarChart
        categories={buckets.map((bucket) => bucket.label)}
        series={
          byType
            ? byType.map((part) => ({
                id: part.series.key,
                label: part.series.name,
                color: seriesColor(part.series),
                values: part.buckets.map((bucket) => bucket.count)
              }))
            : [
                {
                  id: 'tasks',
                  label: t('views:insightCharts.tasks'),
                  color: 5,
                  values: buckets.map((bucket) => bucket.count)
                }
              ]
        }
      />
    </ChartFrame>
  )
}

type WorkloadRowView = ProjectReport['workload']['rows'][number]

export function WorkloadChart({ report, measure }: { report: ProjectReport; measure: Measure }) {
  const { rows, summary } = report.workload
  const missing = rows.reduce((sum, row) => sum + row.unestimatedCount, 0)
  const byEstimate = measure === 'estimate'
  const series = byEstimate
    ? [
        {
          id: 'estimate',
          label: t('views:insightCharts.openUnits', { context: report.estimateUnit }),
          color: 1,
          values: rows.map((row) => row.estimateSum)
        }
      ]
    : [
        {
          id: 'open',
          label: t('views:insightCharts.openTasks'),
          color: 1,
          values: rows.map((row) => row.openCount)
        },
        {
          id: 'overdue',
          label: t('views:insightCharts.overdue'),
          color: 4,
          values: rows.map((row) => row.overdueCount)
        }
      ]
  return (
    <ChartFrame
      title={t('views:insightCharts.workload')}
      summary={
        byEstimate && missing > 0
          ? t('views:insightCharts.leaveOutOpenTasks', {
              count: missing,
              summary,
              context: report.estimateUnit
            })
          : summary
      }
      empty={rows.length === 0 ? t('views:insightCharts.noOpenTasksSo') : undefined}
      legend={series.map((item) => ({ label: item.label, color: item.color }))}
      table={{
        columns: [
          column<WorkloadRowView>('name', t('views:insightCharts.person'), (row) => row.name),
          column<WorkloadRowView>(
            'open',
            t('views:insightCharts.openTasks'),
            (row) => row.openCount,
            { numeric: true }
          ),
          column<WorkloadRowView>(
            'estimate',
            t('views:insightCharts.openUnits', { context: report.estimateUnit }),
            (row) => row.estimateSum,
            {
              numeric: true
            }
          ),
          column<WorkloadRowView>(
            'unestimated',
            t('views:insightCharts.withoutEstimate'),
            (row) => row.unestimatedCount,
            {
              numeric: true,
              width: 140
            }
          ),
          column<WorkloadRowView>(
            'overdue',
            t('views:insightCharts.overdue'),
            (row) => row.overdueCount,
            {
              numeric: true
            }
          )
        ],
        rows: rows.map((row) => ({ id: row.personId ?? 'unassigned', label: row.name, row }))
      }}
    >
      <BarChart
        categories={rows.map((row) => row.personId ?? 'unassigned')}
        formatCategory={(id) =>
          rows.find((row) => (row.personId ?? 'unassigned') === id)?.name ?? id
        }
        series={series}
      />
    </ChartFrame>
  )
}
