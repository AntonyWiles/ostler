import { describe, expect, it } from 'vitest'
import {
  computePosition,
  OVERLAY_GAP,
  VIEWPORT_MARGIN
} from '../../src/renderer/ui/overlay/position'

const VIEWPORT = { width: 1000, height: 800 }
const FLOATING = { width: 200, height: 100 }

describe('computePosition', () => {
  it('places below and start-aligned by default', () => {
    const anchor = { top: 100, left: 300, width: 80, height: 30 }
    expect(computePosition(anchor, FLOATING, 'bottom-start', VIEWPORT)).toEqual({
      top: 130 + OVERLAY_GAP,
      left: 300,
      side: 'bottom'
    })
  })

  it('aligns end and centre', () => {
    const anchor = { top: 100, left: 300, width: 80, height: 30 }
    expect(computePosition(anchor, FLOATING, 'bottom-end', VIEWPORT).left).toBe(180)
    expect(computePosition(anchor, FLOATING, 'bottom', VIEWPORT).left).toBe(240)
  })

  it('places above when asked and there is room', () => {
    const anchor = { top: 400, left: 300, width: 80, height: 30 }
    expect(computePosition(anchor, FLOATING, 'top-start', VIEWPORT)).toEqual({
      top: 400 - 100 - OVERLAY_GAP,
      left: 300,
      side: 'top'
    })
  })

  it('flips to the top when there is no room below and more above', () => {
    const anchor = { top: 750, left: 300, width: 80, height: 30 }
    const position = computePosition(anchor, FLOATING, 'bottom-start', VIEWPORT)
    expect(position.side).toBe('top')
    expect(position.top).toBe(750 - 100 - OVERLAY_GAP)
  })

  it('flips to the bottom when there is no room above and more below', () => {
    const anchor = { top: 20, left: 300, width: 80, height: 30 }
    const position = computePosition(anchor, FLOATING, 'top', VIEWPORT)
    expect(position.side).toBe('bottom')
    expect(position.top).toBe(50 + OVERLAY_GAP)
  })

  it('does not flip when the other side has even less room', () => {
    const tall = { width: 200, height: 700 }
    const anchor = { top: 300, left: 300, width: 80, height: 30 }
    expect(computePosition(anchor, tall, 'bottom-start', VIEWPORT).side).toBe('bottom')
  })

  it('keeps clear of the window buttons over a custom title bar', () => {
    // "New task" just under the 36px title bar: a tooltip above it would sit
    // under minimise, maximise and close, so it goes below instead.
    const underBar = { width: 1000, height: 800, top: 36 }
    const anchor = { top: 44, left: 700, width: 100, height: 32 }
    const tip = { width: 160, height: 28 }
    const position = computePosition(anchor, tip, 'top', underBar)
    expect(position.side).toBe('bottom')
    expect(position.top).toBe(44 + 32 + OVERLAY_GAP)
    // A box with no room either side is clamped below the bar, never under it.
    const tall = { width: 200, height: 790 }
    expect(computePosition(anchor, tall, 'top', underBar).top).toBe(36 + VIEWPORT_MARGIN)
  })

  it('clamps inside the viewport margins', () => {
    const right = computePosition(
      { top: 100, left: 950, width: 40, height: 20 },
      FLOATING,
      'bottom-start',
      VIEWPORT
    )
    expect(right.left).toBe(VIEWPORT.width - FLOATING.width - VIEWPORT_MARGIN)
    const left = computePosition(
      { top: 100, left: 0, width: 40, height: 20 },
      FLOATING,
      'bottom-end',
      VIEWPORT
    )
    expect(left.left).toBe(VIEWPORT_MARGIN)
  })

  it('pins to the margin when the overlay is bigger than the viewport', () => {
    const huge = { width: 2000, height: 2000 }
    const position = computePosition(
      { top: 100, left: 100, width: 10, height: 10 },
      huge,
      'bottom-start',
      VIEWPORT
    )
    expect(position.left).toBe(VIEWPORT_MARGIN)
    expect(position.top).toBe(VIEWPORT_MARGIN)
  })

  it('places right-start beside the anchor, flipping left when it would overflow', () => {
    expect(
      computePosition(
        { top: 100, left: 100, width: 50, height: 20 },
        FLOATING,
        'right-start',
        VIEWPORT
      )
    ).toEqual({ top: 100, left: 150 + OVERLAY_GAP, side: 'right' })
    const flipped = computePosition(
      { top: 100, left: 850, width: 50, height: 20 },
      FLOATING,
      'right-start',
      VIEWPORT
    )
    expect(flipped.left).toBe(850 - 200 - OVERLAY_GAP)
    expect(flipped.side).toBe('right')
  })
})
