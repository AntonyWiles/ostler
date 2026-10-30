import { t } from '@shared/i18n'

/**
 * Where the Timeline draws a waits-on link from and to (N7.2b), as pure
 * geometry so it is worked out once per layout and tested on its own.
 * The kinds are the planning ones (N7.2a, decision N50), spelled out here so
 * the generic grid does not depend on the planning types.
 */
export type TimelineLinkType = 'finish-to-start' | 'start-to-start' | 'finish-to-finish'

/** One end of a bar: its first day or its last. */
export type TimelineBarEnd = 'start' | 'end'

/** A bar's place for routing: its left and right edges, and its row's middle. */
export interface TimelineLinkBox {
  left: number
  right: number
  /** The middle of the bar's row. */
  y: number
}

/** How far an arrow runs clear of a bar before it turns. */
export const LINK_GAP = 10

/** The ends a link of each type joins: from the task waited on, to the one that waits. */
export function linkEnds(type: TimelineLinkType): { from: TimelineBarEnd; to: TimelineBarEnd } {
  if (type === 'start-to-start') return { from: 'start', to: 'start' }
  if (type === 'finish-to-finish') return { from: 'end', to: 'end' }
  return { from: 'end', to: 'start' }
}

/**
 * The type a link drawn between two ends makes, or null for start to end:
 * start to finish is not offered.
 */
export function linkTypeForEnds(from: TimelineBarEnd, to: TimelineBarEnd): TimelineLinkType | null {
  if (from === 'end' && to === 'start') return 'finish-to-start'
  if (from === 'start' && to === 'start') return 'start-to-start'
  if (from === 'end' && to === 'end') return 'finish-to-finish'
  return null
}

/** A lag as the arrow's small label: "+2d", "−1d", or null for none. */
export function lagLabel(lagDays: number | undefined): string | null {
  if (!lagDays) return null
  return lagDays > 0
    ? t('views:timelineView.lagAfter', { count: lagDays })
    : t('views:timelineView.lagBefore', { count: -lagDays })
}

export interface TimelineLinkRoute {
  /** The SVG path, ending at the end it points into. */
  d: string
  /** Where a lag label sits: beside the arrow's upright run. */
  labelX: number
  labelY: number
}

/**
 * The arrow for one link between two bars, `rowHeight` tall rows apart.
 * Each type leaves and enters from its true ends; runs that turn go out past
 * both bars (start to start on the left, finish to finish on the right), and
 * a finish-to-start link whose bars overlap crosses between rows along the
 * row line, so the arrow does not run over either bar.
 */
export function linkRoute(
  a: TimelineLinkBox,
  b: TimelineLinkBox,
  type: TimelineLinkType,
  rowHeight: number
): TimelineLinkRoute {
  const y1 = a.y
  const y2 = b.y
  const middle = (y1 + y2) / 2
  if (type === 'start-to-start') {
    const x1 = a.left
    const x2 = b.left
    const outer = Math.min(x1, x2) - LINK_GAP
    return { d: `M ${x1} ${y1} H ${outer} V ${y2} H ${x2}`, labelX: outer, labelY: middle }
  }
  if (type === 'finish-to-finish') {
    const x1 = a.right
    const x2 = b.right
    const outer = Math.max(x1, x2) + LINK_GAP
    return { d: `M ${x1} ${y1} H ${outer} V ${y2} H ${x2}`, labelX: outer, labelY: middle }
  }
  const x1 = a.right
  const x2 = b.left
  if (x2 - LINK_GAP >= x1 + LINK_GAP) {
    const bend = Math.min(x1 + 2 * LINK_GAP, x2 - LINK_GAP)
    return { d: `M ${x1} ${y1} H ${bend} V ${y2} H ${x2}`, labelX: bend, labelY: middle }
  }
  // The later task starts before the earlier one ends: out past the end,
  // along the line between the rows, and back in before the start.
  const line = y1 === y2 ? y1 + rowHeight / 2 : y1 + (y2 > y1 ? rowHeight / 2 : -rowHeight / 2)
  const out = x1 + LINK_GAP
  const back = x2 - LINK_GAP
  return {
    d: `M ${x1} ${y1} H ${out} V ${line} H ${back} V ${y2} H ${x2}`,
    labelX: back,
    labelY: (line + y2) / 2
  }
}
