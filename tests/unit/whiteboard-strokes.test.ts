import { describe, expect, it } from 'vitest'
import type { Point } from '../../src/shared/whiteboard/geometry'
import { defaultObject, type PenObject } from '../../src/shared/whiteboard/model'
import {
  ERASER_RADIUS,
  MARKER_WIDTH_FACTOR,
  eraseHits,
  penFromPoints,
  penPointsAbsolute,
  penWidth,
  simplifyStroke,
  strokeHit,
  strokePath
} from '../../src/shared/whiteboard/strokes'

function pen(
  id: string,
  x: number,
  y: number,
  points: number[],
  options: Partial<PenObject['data']> = {}
): PenObject {
  return {
    id,
    kind: 'pen',
    x,
    y,
    width: 0,
    height: 0,
    z: 1,
    colour: 'black',
    text: '',
    link: null,
    groupId: null,
    data: { points, stroke: 'medium', marker: false, ...options }
  }
}

const at = { id: 'p1', z: 3, colour: 'blue' as const, stroke: 'thin' as const, marker: false }

describe('penWidth and penPointsAbsolute', () => {
  it('uses the stroke width, three times wider for a marker', () => {
    expect(penWidth(pen('a', 0, 0, [0, 0, 1, 1]))).toBe(4)
    expect(penWidth(pen('a', 0, 0, [0, 0, 1, 1], { stroke: 'thick', marker: true }))).toBe(
      8 * MARKER_WIDTH_FACTOR
    )
  })

  it('adds the object position to each relative pair', () => {
    expect(penPointsAbsolute(pen('a', 10, 20, [0, 0, 5, 7]))).toEqual([
      { x: 10, y: 20 },
      { x: 15, y: 27 }
    ])
  })
})

describe('simplifyStroke', () => {
  it('drops collinear points and keeps the ends', () => {
    const line: Point[] = Array.from({ length: 11 }, (_, index) => ({ x: index * 10, y: 0 }))
    expect(simplifyStroke(line)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ])
  })

  it('keeps a real corner', () => {
    const corner: Point[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 100, y: 100 }
    ]
    expect(simplifyStroke(corner)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 }
    ])
  })

  it('brings a 10,000-point wiggle down to at most 2,000 points, ends kept', () => {
    const wiggle: Point[] = Array.from({ length: 10_000 }, (_, index) => ({
      x: index,
      y: (index % 2 === 0 ? 1 : -1) * (index % 50)
    }))
    const result = simplifyStroke(wiggle)
    expect(result.length).toBeLessThanOrEqual(2000)
    expect(result[0]).toEqual(wiggle[0])
    expect(result[result.length - 1]).toEqual(wiggle[wiggle.length - 1])
  })

  it('turns a tap into two equal points', () => {
    expect(simplifyStroke([{ x: 4, y: 5 }])).toEqual([
      { x: 4, y: 5 },
      { x: 4, y: 5 }
    ])
  })

  it('does not change its input', () => {
    const input: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 }
    ]
    const copy = structuredClone(input)
    simplifyStroke(input)
    expect(input).toEqual(copy)
  })
})

describe('penFromPoints', () => {
  it('stores integer points relative to the box', () => {
    const made = penFromPoints(
      [
        { x: 100.4, y: 50.6 },
        { x: 150.2, y: 90.7 },
        { x: 200.6, y: 60.1 }
      ],
      at
    )
    expect(made).toMatchObject({
      id: 'p1',
      kind: 'pen',
      x: 100,
      y: 50,
      z: 3,
      colour: 'blue',
      text: '',
      link: null,
      groupId: null,
      data: { stroke: 'thin', marker: false }
    })
    expect(made.data.points).toEqual([0, 1, 50, 41, 101, 10])
    expect(made.data.points.every(Number.isInteger)).toBe(true)
    expect(made.width).toBe(101)
    expect(made.height).toBe(41)
  })

  it('makes a dot from a tap', () => {
    const made = penFromPoints([{ x: 7, y: 8 }], at)
    expect(made).toMatchObject({ x: 7, y: 8, width: 0, height: 0 })
    expect(made.data.points).toEqual([0, 0, 0, 0])
  })
})

describe('strokePath', () => {
  it('draws two points as a line', () => {
    expect(strokePath(pen('a', 10, 10, [0, 0, 20, 5]))).toBe('M 10 10 L 30 15')
  })

  it('draws four points as quadratic curves through the middle points', () => {
    expect(strokePath(pen('a', 0, 0, [0, 0, 10, 0, 10, 10, 21, 11]))).toBe(
      'M 0 0 Q 10 0 10 5 Q 10 10 15.5 10.5 L 21 11'
    )
  })
})

describe('strokeHit', () => {
  const line = pen('a', 0, 0, [0, 0, 100, 0])

  it('hits near the line and misses far from it', () => {
    expect(strokeHit(line, { x: 50, y: 5 }, 3)).toBe(true) // 5 <= 3 + 2
    expect(strokeHit(line, { x: 50, y: 6 }, 3)).toBe(false)
    expect(strokeHit(line, { x: 130, y: 0 }, 3)).toBe(false)
  })

  it('reaches further for a marker’s wider line', () => {
    const marker = pen('m', 0, 0, [0, 0, 100, 0], { marker: true })
    expect(strokeHit(marker, { x: 50, y: 9 }, 3)).toBe(true) // 9 <= 3 + 6
    expect(strokeHit(line, { x: 50, y: 9 }, 3)).toBe(false)
  })
})

describe('eraseHits', () => {
  const crossed = pen('crossed', 0, 50, [0, 0, 100, 0])
  const distant = pen('distant', 500, 500, [0, 0, 100, 0])
  const marker = pen('marker', 0, 0, [0, 0, 0, 0], { marker: true })
  const note = defaultObject('note', { id: 'note', x: 0, y: 0, z: 1 })

  it('finds a crossed stroke, misses a distant one and never returns a note', () => {
    const path: Point[] = [
      { x: 50, y: 0 },
      { x: 50, y: 100 }
    ]
    expect(eraseHits([crossed, distant, note], path)).toEqual(['crossed'])
  })

  it('tests a one-point path as that point, markers included', () => {
    expect(eraseHits([marker, note], [{ x: ERASER_RADIUS + 6, y: 0 }])).toEqual(['marker'])
    expect(eraseHits([marker, note], [{ x: ERASER_RADIUS + 7, y: 0 }])).toEqual([])
  })

  it('returns nothing for an empty path', () => {
    expect(eraseHits([crossed], [])).toEqual([])
  })
})
