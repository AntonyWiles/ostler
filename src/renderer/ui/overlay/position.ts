/**
 * Where an anchored overlay (popover, menu, combobox list, tooltip) goes.
 * Pure, so the flip and clamp rules are testable without layout.
 */

export type Placement =
  'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'bottom' | 'top' | 'right-start'

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/**
 * The part of the window an overlay may use. `top` is where it starts: below
 * Windows' own minimise, maximise and close buttons when Ostler draws its own
 * title bar, since those always paint over the page.
 */
export interface Viewport extends Size {
  top?: number
}

export interface Position {
  top: number
  left: number
  /** The side actually used, after flipping when the preferred one does not fit. */
  side: 'top' | 'bottom' | 'right'
}

/** Gap between the anchor and the overlay, and the margin kept from the window edge. */
export const OVERLAY_GAP = 4
export const VIEWPORT_MARGIN = 8

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)))
}

/**
 * Places `floating` next to `anchor`. Flips to the other side when the
 * preferred side lacks room and the other has more, then keeps the whole box
 * inside the viewport.
 */
export function computePosition(
  anchor: Rect,
  floating: Size,
  placement: Placement,
  viewport: Viewport
): Position {
  const minTop = (viewport.top ?? 0) + VIEWPORT_MARGIN
  const maxLeft = viewport.width - floating.width - VIEWPORT_MARGIN
  const maxTop = viewport.height - floating.height - VIEWPORT_MARGIN

  if (placement === 'right-start') {
    let left = anchor.left + anchor.width + OVERLAY_GAP
    if (left > maxLeft) left = anchor.left - floating.width - OVERLAY_GAP
    return {
      top: clamp(anchor.top, minTop, maxTop),
      left: clamp(left, VIEWPORT_MARGIN, maxLeft),
      side: 'right'
    }
  }

  const [preferred, align = 'center'] = placement.split('-') as ['top' | 'bottom', string?]
  const below = anchor.top + anchor.height + OVERLAY_GAP
  const above = anchor.top - floating.height - OVERLAY_GAP
  const roomBelow = viewport.height - below - VIEWPORT_MARGIN
  const roomAbove = anchor.top - OVERLAY_GAP - minTop

  let side: 'top' | 'bottom' = preferred
  if (side === 'bottom' && floating.height > roomBelow && roomAbove > roomBelow) side = 'top'
  else if (side === 'top' && floating.height > roomAbove && roomBelow > roomAbove) side = 'bottom'

  const left =
    align === 'start'
      ? anchor.left
      : align === 'end'
        ? anchor.left + anchor.width - floating.width
        : anchor.left + (anchor.width - floating.width) / 2

  return {
    top: clamp(side === 'bottom' ? below : above, minTop, maxTop),
    left: clamp(left, VIEWPORT_MARGIN, maxLeft),
    side
  }
}
