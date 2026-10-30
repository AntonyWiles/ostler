import { useRef } from 'react'
import {
  expectedValue,
  formatMeasureNumber,
  sortCheckIns,
  type GoalCheckIn,
  type GoalMeasure
} from '@shared/goal-measures'
import { compareIsoDates, formatIsoDateShort, isoDaysBetween } from '@shared/dates'
import { ChartFrame, chartColor, useElementWidth, type DataTableColumn } from '../../../ui'
import { t } from '@shared/i18n'

const HEIGHT = 140
const PAD = { top: 10, right: 12, bottom: 22, left: 44 }

type Row = { date: string; value: string; line: string }

/**
 * A goal's check-ins against the straight line from its start to its target
 * (N5.6a), drawn in house (D19) with days to scale. Readable without colour:
 * the line is dashed, check-ins are points, and the summary sentence carries
 * the meaning; "Show as table" lists the same numbers.
 */
export function GoalMeasureChart({
  title,
  measure,
  checkIns,
  summary
}: {
  title: string
  measure: GoalMeasure
  /** A goal's check-ins, or a goal of one's own's readings (N5.6b). */
  checkIns: readonly Pick<GoalCheckIn, 'date' | 'value'>[]
  summary: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const width = useElementWidth(box)
  const points = sortCheckIns(checkIns)
  const days = [measure.startDate, measure.targetDate, ...points.map((point) => point.date)].sort(
    compareIsoDates
  )
  const first = days[0]
  const last = days[days.length - 1]
  const span = Math.max(1, isoDaysBetween(first, last))
  const values = [measure.startValue, measure.targetValue, ...points.map((point) => point.value)]
  let low = Math.min(...values)
  let high = Math.max(...values)
  const margin = (high - low) * 0.08 || 1
  low -= margin
  high += margin
  const plotWidth = Math.max(40, width - PAD.left - PAD.right)
  const plotHeight = HEIGHT - PAD.top - PAD.bottom
  const x = (day: string) => PAD.left + (isoDaysBetween(first, day) / span) * plotWidth
  const y = (value: number) => PAD.top + (1 - (value - low) / (high - low)) * plotHeight
  const lineColor = chartColor(2)
  const pointColor = chartColor(1)

  const columns: DataTableColumn<Row>[] = [
    { id: 'date', header: t('tasks:goalMeasure.date'), width: 120, cell: (row) => row.date },
    {
      id: 'value',
      header: t('tasks:goalMeasure.value'),
      width: 110,
      align: 'end',
      cell: (row) => row.value
    },
    {
      id: 'line',
      header: t('tasks:goalMeasure.line'),
      width: 110,
      align: 'end',
      cell: (row) => row.line
    }
  ]

  return (
    <ChartFrame
      title={t('tasks:goalMeasure.chartTitle', { title })}
      headingLevel={4}
      summary={summary}
      legend={[
        { label: t('tasks:goalMeasure.legendCheckIns'), color: 1 },
        { label: t('tasks:goalMeasure.legendLine'), color: 2, dashed: true }
      ]}
      table={{
        columns,
        rows: points.map((point) => ({
          id: point.date,
          label: point.date,
          row: {
            date: formatIsoDateShort(point.date),
            value: formatMeasureNumber(point.value),
            line: formatMeasureNumber(expectedValue(measure, point.date))
          }
        }))
      }}
    >
      <div ref={box} className="goal-measure-chart">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={summary}
          className="goal-measure-chart__svg"
        >
          <line
            className="ui-chart__axis"
            x1={PAD.left}
            x2={PAD.left + plotWidth}
            y1={PAD.top + plotHeight}
            y2={PAD.top + plotHeight}
          />
          {[measure.startValue, measure.targetValue].map((value) => (
            <text
              key={value}
              className="goal-measure-chart__label"
              x={PAD.left - 6}
              y={y(value)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {formatMeasureNumber(value)}
            </text>
          ))}
          {[first, last].map((day, index) => (
            <text
              key={`${day}-${index}`}
              className="goal-measure-chart__label"
              x={index === 0 ? PAD.left : PAD.left + plotWidth}
              y={HEIGHT - 6}
              textAnchor={index === 0 ? 'start' : 'end'}
            >
              {formatIsoDateShort(day)}
            </text>
          ))}
          <line
            data-series="line"
            className="ui-chart__line"
            stroke={lineColor}
            strokeDasharray="6 4"
            x1={x(measure.startDate)}
            y1={y(measure.startValue)}
            x2={x(measure.targetDate)}
            y2={y(measure.targetValue)}
          />
          {points.length > 1 && (
            <path
              data-series="check-ins"
              className="ui-chart__line"
              stroke={pointColor}
              d={points
                .map((point, at) => `${at === 0 ? 'M' : 'L'}${x(point.date)},${y(point.value)}`)
                .join(' ')}
            />
          )}
          {points.map((point) => (
            <circle
              key={point.date}
              className="goal-measure-chart__point"
              cx={x(point.date)}
              cy={y(point.value)}
              r={4}
              fill={pointColor}
              data-date={point.date}
              data-value={point.value}
            />
          ))}
        </svg>
      </div>
    </ChartFrame>
  )
}
