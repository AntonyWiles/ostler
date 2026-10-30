import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { VisuallyHidden } from '../VisuallyHidden'
import { cx } from '../cx'
import './charts.css'
import { joinSentences, t } from '@shared/i18n'

/** One series: a label and a value per category (null: no value, not zero). */
export interface ChartSeries {
  id: string
  label: string
  /** 1 to 6: the chart token `--chart-<n>`; or a colour of the person's own, such as a task type's. */
  color: number | string
  values: ReadonlyArray<number | null>
}

/** The token colour for a series slot, or the colour itself when one is given. */
export const chartColor = (slot: number | string): string =>
  typeof slot === 'string' ? slot : `var(--chart-${((slot - 1) % 6) + 1})`

const MARGIN = { top: 8, right: 12, bottom: 24, left: 40 }
const DEFAULT_WIDTH = 640
/** The narrowest an x-axis label may be given before labels are skipped. */
const LABEL_SPACE = 64

/** A ceiling at a round number and four even steps up to it. */
export function niceScale(max: number): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] }
  const rough = max / 4
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((m) => m >= rough)!
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let tick = 0; tick <= top + step / 2; tick += step)
    ticks.push(Math.round(tick * 1000) / 1000)
  return { max: top, ticks }
}

/** The width of an element, kept current with ResizeObserver. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const next = element.clientWidth
      if (next > 0) setWidth(next)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

export interface ChartLayout {
  width: number
  height: number
  left: number
  top: number
  plotWidth: number
  plotHeight: number
  /** The centre of category `index`. */
  x: (index: number) => number
  /** The width of one category's band (bar charts) or the step between points. */
  band: number
  y: (value: number) => number
  yMax: number
  activeIndex: number | null
}

export interface ChartSurfaceProps {
  /** The chart's accessible name: a summary generated from the data. */
  ariaLabel: string
  categories: readonly string[]
  series: readonly ChartSeries[]
  /** Bars sit in bands; lines and areas put points at the ends. */
  xMode: 'band' | 'point'
  /** Stacked series: the y-axis reaches the largest total. */
  stacked?: boolean
  height?: number
  formatValue?: (value: number) => string
  formatCategory?: (category: string) => string
  className?: string
  children: (layout: ChartLayout) => ReactNode
}

const plain = (value: number) => String(Math.round(value * 10) / 10)

/**
 * What every chart shares: the SVG sized by ResizeObserver, axes, and the
 * value readout. Hovering or moving with the arrow keys (once the chart has
 * focus) picks a category, shows its values beside it and announces them.
 */
export function ChartSurface({
  ariaLabel,
  categories,
  series,
  xMode,
  stacked = false,
  height = 200,
  formatValue = plain,
  formatCategory = (category) => category,
  className,
  children
}: ChartSurfaceProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(wrapRef)
  const [active, setActive] = useState<number | null>(null)
  const count = categories.length

  useEffect(() => {
    if (active !== null && active >= count) setActive(null)
  }, [active, count])

  const totals = categories.map((_, index) =>
    stacked
      ? series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0)
      : Math.max(0, ...series.map((item) => item.values[index] ?? 0))
  )
  const scale = niceScale(Math.max(0, ...totals))
  const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right)
  const plotHeight = Math.max(1, height - MARGIN.top - MARGIN.bottom)
  const band =
    xMode === 'band' ? plotWidth / Math.max(1, count) : plotWidth / Math.max(1, count - 1)
  const x = (index: number) =>
    MARGIN.left +
    (xMode === 'band' ? band * (index + 0.5) : count === 1 ? plotWidth / 2 : band * index)
  const y = (value: number) => MARGIN.top + plotHeight - (value / scale.max) * plotHeight
  const layout: ChartLayout = {
    width,
    height,
    left: MARGIN.left,
    top: MARGIN.top,
    plotWidth,
    plotHeight,
    x,
    band,
    y,
    yMax: scale.max,
    activeIndex: active
  }

  const labelEvery = Math.max(
    1,
    Math.ceil(count / Math.max(1, Math.floor(plotWidth / LABEL_SPACE)))
  )
  const indexAt = (clientX: number): number | null => {
    const box = wrapRef.current?.getBoundingClientRect()
    if (!box || count === 0) return null
    const offset = clientX - box.left - MARGIN.left
    const index =
      xMode === 'band' ? Math.floor(offset / band) : count === 1 ? 0 : Math.round(offset / band)
    return Math.min(count - 1, Math.max(0, index))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return
    const current = active ?? -1
    let next: number | null | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp')
      next = Math.min(count - 1, current + 1)
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown')
      next = current === -1 ? count - 1 : Math.max(0, current - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = count - 1
    else if (event.key === 'Escape' && active !== null) next = null
    if (next === undefined) return
    event.preventDefault()
    setActive(next)
  }

  const readout =
    active === null
      ? ''
      : `${formatCategory(categories[active])}: ${series
          .map((item) => {
            const value = item.values[active]
            return `${item.label} ${value === null || value === undefined ? 'no value' : formatValue(value)}`
          })
          .join(
            ', '
          )}${stacked && series.length > 1 ? `, total ${formatValue(totals[active])}` : ''}`

  const tooltipLeft = active === null ? 0 : x(active)
  return (
    <div className={cx('ui-chart', className)}>
      <div
        ref={wrapRef}
        className="ui-chart__surface"
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerMove={(event: PointerEvent<HTMLDivElement>) => setActive(indexAt(event.clientX))}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
      >
        <svg
          width={width}
          height={height}
          className="ui-chart__svg"
          aria-hidden="true"
          focusable="false"
        >
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line
                className="ui-chart__grid"
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                className="ui-chart__tick"
                x={MARGIN.left - 6}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {formatValue(tick)}
              </text>
            </g>
          ))}
          {active !== null &&
            (xMode === 'band' ? (
              <rect
                className="ui-chart__guide-band"
                x={x(active) - band / 2}
                y={MARGIN.top}
                width={band}
                height={plotHeight}
              />
            ) : (
              <line
                className="ui-chart__guide"
                x1={x(active)}
                x2={x(active)}
                y1={MARGIN.top}
                y2={MARGIN.top + plotHeight}
              />
            ))}
          {children(layout)}
          <line
            className="ui-chart__axis"
            x1={MARGIN.left}
            x2={MARGIN.left + plotWidth}
            y1={MARGIN.top + plotHeight}
            y2={MARGIN.top + plotHeight}
          />
          {categories.map((category, index) =>
            index % labelEvery === 0 ||
            (xMode === 'point' && index === count - 1 && index % labelEvery > labelEvery / 2) ? (
              <text
                key={category}
                className="ui-chart__tick"
                x={x(index)}
                y={height - 6}
                textAnchor={
                  xMode === 'point' && index === count - 1 && count > 1
                    ? 'end'
                    : xMode === 'point' && index === 0 && count > 1
                      ? 'start'
                      : 'middle'
                }
              >
                {formatCategory(category)}
              </text>
            ) : null
          )}
        </svg>
        {active !== null && (
          <div
            className="ui-chart__tooltip"
            aria-hidden="true"
            style={{
              left: Math.min(Math.max(tooltipLeft, 80), Math.max(80, width - 80)),
              top: 0
            }}
          >
            <strong>{formatCategory(categories[active])}</strong>
            {series.map((item) => (
              <span key={item.id} className="ui-chart__tooltip-row">
                <span className="ui-chart__swatch" style={{ background: chartColor(item.color) }} />
                {item.label}
                <span className="ui-chart__tooltip-value">
                  {item.values[active] === null || item.values[active] === undefined
                    ? '—'
                    : formatValue(item.values[active]!)}
                </span>
              </span>
            ))}
            {stacked && series.length > 1 && (
              <span className="ui-chart__tooltip-row">
                {t('common:chartCore.total')}
                <span className="ui-chart__tooltip-value">{formatValue(totals[active])}</span>
              </span>
            )}
          </div>
        )}
      </div>
      <VisuallyHidden aria-live="polite">{readout}</VisuallyHidden>
    </div>
  )
}

/** Each chart kind's name, for its accessible description. */
const CHART_KIND_KEYS = {
  'Bar chart': 'common:chartCore.kind.bar',
  'Line chart': 'common:chartCore.kind.line',
  'Stacked area chart': 'common:chartCore.kind.stackedArea'
} as const

/**
 * The chart's accessible name, generated from its data: what kind of chart,
 * over what, and each series' start, end and peak; a short bar chart names
 * every bar.
 */
export function describeChart(
  kind: 'Bar chart' | 'Line chart' | 'Stacked area chart',
  categories: readonly string[],
  series: readonly ChartSeries[],
  formatValue: (value: number) => string = plain,
  formatCategory: (category: string) => string = (category) => category
): string {
  const kindName = t(CHART_KIND_KEYS[kind])
  if (categories.length === 0) return t('common:chartCore.noData', { kind: kindName })
  const span =
    kind === 'Bar chart'
      ? t('common:chartCore.bars', { count: categories.length })
      : categories.length === 1
        ? formatCategory(categories[0])
        : t('common:chartCore.points', {
            count: categories.length,
            first: formatCategory(categories[0]),
            last: formatCategory(categories[categories.length - 1])
          })
  const parts = series.map((item) => {
    const values = item.values.filter((value): value is number => value !== null)
    if (values.length === 0) return t('common:chartCore.noValues', { series: item.label })
    if (kind === 'Bar chart' && categories.length <= 12)
      return t('common:chartCore.barValues', {
        series: item.label,
        values: categories
          .map((category, index) => {
            const value = item.values[index]
            return value === null || value === undefined
              ? t('common:chartCore.categoryNoValue', { category: formatCategory(category) })
              : t('common:chartCore.categoryValue', {
                  category: formatCategory(category),
                  value: formatValue(value)
                })
          })
          .join(', ')
      })
    const first = values[0]
    const last = values[values.length - 1]
    const peak = Math.max(...values)
    const peaks = peak > Math.max(first, last)
    return first === last
      ? t(peaks ? 'common:chartCore.staysAtPeaking' : 'common:chartCore.staysAt', {
          series: item.label,
          value: formatValue(last),
          peak: formatValue(peak)
        })
      : t(peaks ? 'common:chartCore.goesFromPeaking' : 'common:chartCore.goesFrom', {
          series: item.label,
          from: formatValue(first),
          to: formatValue(last),
          peak: formatValue(peak)
        })
  })
  return t('common:chartCore.summary', {
    kind: kindName,
    span,
    details: joinSentences(parts)
  })
}
