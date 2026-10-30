import type { CSSProperties } from 'react'
import { overlayViewport } from '../ui/overlay/layer'
import type { Rect } from '../ui/overlay/position'
import { cx } from '../ui/cx'
import { labelBeside, separateLabels, type Point } from './placement'

/** One highlight as measured on screen: what to click or drag, where a drag goes, and its words. */
export interface HighlightMark {
  from: Rect
  to: Rect | null
  label: string
  /** The z-index to draw at: just above the layer the control is in, so a menu opened over it covers it. */
  layer: string
}

/** A label's width, near enough to keep two apart: caption text plus its padding. */
function labelWidth(text: string): number {
  return text.length * 6.6 + 18
}

/** Keeps a label whole inside the window. */
function labelStyle(spot: Point, width: number): CSSProperties {
  const half = width / 2 + 8
  return {
    left: Math.max(half, Math.min(spot.x, window.innerWidth - half)),
    top: Math.max(16, Math.min(spot.y, window.innerHeight - 16))
  }
}

/** A faint copy of what to drag, gliding from where it is to where it can go. */
function ghostStyle(from: Rect, to: Rect): CSSProperties {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  return {
    top: from.top,
    left: from.left,
    width: from.width,
    height: from.height,
    ['--ghost-x' as string]: `${dx}px`,
    ['--ghost-y' as string]: `${dy}px`
  }
}

/**
 * The words beside what to click or drag (whose own borders are already
 * marked, `outline.ts`): a label on the control's edge, and for a drag a faint
 * copy gliding to where it can go. Decorative (the tip's text says the same,
 * so assistive tech skips them), and they take no clicks. With reduced motion,
 * everything holds still.
 */
export function TipHighlights({ tip, marks }: { tip: Rect; marks: readonly HighlightMark[] }) {
  const viewport = overlayViewport()
  const widths = marks.map((mark) => labelWidth(mark.label))
  // A drag's label sits by where it goes; a click's by the control.
  const unmoved = marks.map((mark, index) =>
    labelBeside(mark.to ?? mark.from, tip, viewport, widths[index])
  )
  const spots = separateLabels(unmoved, widths)
  return (
    <>
      {marks.map((mark, index) => (
        <div key={`marks-${index}`} aria-hidden="true">
          {mark.to && (
            <div
              className="ostler-tip-ghost"
              style={{ ...ghostStyle(mark.from, mark.to), zIndex: mark.layer }}
            />
          )}
          <span
            className={cx(
              'ostler-tip-label',
              // A label pushed off its control by another has nothing to point at.
              spots[index].y === unmoved[index].y && `ostler-tip-label--${spots[index].side}`
            )}
            style={{ ...labelStyle(spots[index], widths[index]), zIndex: mark.layer }}
          >
            {mark.label}
          </span>
        </div>
      ))}
    </>
  )
}
