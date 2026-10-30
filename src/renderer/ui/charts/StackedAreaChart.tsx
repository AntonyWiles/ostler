import { ChartSurface, chartColor, describeChart, type ChartSeries } from './chart-core'

export interface StackedAreaChartProps {
  categories: readonly string[]
  /** Bottom first: the first series sits on the axis. */
  series: readonly ChartSeries[]
  height?: number
  formatValue?: (value: number) => string
  formatCategory?: (category: string) => string
  ariaLabel?: string
}

/**
 * Series stacked on one another over ordered categories, such as tasks per
 * status per day. Solid fills keep each band at full contrast with the
 * surface; a thin surface-coloured edge separates neighbours.
 */
export function StackedAreaChart({
  categories,
  series,
  height,
  formatValue,
  formatCategory,
  ariaLabel
}: StackedAreaChartProps) {
  return (
    <ChartSurface
      ariaLabel={
        ariaLabel ??
        describeChart('Stacked area chart', categories, series, formatValue, formatCategory)
      }
      categories={categories}
      series={series}
      xMode="point"
      stacked
      height={height}
      formatValue={formatValue}
      formatCategory={formatCategory}
    >
      {({ x, y }) => {
        const below = categories.map(() => 0)
        return series.map((item) => {
          const lower = [...below]
          const upper = lower.map((value, index) => value + (item.values[index] ?? 0))
          upper.forEach((value, index) => (below[index] = value))
          if (categories.length === 0) return null
          const top = upper.map((value, index) => `${x(index)},${y(value)}`)
          const bottom = lower.map((value, index) => `${x(index)},${y(value)}`).reverse()
          // A single day is a band one pixel short of a line; widen it to be seen.
          const single = categories.length === 1
          const d = single
            ? `M${x(0) - 8},${y(upper[0])} L${x(0) + 8},${y(upper[0])} L${x(0) + 8},${y(lower[0])} L${x(0) - 8},${y(lower[0])} Z`
            : `M${top.join(' L')} L${bottom.join(' L')} Z`
          return (
            <path
              key={item.id}
              className="ui-chart__stack"
              fill={chartColor(item.color)}
              d={d}
              data-series={item.id}
              data-values={item.values.join(',')}
            />
          )
        })
      }}
    </ChartSurface>
  )
}
