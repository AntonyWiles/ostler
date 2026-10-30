// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  BarChart,
  ChartFrame,
  LineChart,
  StackedAreaChart,
  describeChart,
  niceScale,
  type DataTableColumn
} from '@renderer/ui'
import { withElementSize } from '../fixtures/layout'

withElementSize(640, 400)

const DAYS = ['2026-10-01', '2026-10-02', '2026-10-03']

describe('charts', () => {
  it('names a line chart with a summary generated from its data', () => {
    render(
      <LineChart
        categories={DAYS}
        series={[
          { id: 'scope', label: 'Scope', color: 2, values: [3, 5, 5] },
          { id: 'done', label: 'Done', color: 3, values: [0, 1, 4], area: true }
        ]}
      />
    )
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Line chart, 3 points from 2026-10-01 to 2026-10-03. Scope goes from 3 to 5. Done goes from 0 to 4.'
    )
  })

  it('names every bar of a short bar chart', () => {
    render(
      <BarChart
        categories={['Under a day', '1–2 days']}
        series={[{ id: 'tasks', label: 'Tasks', color: 5, values: [2, 0] }]}
      />
    )
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Bar chart, 2 bars. Tasks: Under a day 2, 1–2 days 0.'
    )
  })

  it('shows and announces values on keyboard focus and arrow keys', () => {
    render(
      <StackedAreaChart
        categories={DAYS}
        series={[
          { id: 'done', label: 'Done', color: 3, values: [1, 2, 3] },
          { id: 'ready', label: 'Ready', color: 1, values: [4, 3, 1] }
        ]}
      />
    )
    const chart = screen.getByRole('img')
    expect(chart).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(chart, { key: 'Home' })
    expect(screen.getByText('2026-10-01: Done 1, Ready 4, total 5')).toBeInTheDocument()
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(screen.getByText('2026-10-02: Done 2, Ready 3, total 5')).toBeInTheDocument()
    fireEvent.keyDown(chart, { key: 'Escape' })
    expect(screen.queryByText(/2026-10-02:/)).not.toBeInTheDocument()
  })

  it('breaks a line at a missing value instead of drawing a zero', () => {
    const { container } = render(
      <LineChart
        categories={DAYS}
        series={[{ id: 'a', label: 'A', color: 1, values: [2, null, 4] }]}
      />
    )
    expect(container.querySelectorAll('.ui-chart__line')).toHaveLength(2)
    expect([...container.querySelectorAll('circle')].map((dot) => dot.dataset.value)).toEqual([
      '2',
      '4'
    ])
  })

  it('rounds the axis up to an even scale', () => {
    expect(niceScale(7)).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] })
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] })
    expect(describeChart('Line chart', [], [])).toBe('Line chart with no data.')
  })
})

interface Row {
  week: string
  count: number
}
const COLUMNS: DataTableColumn<Row>[] = [
  { id: 'week', header: 'Week', cell: (row) => row.week },
  { id: 'count', header: 'Finished', cell: (row) => String(row.count) }
]
const WEEKS: Row[] = [
  { week: '2026-09-20', count: 2 },
  { week: '2026-09-27', count: 0 },
  { week: '2026-10-04', count: 5 }
]

function Throughput({ empty }: { empty?: string }) {
  return (
    <ChartFrame
      title="Throughput"
      summary="7 tasks finished in the last 30 days, about 2.3 a week."
      legend={[{ label: 'Tasks finished per week', color: 1 }]}
      empty={empty}
      table={{
        columns: COLUMNS,
        rows: WEEKS.map((row) => ({ id: row.week, label: row.week, row }))
      }}
    >
      <BarChart
        categories={WEEKS.map((row) => row.week)}
        series={[
          { id: 'finished', label: 'Finished', color: 1, values: WEEKS.map((row) => row.count) }
        ]}
      />
    </ChartFrame>
  )
}

describe('ChartFrame', () => {
  it('gives the chart a title, a summary and a legend', () => {
    render(<Throughput />)
    const figure = screen.getByRole('figure', { name: 'Throughput' })
    expect(figure).toHaveAccessibleDescription(
      '7 tasks finished in the last 30 days, about 2.3 a week.'
    )
    expect(
      within(screen.getByRole('list', { name: 'Legend' })).getByText('Tasks finished per week')
    ).toBeInTheDocument()
  })

  it('shows the same data as a table, matching the drawn bars', () => {
    const { container } = render(<Throughput />)
    const drawn = [...container.querySelectorAll('rect[data-value]')].map((bar) => [
      bar.getAttribute('data-category'),
      bar.getAttribute('data-value')
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const grid = screen.getByRole('grid', { name: 'Throughput as a table' })
    const rows = within(grid)
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('gridcell')
          .map((cell) => cell.textContent)
      )
    expect(rows).toEqual(drawn)
    expect(screen.getByRole('button', { name: 'Show as chart' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('shows an empty state instead of a chart when there is nothing to draw', () => {
    render(<Throughput empty="Finish a task to start counting." />)
    expect(screen.getByText('Finish a task to start counting.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show as table' })).not.toBeInTheDocument()
  })
})
