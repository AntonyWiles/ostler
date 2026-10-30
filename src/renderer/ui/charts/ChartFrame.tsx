import { useId, useState, type ReactNode } from 'react'
import { Button } from '../Button'
import { DataTable, type DataTableColumn } from '../DataTable'
import { BarChart3, Table2 } from '../icons'
import { chartColor } from './chart-core'
import './charts.css'
import { t } from '@shared/i18n'

export interface ChartLegendItem {
  label: string
  /** The series' colour slot, 1 to 6, or its own colour (a task type's). */
  color: number | string
  /** Drawn before the label, such as a task type's icon. */
  icon?: ReactNode
  /** A dashed line in the chart. */
  dashed?: boolean
}

export interface ChartTable<Row> {
  columns: readonly DataTableColumn<Row>[]
  rows: ReadonlyArray<{ id: string; label: string; row: Row }>
}

export interface ChartFrameProps<Row> {
  title: string
  /** One sentence stating the chart's point, or what is missing. */
  summary: ReactNode
  legend?: readonly ChartLegendItem[]
  /** The same data as a table, for "Show as table". */
  table: ChartTable<Row>
  /** Set when there is nothing to draw: shown instead of the chart and its table. */
  empty?: ReactNode
  /** Controls beside the title, such as a picker. */
  actions?: ReactNode
  headingLevel?: 3 | 4
  children: ReactNode
}

/**
 * A chart's frame: its title, a one-sentence summary, a legend (colour is
 * never the only key), "Show as table" with the same data in a DataTable,
 * and an empty state when there is nothing honest to draw.
 */
export function ChartFrame<Row>({
  title,
  summary,
  legend,
  table,
  empty,
  actions,
  headingLevel = 3,
  children
}: ChartFrameProps<Row>) {
  const [asTable, setAsTable] = useState(false)
  const headingId = useId()
  const summaryId = useId()
  const Heading = headingLevel === 3 ? 'h3' : 'h4'
  const showEmpty = empty !== undefined && empty !== null && empty !== false
  return (
    <figure className="ui-chart-frame" aria-labelledby={headingId} aria-describedby={summaryId}>
      <div className="ui-chart-frame__header">
        <Heading id={headingId} className="ui-chart-frame__title">
          {title}
        </Heading>
        <div className="ui-chart-frame__actions">
          {actions}
          {!showEmpty && (
            <Button
              variant="ghost"
              size="sm"
              icon={asTable ? BarChart3 : Table2}
              aria-pressed={asTable}
              onClick={() => setAsTable((value) => !value)}
              className="ui-chart-frame__toggle"
            >
              {asTable ? t('common:chartFrame.showChart') : t('common:chartFrame.showTable')}
            </Button>
          )}
        </div>
      </div>
      <p id={summaryId} className="ui-chart-frame__summary">
        {summary}
      </p>
      {showEmpty ? (
        <div className="ui-chart-frame__empty">{empty}</div>
      ) : asTable ? (
        <div className="ui-chart-frame__table">
          <DataTable
            label={t('common:chartFrame.table', { title })}
            columns={table.columns}
            entries={table.rows.map((row) => ({ kind: 'row' as const, ...row }))}
          />
        </div>
      ) : (
        <>
          {legend && legend.length > 0 && (
            <ul className="ui-chart-frame__legend" aria-label={t('common:chartFrame.legend')}>
              {legend.map((item) => (
                <li key={item.label}>
                  <span
                    className="ui-chart__swatch"
                    data-dashed={item.dashed || undefined}
                    style={{ background: chartColor(item.color), color: chartColor(item.color) }}
                    aria-hidden="true"
                  />
                  {item.icon}
                  {item.label}
                </li>
              ))}
            </ul>
          )}
          {children}
        </>
      )}
    </figure>
  )
}
