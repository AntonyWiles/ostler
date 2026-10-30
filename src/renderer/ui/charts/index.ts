/* Charts (P6.2, D19): small in-house SVG components, no chart library. */
export {
  ChartFrame,
  type ChartFrameProps,
  type ChartLegendItem,
  type ChartTable
} from './ChartFrame'
export { BarChart, type BarChartProps } from './BarChart'
export { LineChart, type LineChartProps, type LineChartSeries } from './LineChart'
export { StackedAreaChart, type StackedAreaChartProps } from './StackedAreaChart'
export {
  ChartSurface,
  chartColor,
  describeChart,
  niceScale,
  useElementWidth,
  type ChartSeries,
  type ChartLayout
} from './chart-core'
