import { describe, expect, it } from 'vitest'
import {
  cropToCapturePixels,
  displayAt,
  parseSnipHash,
  rectBetween,
  snipFileName,
  snipHashPath,
  type SnipDisplay
} from '../../src/shared/snip'

/**
 * Snip to task (N4.2a): a rectangle dragged on a display's overlay, in that
 * display's DIP, maps to the pixels of that display's own capture, whatever
 * its scale.
 */

const at100: SnipDisplay = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1
}
// A 4K laptop panel at 150%, to the right of the first display.
const at150: SnipDisplay = {
  id: 2,
  bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
  scaleFactor: 1.5
}

describe('cropping a capture by a dragged rectangle', () => {
  it('takes the same pixels on a display at 100%', () => {
    expect(
      cropToCapturePixels({ x: 100, y: 50, width: 300, height: 200 }, at100, {
        width: 1920,
        height: 1080
      })
    ).toEqual({ x: 100, y: 50, width: 300, height: 200 })
  })

  it('takes one and a half pixels per DIP on a display at 150%', () => {
    expect(
      cropToCapturePixels({ x: 100, y: 50, width: 300, height: 200 }, at150, {
        width: 3840,
        height: 2160
      })
    ).toEqual({ x: 150, y: 75, width: 450, height: 300 })
  })

  it('rounds a fractional rectangle outward, so nothing dragged is lost', () => {
    expect(
      cropToCapturePixels({ x: 10.5, y: 10.5, width: 1, height: 1 }, at150, {
        width: 3840,
        height: 2160
      })
    ).toEqual({ x: 15, y: 15, width: 3, height: 3 })
  })

  it("cuts a rectangle that runs past the display's edge at the edge", () => {
    expect(
      cropToCapturePixels({ x: 2400, y: 1300, width: 500, height: 400 }, at150, {
        width: 3840,
        height: 2160
      })
    ).toEqual({ x: 3600, y: 1950, width: 240, height: 210 })
    expect(
      cropToCapturePixels({ x: -50, y: -20, width: 150, height: 120 }, at100, {
        width: 1920,
        height: 1080
      })
    ).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })

  it('gives nothing for a rectangle wholly off the display, or an empty one', () => {
    const capture = { width: 1920, height: 1080 }
    expect(cropToCapturePixels({ x: 2000, y: 0, width: 50, height: 50 }, at100, capture)).toBe(null)
    expect(cropToCapturePixels({ x: 10, y: 10, width: 0, height: 50 }, at100, capture)).toBe(null)
    expect(cropToCapturePixels({ x: Number.NaN, y: 0, width: 5, height: 5 }, at100, capture)).toBe(
      null
    )
  })

  it("follows the capture's own size when it is not the display's full scale", () => {
    // desktopCapturer fitted this display into a smaller thumbnail.
    expect(
      cropToCapturePixels({ x: 0, y: 0, width: 1280, height: 720 }, at150, {
        width: 2560,
        height: 1440
      })
    ).toEqual({ x: 0, y: 0, width: 1280, height: 720 })
  })

  it('maps the same rectangle per display on two displays at different scales', () => {
    const rect = { x: 0, y: 0, width: 200, height: 100 }
    expect(cropToCapturePixels(rect, at100, { width: 1920, height: 1080 })).toEqual(rect)
    expect(cropToCapturePixels(rect, at150, { width: 3840, height: 2160 })).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 150
    })
  })
})

describe('the rest of the snip helpers', () => {
  it('makes a rectangle from a drag in any direction', () => {
    expect(rectBetween({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60
    })
  })

  it('finds the display under the pointer, or the nearest', () => {
    expect(displayAt([at100, at150], { x: 2000, y: 10 })?.id).toBe(2)
    expect(displayAt([at100, at150], { x: 5, y: 5 })?.id).toBe(1)
    expect(displayAt([at100, at150], { x: 1000, y: 1200 })?.id).toBe(1)
    expect(displayAt([], { x: 0, y: 0 })).toBe(null)
  })

  it('builds and reads the snip route, and nothing else', () => {
    expect(parseSnipHash(snipHashPath(2779098405))).toEqual({ displayId: 2779098405 })
    expect(parseSnipHash('/snip/x')).toBe(null)
    expect(parseSnipHash('/print/p/list')).toBe(null)
  })

  it('names the file after the moment it was taken', () => {
    const name = snipFileName(new Date(2026, 2, 14, 9, 41))
    expect(name).toMatch(/^Screenshot .*14.*2026 09\.41\.png$/)
    expect(name).toContain('March')
  })
})
