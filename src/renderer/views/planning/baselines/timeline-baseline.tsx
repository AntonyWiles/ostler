import { compareIsoDates } from '@shared/dates'
import type { BaselineComparison, BaselineItemChange } from '@shared/planning/baselines'
import type { TimelineBarSpec } from '../../../ui'
import type { TimelineRow } from '../timeline/timeline-rows'

/**
 * Compare with on the Timeline (N7.4): each task's baseline dates as a thin,
 * hollow bar under its current bar, and each milestone's as a hollow
 * diamond. These marks are drawn only; the words go in the item's own bar.
 */

/** A baseline's mark on a row. */
export type BaselineBar = TimelineBarSpec & {
  kind: 'baseline'
  of: 'task' | 'milestone'
  itemId: string
}

/** Each item's change, by `kind:id`, for the bars and the words. */
export function baselineChanges(
  comparison: BaselineComparison | null
): Map<string, BaselineItemChange> {
  return new Map(
    (comparison?.changes ?? []).map((change) => [`${change.kind}:${change.itemId}`, change])
  )
}

/** The baseline's mark for a row, or null when the row's item had no dates then. */
export function baselineBarFor(
  row: TimelineRow,
  changes: ReadonlyMap<string, BaselineItemChange>
): BaselineBar | null {
  if (row.kind === 'group') {
    const milestone = row.milestone
    const due = milestone ? changes.get(`milestone:${milestone.id}`)?.baseline.due : null
    if (!milestone || !due) return null
    return {
      id: `baseline:milestone:${milestone.id}`,
      start: due,
      end: due,
      shape: 'milestone',
      decorative: true,
      kind: 'baseline',
      of: 'milestone',
      itemId: milestone.id
    }
  }
  const change = changes.get(`task:${row.item.id}`)
  if (!change) return null
  const { start, due } = change.baseline
  const end = due ?? start
  if (!end) return null
  const first = start && compareIsoDates(start, end) <= 0 ? start : end
  return {
    id: `baseline:task:${row.item.id}`,
    start: first,
    end,
    decorative: true,
    kind: 'baseline',
    of: 'task',
    itemId: row.item.id
  }
}

/** The mark itself: a thin hollow bar along the bottom of the row, or a hollow diamond. */
export function BaselineMark({
  bar,
  box
}: {
  bar: BaselineBar
  box: { width: number; height: number }
}) {
  if (bar.of === 'milestone') {
    const mid = box.height / 2
    const size = 9
    const cx = box.width / 2
    return (
      <polygon
        className="timeline-baseline timeline-baseline--diamond"
        data-baseline={bar.itemId}
        points={`${cx},${mid - size} ${cx + size},${mid} ${cx},${mid + size} ${cx - size},${mid}`}
      />
    )
  }
  return (
    <rect
      className="timeline-baseline"
      data-baseline={bar.itemId}
      x={0.5}
      y={box.height - 7}
      width={Math.max(box.width - 1, 2)}
      height={4}
      rx={2}
    />
  )
}
