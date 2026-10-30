import type { Rect, Size, Viewport } from '../ui/overlay/position'

/** The side of its target a tip sits on. */
export type TipSide = 'top' | 'bottom' | 'left' | 'right'

export interface TipPosition {
  top: number
  left: number
  /** The side actually used, after trying the others when the preferred one has no room. */
  side: TipSide
  /** Where the arrow points along the tip's edge, in pixels from its start. */
  arrow: number
}

/** Space between the target and the tip: room for the arrow. */
export const TIP_GAP = 12
/** The margin kept from the window's edge. */
export const TIP_MARGIN = 12
/** The arrow never sits closer than this to a corner of the tip. */
const ARROW_INSET = 18

const OPPOSITE: Record<TipSide, TipSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left'
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)))
}

function room(side: TipSide, anchor: Rect, viewport: Viewport, gap: number): number {
  switch (side) {
    case 'top':
      return anchor.top - gap - TIP_MARGIN - (viewport.top ?? 0)
    case 'bottom':
      return viewport.height - (anchor.top + anchor.height) - gap - TIP_MARGIN
    case 'left':
      return anchor.left - gap - TIP_MARGIN
    case 'right':
      return viewport.width - (anchor.left + anchor.width) - gap - TIP_MARGIN
  }
}

function fits(side: TipSide, anchor: Rect, tip: Size, viewport: Viewport, gap: number): boolean {
  const needed = side === 'top' || side === 'bottom' ? tip.height : tip.width
  return room(side, anchor, viewport, gap) >= needed
}

/**
 * Places a tip beside its target: on the preferred side, else the opposite
 * one, else whichever side has room, else the roomiest. The tip stays inside
 * the window and the arrow keeps pointing at the target's middle. Pure, so the
 * rules are testable without layout.
 */
export function placeTip(
  anchor: Rect,
  tip: Size,
  preferred: TipSide,
  viewport: Viewport,
  gap = TIP_GAP
): TipPosition {
  const order: TipSide[] = [
    preferred,
    OPPOSITE[preferred],
    ...(['bottom', 'right', 'top', 'left'] as const).filter(
      (side) => side !== preferred && side !== OPPOSITE[preferred]
    )
  ]
  const side =
    order.find((candidate) => fits(candidate, anchor, tip, viewport, gap)) ??
    [...order].sort((a, b) => room(b, anchor, viewport, gap) - room(a, anchor, viewport, gap))[0]

  const centreX = anchor.left + anchor.width / 2
  const centreY = anchor.top + anchor.height / 2
  const maxLeft = viewport.width - tip.width - TIP_MARGIN
  const minTop = (viewport.top ?? 0) + TIP_MARGIN
  const maxTop = viewport.height - tip.height - TIP_MARGIN

  if (side === 'top' || side === 'bottom') {
    const left = clamp(centreX - tip.width / 2, TIP_MARGIN, maxLeft)
    const top = clamp(
      side === 'bottom' ? anchor.top + anchor.height + gap : anchor.top - tip.height - gap,
      minTop,
      maxTop
    )
    return { top, left, side, arrow: clamp(centreX - left, ARROW_INSET, tip.width - ARROW_INSET) }
  }
  const top = clamp(centreY - tip.height / 2, minTop, maxTop)
  const left = clamp(
    side === 'right' ? anchor.left + anchor.width + gap : anchor.left - tip.width - gap,
    TIP_MARGIN,
    maxLeft
  )
  return { top, left, side, arrow: clamp(centreY - top, ARROW_INSET, tip.height - ARROW_INSET) }
}

export interface Point {
  x: number
  y: number
}

/** A label's height, and the room between it and its control: its notch, pointing at the border. */
const LABEL_HEIGHT = 22
const LABEL_GAP = 4

/** A label's spot, and which side of its control it sits on (its notch points the other way). */
export interface LabelSpot extends Point {
  side?: 'above' | 'below' | 'left' | 'right'
}

/**
 * Where a highlight's label goes: centred just above the control it names,
 * its notch touching the control's border; else just below, then to its
 * left or right, whichever first stays in the window and off the tip itself.
 */
export function labelBeside(target: Rect, tip: Rect, viewport: Viewport, width: number): LabelSpot {
  const x = target.left + target.width / 2
  const y = target.top + target.height / 2
  const reach = LABEL_HEIGHT / 2 + LABEL_GAP
  const across = width / 2 + LABEL_GAP
  const above: LabelSpot = { x, y: target.top - reach, side: 'above' }
  const below: LabelSpot = { x, y: target.top + target.height + reach, side: 'below' }
  const candidates: LabelSpot[] = [
    above,
    below,
    { x: target.left - across, y, side: 'left' },
    { x: target.left + target.width + across, y, side: 'right' }
  ]
  const inWindow = (spot: Point) =>
    spot.y - LABEL_HEIGHT / 2 >= (viewport.top ?? 0) + LABEL_HEIGHT / 2 &&
    spot.y + LABEL_HEIGHT / 2 <= viewport.height &&
    spot.x - width / 2 >= 0 &&
    spot.x + width / 2 <= viewport.width
  const onTip = (spot: Point) =>
    spot.x + width / 2 > tip.left &&
    spot.x - width / 2 < tip.left + tip.width &&
    spot.y + LABEL_HEIGHT / 2 > tip.top &&
    spot.y - LABEL_HEIGHT / 2 < tip.top + tip.height
  return candidates.find((spot) => inWindow(spot) && !onTip(spot)) ?? below
}

/** Moves labels that would overlap down until none do, in order. `widths` are their widths. */
export function separateLabels<T extends Point>(
  spots: readonly T[],
  widths: readonly number[]
): T[] {
  const placed: T[] = []
  spots.forEach((spot, index) => {
    const next = { ...spot }
    let moved = true
    while (moved) {
      moved = false
      for (let other = 0; other < placed.length; other++) {
        const clashX = Math.abs(placed[other].x - next.x) < (widths[other] + widths[index]) / 2 + 4
        const clashY = Math.abs(placed[other].y - next.y) < LABEL_HEIGHT + 2
        if (clashX && clashY) {
          next.y = placed[other].y + LABEL_HEIGHT + 4
          moved = true
        }
      }
    }
    placed.push(next)
  })
  return placed
}
