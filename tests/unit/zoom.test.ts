import { describe, expect, it } from 'vitest'
import {
  ZOOM_PERCENTS,
  normalizeZoomLevel,
  stepZoomLevel,
  zoomLevelForPercent,
  zoomPercentForLevel
} from '../../src/shared/zoom'

describe('page zoom', () => {
  it('steps through the sizes a browser offers, up to 300% and down to 50%', () => {
    let level = 0
    const seen: number[] = []
    for (let i = 0; i < ZOOM_PERCENTS.length; i++) {
      level = stepZoomLevel(level, 'in')
      seen.push(zoomPercentForLevel(level))
    }
    expect(seen).toEqual([110, 125, 150, 175, 200, 250, 300, 300, 300, 300, 300, 300, 300])
    expect(zoomPercentForLevel(stepZoomLevel(0, 'out'))).toBe(90)
    expect(zoomPercentForLevel(stepZoomLevel(zoomLevelForPercent(50), 'out'))).toBe(50)
    expect(stepZoomLevel(zoomLevelForPercent(200), 'reset')).toBe(0)
  })

  it('reaches 200% in five steps from 100%', () => {
    let level = 0
    for (let i = 0; i < 5; i++) level = stepZoomLevel(level, 'in')
    expect(zoomPercentForLevel(level)).toBe(200)
  })

  it('steps on from a level between the sizes, as Ctrl+wheel can leave', () => {
    expect(zoomPercentForLevel(stepZoomLevel(0.3, 'in'))).toBe(110)
    expect(zoomPercentForLevel(stepZoomLevel(0.3, 'out'))).toBe(100)
  })

  it('keeps a stored level a number within range', () => {
    expect(normalizeZoomLevel('2')).toBe(0)
    expect(normalizeZoomLevel(Number.NaN)).toBe(0)
    expect(zoomPercentForLevel(normalizeZoomLevel(99))).toBe(300)
    expect(zoomPercentForLevel(normalizeZoomLevel(-99))).toBe(50)
  })
})
