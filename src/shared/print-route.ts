import type { PrintableView, PrintRequest, ProgressWeekStart, SavedViewConfig } from './ostler-api'
import { isIsoDate } from './dates'

/**
 * The print route (P6.1): `/print/<projectId>/<view>?config=<json>`, in the
 * page's hash. Main builds it for its offscreen print window; the renderer
 * reads it and draws that view in full. One builder and one parser, so the
 * two cannot drift.
 */

export const PRINTABLE_VIEWS: readonly PrintableView[] = [
  'list',
  'overview',
  'timeline',
  'shopping'
]

export function isPrintableView(value: unknown): value is PrintableView {
  return (PRINTABLE_VIEWS as readonly unknown[]).includes(value)
}

export function printHashPath(
  projectId: string,
  request: Pick<PrintRequest, 'view' | 'config'>
): string {
  if (!isPrintableView(request?.view))
    throw new Error('Only List, Overview, Timeline and Shopping list print')
  const query = request.config
    ? `?config=${encodeURIComponent(JSON.stringify(request.config))}`
    : ''
  return `/print/${encodeURIComponent(projectId)}/${request.view}${query}`
}

export interface PrintRoute {
  projectId: string
  view: PrintableView
  config: SavedViewConfig | null
}

/** Reads a hash path (without the `#`); null when it is not the print route. */
export function parsePrintHash(hash: string): PrintRoute | null {
  const match = /^\/print\/([^/?]+)\/([a-z]+)(?:\?(.*))?$/.exec(hash)
  if (!match || !isPrintableView(match[2])) return null
  let config: SavedViewConfig | null = null
  const raw = new URLSearchParams(match[3] ?? '').get('config')
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object') config = parsed as SavedViewConfig
    } catch {
      config = null
    }
  }
  return { projectId: decodeURIComponent(match[1]), view: match[2], config }
}

/** "My week" (N3.1b): `/print/my-week?today=YYYY-MM-DD`, the renderer's local date. */
export interface MyWeekPrintRoute {
  today: string
}

export function myWeekHashPath(today: string): string {
  if (!isIsoDate(today)) throw new Error('today must use YYYY-MM-DD')
  return `/print/my-week?today=${today}`
}

/** Reads a hash path (without the `#`); null when it is not the my-week print route. */
export function parseMyWeekHash(hash: string): MyWeekPrintRoute | null {
  const match = /^\/print\/my-week\?today=(\d{4}-\d{2}-\d{2})$/.exec(hash)
  return match && isIsoDate(match[1]) ? { today: match[1] } : null
}

/**
 * The Timeline across projects (N5.4): `/print/timeline-overview`, with
 * `?projects=<id>,<id>` when the filter shows only some projects.
 */
export interface TimelineOverviewPrintRoute {
  /** The projects shown, or null for every enabled project. */
  projectIds: string[] | null
}

export function timelineOverviewHashPath(projectIds: readonly string[] | null): string {
  if (!projectIds) return '/print/timeline-overview'
  return `/print/timeline-overview?projects=${projectIds.map(encodeURIComponent).join(',')}`
}

/** Reads a hash path (without the `#`); null when it is not the Timeline across projects' route. */
export function parseTimelineOverviewHash(hash: string): TimelineOverviewPrintRoute | null {
  const match = /^\/print\/timeline-overview(?:\?projects=([^&]*))?$/.exec(hash)
  if (!match) return null
  if (match[1] === undefined) return { projectIds: null }
  const projectIds = match[1]
    .split(',')
    .filter(Boolean)
    .map((id) => {
      try {
        return decodeURIComponent(id)
      } catch {
        return id
      }
    })
  return { projectIds }
}

/**
 * Compare rounds (N5.7b): `/print/rounds/<projectId>/<milestoneId>?measure=cycle|time`,
 * the series that milestone belongs to, every round and every task.
 */
export interface RoundsPrintRoute {
  projectId: string
  milestoneId: string
  measure: 'cycle' | 'time'
}

export function roundsHashPath(route: RoundsPrintRoute): string {
  return `/print/rounds/${encodeURIComponent(route.projectId)}/${encodeURIComponent(
    route.milestoneId
  )}?measure=${route.measure === 'time' ? 'time' : 'cycle'}`
}

/** Reads a hash path (without the `#`); null when it is not the Compare rounds route. */
export function parseRoundsHash(hash: string): RoundsPrintRoute | null {
  const match = /^\/print\/rounds\/([^/?]+)\/([^/?]+)\?measure=(cycle|time)$/.exec(hash)
  if (!match) return null
  try {
    return {
      projectId: decodeURIComponent(match[1]),
      milestoneId: decodeURIComponent(match[2]),
      measure: match[3] as 'cycle' | 'time'
    }
  } catch {
    return null
  }
}

/** A whiteboard (plan `docs/plans/whiteboards/`, prompt 17): `/print/whiteboard/<projectId>/<whiteboardId>`. */
export interface WhiteboardPrintRoute {
  projectId: string
  whiteboardId: string
}

export function whiteboardHashPath(route: WhiteboardPrintRoute): string {
  return `/print/whiteboard/${encodeURIComponent(route.projectId)}/${encodeURIComponent(
    route.whiteboardId
  )}`
}

/** Reads a hash path (without the `#`); null when it is not a whiteboard's print route. */
export function parseWhiteboardHash(hash: string): WhiteboardPrintRoute | null {
  const match = /^\/print\/whiteboard\/([^/?]+)\/([^/?]+)$/.exec(hash)
  if (!match) return null
  try {
    return {
      projectId: decodeURIComponent(match[1]),
      whiteboardId: decodeURIComponent(match[2])
    }
  } catch {
    return null
  }
}

/** The Time report (N6.4): `/print/time-report/<projectId>?from=YYYY-MM-DD&to=YYYY-MM-DD`. */
export interface TimeReportPrintRoute {
  projectId: string
  from: string
  to: string
}

export function timeReportHashPath(route: TimeReportPrintRoute): string {
  if (!isIsoDate(route.from) || !isIsoDate(route.to)) throw new Error('Dates must use YYYY-MM-DD')
  return `/print/time-report/${encodeURIComponent(route.projectId)}?from=${route.from}&to=${route.to}`
}

/** Reads a hash path (without the `#`); null when it is not the Time report's route. */
export function parseTimeReportHash(hash: string): TimeReportPrintRoute | null {
  const match =
    /^\/print\/time-report\/([^/?]+)\?from=(\d{4}-\d{2}-\d{2})&to=(\d{4}-\d{2}-\d{2})$/.exec(hash)
  if (!match || !isIsoDate(match[2]) || !isIsoDate(match[3])) return null
  try {
    return { projectId: decodeURIComponent(match[1]), from: match[2], to: match[3] }
  } catch {
    return null
  }
}

/**
 * Your year (N3.6): `/print/year-in-review?year=YYYY&weekStart=0-6`, the
 * calendar year and the renderer's week start, so the busiest week starts
 * on the same day as the Calendar's weeks.
 */
export interface YearInReviewPrintRoute {
  year: number
  weekStart: ProgressWeekStart
}

export function yearInReviewHashPath(route: YearInReviewPrintRoute): string {
  if (!Number.isInteger(route?.year) || route.year < 1970 || route.year > 9999)
    throw new Error('year must be a year such as 2026')
  if (!Number.isInteger(route.weekStart) || route.weekStart < 0 || route.weekStart > 6)
    throw new Error('weekStart must be 0 to 6')
  return `/print/year-in-review?year=${route.year}&weekStart=${route.weekStart}`
}

/** Reads a hash path (without the `#`); null when it is not Your year's route. */
export function parseYearInReviewHash(hash: string): YearInReviewPrintRoute | null {
  const match = /^\/print\/year-in-review\?year=(\d{4})&weekStart=([0-6])$/.exec(hash)
  if (!match || Number(match[1]) < 1970) return null
  return { year: Number(match[1]), weekStart: Number(match[2]) as ProgressWeekStart }
}
