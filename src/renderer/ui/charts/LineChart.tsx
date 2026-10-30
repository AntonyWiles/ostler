import { ChartSurface, chartColor, describeChart, type ChartSeries } from './chart-core'

export interface LineChartSeries extends ChartSeries {
  /** Fills the area under the line. */
  area?: boolean
  /** A dashed line, for a second meaning such as scope against done. */
  dashed?: boolean
}

export interface LineChartProps {
  categories: readonly string[]
  series: readonly LineChartSeries[]
  height?: number
  formatValue?: (value: number) => string
  formatCategory?: (category: string) => string
  ariaLabel?: string
}

/**
 * Lines over ordered categories such as days, with an optional area under
 * each. A null value breaks the line instead of dropping it to zero.
 */
export function LineChart({
  categories,
  series,
  height,
  formatValue,
  formatCategory,
  ariaLabel
}: LineChartProps) {
  return (
    <ChartSurface
      ariaLabel={
        ariaLabel ?? describeChart('Line chart', categories, series, formatValue, formatCategory)
      }
      categories={categories}
      series={series}
      xMode="point"
      height={height}
      formatValue={formatValue}
      formatCategory={formatCategory}
    >
      {({ x, y, top, plotHeight, activeIndex }) =>
        series.map((item) => {
          const runs: Array<Array<[number, number]>> = []
          let run: Array<[number, number]> = []
          item.values.forEach((value, index) => {
            if (value === null || value === undefined) {
              if (run.length) runs.push(run)
              run = []
            } else run.push([x(index), y(value)])
          })
          if (run.length) runs.push(run)
          const color = chartColor(item.color)
          const base = top + plotHeight
          return (
            <g key={item.id} data-series={item.id}>
              {item.area &&
                runs.map((points, index) => (
                  <path
                    key={`area-${index}`}
                    className="ui-chart__area"
                    fill={color}
                    d={`M${points[0][0]},${base} ${points.map(([px, py]) => `L${px},${py}`).join(' ')} L${points[points.length - 1][0]},${base} Z`}
                  />
                ))}
              {runs.map((points, index) => (
                <path
                  key={`line-${index}`}
                  className="ui-chart__line"
                  stroke={color}
                  strokeDasharray={item.dashed ? '6 4' : undefined}
                  d={points.map(([px, py], at) => `${at === 0 ? 'M' : 'L'}${px},${py}`).join(' ')}
                />
              ))}
              {item.values.map((value, index) =>
                value === null || value === undefined ? null : (
                  <circle
                    key={categories[index]}
                    className="ui-chart__point"
                    data-active={activeIndex === index || undefined}
                    cx={x(index)}
                    cy={y(value)}
                    r={activeIndex === index ? 4 : categories.length <= 16 ? 2.5 : 0}
                    fill={color}
                    data-category={categories[index]}
                    data-value={value}
                  />
                )
              )}
            </g>
          )
        })
      }
    </ChartSurface>
  )
}
