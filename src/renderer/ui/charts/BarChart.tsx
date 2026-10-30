import { ChartSurface, chartColor, describeChart, type ChartSeries } from './chart-core'

export interface BarChartProps {
  categories: readonly string[]
  /** One or more series, drawn side by side in each category. */
  series: readonly ChartSeries[]
  height?: number
  formatValue?: (value: number) => string
  formatCategory?: (category: string) => string
  /** Replaces the generated accessible name. */
  ariaLabel?: string
}

/** Vertical bars per category; several series sit side by side. */
export function BarChart({
  categories,
  series,
  height,
  formatValue,
  formatCategory,
  ariaLabel
}: BarChartProps) {
  return (
    <ChartSurface
      ariaLabel={
        ariaLabel ?? describeChart('Bar chart', categories, series, formatValue, formatCategory)
      }
      categories={categories}
      series={series}
      xMode="band"
      height={height}
      formatValue={formatValue}
      formatCategory={formatCategory}
    >
      {({ x, y, band, top, plotHeight }) => {
        const inner = Math.min(48 * series.length, band * 0.7)
        const barWidth = Math.max(2, inner / Math.max(1, series.length) - 2)
        const base = top + plotHeight
        return series.map((item, seriesIndex) => (
          <g key={item.id} fill={chartColor(item.color)} className="ui-chart__bars">
            {categories.map((category, index) => {
              const value = item.values[index]
              if (value === null || value === undefined) return null
              const left = x(index) - inner / 2 + seriesIndex * (barWidth + 2)
              const heightPx = Math.max(value > 0 ? 1 : 0, base - y(value))
              return (
                <rect
                  key={category}
                  x={left}
                  y={base - heightPx}
                  width={barWidth}
                  height={heightPx}
                  rx={2}
                  data-series={item.id}
                  data-category={category}
                  data-value={value}
                />
              )
            })}
          </g>
        ))
      }}
    </ChartSurface>
  )
}
