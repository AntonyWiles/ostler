import { describe, expect, it } from 'vitest'
import {
  ARROW_HEAD_ANGLE,
  CONNECTOR_GAP,
  anchorPoint,
  arrowHead,
  connectorBox,
  connectorControlPoints,
  connectorGeometry,
  connectorHit,
  connectorLabelPoint,
  connectorPath,
  detachMissing,
  distanceToSegment,
  nearestAttachTarget,
  nearestNode,
  nodePoint,
  nearestStretch,
  refreshConnectors,
  sideAnchor,
  trimForHeads,
  whiteboardPreciseHit,
  withBendPoints
} from '../../src/shared/whiteboard/connectors'
import { FRAME_TITLE_BAND, hitTest, moveObjects } from '../../src/shared/whiteboard/geometry'
import {
  cleanWhiteboardObject,
  defaultObject,
  objectsById,
  type ConnectorEnd,
  type ConnectorObject,
  type PenObject,
  type ShapeObject,
  type WhiteboardObjectInput,
  type WhiteboardShape
} from '../../src/shared/whiteboard/model'

function shape(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  kind: WhiteboardShape = 'rectangle',
  z = 1
): ShapeObject {
  const made = defaultObject('shape', { id, x, y, z }) as ShapeObject
  return { ...made, width, height, data: { ...made.data, shape: kind } }
}

function note(id: string, x: number, y: number, z: number): WhiteboardObjectInput {
  return defaultObject('note', { id, x, y, z })
}

function end(objectId: string | null, x = 0, y = 0): ConnectorEnd {
  return { objectId, x, y }
}

function connector(
  id: string,
  from: ConnectorEnd,
  to: ConnectorEnd,
  route: 'straight' | 'elbow' = 'straight',
  z = 10
): ConnectorObject {
  return {
    id,
    kind: 'connector',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    z,
    colour: 'black',
    text: '',
    link: null,
    groupId: null,
    data: {
      from,
      to,
      startHead: 'none',
      endHead: 'arrow',
      route,
      stroke: 'medium',
      dashed: false
    }
  }
}

function pen(id: string, x: number, y: number, points: number[], z = 5): PenObject {
  return {
    id,
    kind: 'pen',
    x,
    y,
    width: 100,
    height: 100,
    z,
    colour: 'black',
    text: '',
    link: null,
    groupId: null,
    data: { points, stroke: 'medium', marker: false }
  }
}

/** The objects with each changed copy put in place of its original. */
function apply(
  objects: readonly WhiteboardObjectInput[],
  changed: readonly WhiteboardObjectInput[]
): WhiteboardObjectInput[] {
  const byId = objectsById(changed)
  return objects.map((object) => byId.get(object.id) ?? object)
}

function close(actual: { x: number; y: number }, expected: { x: number; y: number }): void {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
}

describe('distanceToSegment', () => {
  it('measures to the nearest point of the segment', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3)
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5)
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5)
  })
})

describe('anchorPoint', () => {
  it('leaves a rectangle through its side, the gap further out', () => {
    const box = shape('a', 0, 0, 100, 50)
    expect(anchorPoint(box, { x: 200, y: 25 })).toEqual({ x: 104, y: 25 })
    expect(anchorPoint(box, { x: 50, y: 200 })).toEqual({ x: 50, y: 54 })
  })

  it('gives the right-middle point when aimed at the centre', () => {
    expect(anchorPoint(shape('a', 0, 0, 100, 50), { x: 50, y: 25 })).toEqual({ x: 104, y: 25 })
  })

  it('lands on an ellipse, plus the gap', () => {
    const oval = shape('o', 0, 0, 200, 100, 'ellipse')
    const point = anchorPoint(oval, { x: 150, y: 75 })
    const direction = { x: 50 / Math.hypot(50, 25), y: 25 / Math.hypot(50, 25) }
    const onOutline = {
      x: point.x - direction.x * CONNECTOR_GAP,
      y: point.y - direction.y * CONNECTOR_GAP
    }
    expect(((onOutline.x - 100) / 100) ** 2 + ((onOutline.y - 50) / 50) ** 2).toBeCloseTo(1, 9)
    // On the ray from the centre toward the target point.
    expect((point.y - 50) / (point.x - 100)).toBeCloseTo(0.5, 9)
  })

  it('follows a diamond’s sloped sides', () => {
    const diamond = shape('d', 0, 0, 100, 100, 'diamond')
    close(anchorPoint(diamond, { x: 200, y: 50 }), { x: 104, y: 50 })
    const step = CONNECTOR_GAP / Math.SQRT2
    close(anchorPoint(diamond, { x: 100, y: 100 }), { x: 75 + step, y: 75 + step })
  })

  it('follows a triangle’s apex, sloped side and base', () => {
    const triangle = shape('t', 0, 0, 100, 100, 'triangle')
    close(anchorPoint(triangle, { x: 50, y: 300 }), { x: 50, y: 104 })
    close(anchorPoint(triangle, { x: 50, y: -100 }), { x: 50, y: -4 })
    close(anchorPoint(triangle, { x: 300, y: 50 }), { x: 79, y: 50 })
  })

  it('uses the box for kinds other than shapes', () => {
    close(anchorPoint(note('n', 0, 0, 1), { x: 100, y: 1000 }), { x: 100, y: 204 })
  })
})

describe('sideAnchor', () => {
  const box = shape('a', 0, 0, 100, 100)
  it('picks the side facing the other point', () => {
    expect(sideAnchor(box, { x: 400, y: 100 })).toEqual({ x: 104, y: 50 })
    expect(sideAnchor(box, { x: -400, y: 100 })).toEqual({ x: -4, y: 50 })
    expect(sideAnchor(box, { x: 60, y: 400 })).toEqual({ x: 50, y: 104 })
    expect(sideAnchor(box, { x: 60, y: -400 })).toEqual({ x: 50, y: -4 })
  })
})

describe('connectorGeometry', () => {
  const a = shape('A', 0, 0, 100, 100)
  const b = shape('B', 300, 0, 100, 100)

  it('anchors two stuck ends at the facing outlines', () => {
    const line = connector('c', end('A'), end('B'))
    const geometry = connectorGeometry(line, objectsById([a, b, line]))
    expect(geometry.start).toEqual({ x: 104, y: 50 })
    expect(geometry.end).toEqual({ x: 296, y: 50 })
    expect(geometry.points).toEqual([geometry.start, geometry.end])
  })

  it('keeps a free end where it is and aims the stuck end at it', () => {
    const line = connector('c', end('A'), end(null, 300, 200))
    const geometry = connectorGeometry(line, objectsById([a, line]))
    expect(geometry.end).toEqual({ x: 300, y: 200 })
    expect(geometry.start).toEqual(anchorPoint(a, { x: 300, y: 200 }))
  })

  it('uses the stored point of an end whose object is gone', () => {
    const line = connector('c', end('A'), end('gone', 500, 500))
    expect(connectorGeometry(line, objectsById([a, line])).end).toEqual({ x: 500, y: 500 })
  })

  it('routes an elbow across when the horizontal distance is larger', () => {
    const right = shape('B', 400, 200, 100, 100)
    const line = connector('c', end('A'), end('B'), 'elbow')
    expect(connectorGeometry(line, objectsById([a, right, line])).points).toEqual([
      { x: 104, y: 50 },
      { x: 250, y: 50 },
      { x: 250, y: 250 },
      { x: 396, y: 250 }
    ])
  })

  it('picks the elbow direction from the centres, so it leaves each side straight out', () => {
    // Between the anchors the vertical distance is larger (192 against 200),
    // but between the centres the horizontal one is (300 against 200).
    const right = shape('B', 300, 200, 100, 100)
    const line = connector('c', end('A'), end('B'), 'elbow')
    expect(connectorGeometry(line, objectsById([a, right, line])).points).toEqual([
      { x: 104, y: 50 },
      { x: 200, y: 50 },
      { x: 200, y: 250 },
      { x: 296, y: 250 }
    ])
  })

  it('routes an elbow down when the vertical distance is larger', () => {
    const below = shape('B', 100, 300, 100, 100)
    const line = connector('c', end('A'), end('B'), 'elbow')
    expect(connectorGeometry(line, objectsById([a, below, line])).points).toEqual([
      { x: 50, y: 104 },
      { x: 50, y: 200 },
      { x: 150, y: 200 },
      { x: 150, y: 296 }
    ])
  })
})

describe('connectorBox', () => {
  it('is the bounds of the points', () => {
    expect(
      connectorBox([
        { x: 10, y: 50 },
        { x: -5, y: 20 },
        { x: 30, y: 25 }
      ])
    ).toEqual({ x: -5, y: 20, width: 35, height: 30 })
  })
})

describe('refreshConnectors', () => {
  const a = shape('A', 0, 0, 100, 100)
  const b = shape('B', 300, 0, 100, 100)

  it('follows a moved object, then has nothing left to change', () => {
    const line = connector('c', end('A'), end('B'))
    let objects: WhiteboardObjectInput[] = [a, b, line]
    objects = apply(objects, refreshConnectors(objects))
    expect(refreshConnectors(objects)).toEqual([])

    objects = apply(objects, moveObjects(objects, ['B'], 100, 100))
    const before = structuredClone(objects)
    const changed = refreshConnectors(objects)
    expect(objects).toEqual(before)
    expect(changed).toHaveLength(1)
    const moved = changed[0]
    const expectedEnd = anchorPoint(objectsById(objects).get('B')!, { x: 50, y: 50 })
    expect(moved.data.to).toEqual({ objectId: 'B', ...expectedEnd })
    expect(moved.data.from.objectId).toBe('A')
    expect({ x: moved.x, y: moved.y, width: moved.width, height: moved.height }).toEqual(
      connectorBox([
        { x: moved.data.from.x, y: moved.data.from.y },
        { x: moved.data.to.x, y: moved.data.to.y }
      ])
    )
    expect(refreshConnectors(apply(objects, changed))).toEqual([])
  })

  it('with changedIds leaves unrelated connectors alone', () => {
    const c = shape('C', 0, 500, 100, 100)
    const d = shape('D', 300, 500, 100, 100)
    const first = connector('c1', end('A'), end('B'))
    const second = connector('c2', end('C'), end('D')) // stale on purpose
    const objects = apply([a, b, c, d, first, second], moveObjects([a], ['A'], 0, 10))
    expect(refreshConnectors(objects, new Set(['A'])).map((line) => line.id)).toEqual(['c1'])
    expect(refreshConnectors(objects, new Set(['c2'])).map((line) => line.id)).toEqual(['c2'])
    expect(refreshConnectors(objects).map((line) => line.id)).toEqual(['c1', 'c2'])
  })
})

describe('detachMissing', () => {
  it('frees an end stuck to a deleted object and keeps its point', () => {
    const a = shape('A', 0, 0, 100, 100)
    const line = connector('c', end('A', 104, 50), end('B', 296, 50))
    const changed = detachMissing([a, line], new Set(['B']))
    expect(changed).toHaveLength(1)
    expect(changed[0].data.from).toEqual({ objectId: 'A', x: 104, y: 50 })
    expect(changed[0].data.to).toEqual({ objectId: null, x: 296, y: 50 })
    expect(line.data.to.objectId).toBe('B')
  })

  it('frees an end whose object is no longer on the board', () => {
    const line = connector('c', end('gone', 1, 2), end(null, 3, 4))
    expect(detachMissing([line], new Set())[0].data.from).toEqual({ objectId: null, x: 1, y: 2 })
  })

  it('skips deleted connectors and leaves sound ones out', () => {
    const a = shape('A', 0, 0, 100, 100)
    const deleted = connector('c1', end('B'), end('A'))
    const sound = connector('c2', end('A'), end(null, 5, 5))
    expect(detachMissing([a, deleted, sound], new Set(['B', 'c1']))).toEqual([])
  })
})

describe('connectorHit', () => {
  it('hits along an elbow and misses inside its box away from the line', () => {
    const a = shape('A', 0, 0, 100, 100)
    const b = shape('B', 400, 200, 100, 100)
    const line = connector('c', end('A'), end('B'), 'elbow')
    const byId = objectsById([a, b, line])
    expect(connectorHit(line, byId, { x: 253, y: 150 }, 2)).toBe(true) // 3 <= 2 + 2
    expect(connectorHit(line, byId, { x: 150, y: 52 }, 2)).toBe(true)
    expect(connectorHit(line, byId, { x: 150, y: 150 }, 2)).toBe(false)
  })
})

describe('connectorLabelPoint and connectorPath', () => {
  it('finds the halfway point of an L-shaped line', () => {
    expect(
      connectorLabelPoint([
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 100, y: 10 }
      ])
    ).toEqual({ x: 45, y: 10 })
    expect(
      connectorLabelPoint([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 }
      ])
    ).toEqual({ x: 75, y: 0 })
  })

  it('writes M then L with one decimal', () => {
    expect(
      connectorPath([
        { x: 0, y: 0 },
        { x: 10.26, y: -0.01 },
        { x: 20, y: 30.04 }
      ])
    ).toBe('M 0 0 L 10.3 0 L 20 30')
  })
})

describe('arrowHead and trimForHeads', () => {
  it('matches the mark-up editor’s head for a known line', () => {
    const [tip, left, right] = arrowHead({ x: 100, y: 0 }, { x: 0, y: 0 }, 2)
    expect(tip).toEqual({ x: 100, y: 0 })
    close(left, { x: 100 - 10 * Math.cos(ARROW_HEAD_ANGLE), y: 10 * Math.sin(ARROW_HEAD_ANGLE) })
    close(right, {
      x: 100 - 10 * Math.cos(ARROW_HEAD_ANGLE),
      y: -10 * Math.sin(ARROW_HEAD_ANGLE)
    })
    // A thick line grows the head to four times its width.
    const thick = arrowHead({ x: 0, y: 100 }, { x: 0, y: 0 }, 8)
    close(thick[1], {
      x: -32 * Math.sin(ARROW_HEAD_ANGLE),
      y: 100 - 32 * Math.cos(ARROW_HEAD_ANGLE)
    })
  })

  it('pulls the line back at each end with a head', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ]
    // Head 16 for width 4; 0.8 of it is 12.8.
    expect(trimForHeads(line, true, true, 4)).toEqual([
      { x: 12.8, y: 0 },
      { x: 87.2, y: 0 }
    ])
    expect(trimForHeads(line, false, true, 4)).toEqual([
      { x: 0, y: 0 },
      { x: 87.2, y: 0 }
    ])
    expect(trimForHeads(line, false, false, 4)).toEqual(line)
  })

  it('never pulls an end back past the point before it', () => {
    const elbow = [
      { x: 0, y: 0 },
      { x: 0, y: 50 },
      { x: 5, y: 50 }
    ]
    expect(trimForHeads(elbow, false, true, 4)[2]).toEqual({ x: 0, y: 50 })
  })
})

describe('nearestAttachTarget', () => {
  const back = note('back', 0, 0, 1)
  const front = note('front', 100, 100, 2)

  it('prefers the front-most object', () => {
    expect(nearestAttachTarget([back, front], { x: 150, y: 150 })?.id).toBe('front')
    expect(nearestAttachTarget([back, front], { x: 50, y: 50 })?.id).toBe('back')
    expect(nearestAttachTarget([back, front], { x: 210, y: 50 })?.id).toBe('back')
    expect(nearestAttachTarget([back, front], { x: 1000, y: 1000 })).toBeNull()
  })

  it('ignores pens, connectors and excluded ids', () => {
    const scribble = pen('pen', 0, 0, [0, 0, 100, 100], 9)
    const line = connector('line', end(null, 0, 0), end(null, 200, 200))
    expect(nearestAttachTarget([back, scribble, line], { x: 50, y: 50 })?.id).toBe('back')
    expect(nearestAttachTarget([back, front], { x: 150, y: 150 }, 16, new Set(['front']))?.id).toBe(
      'back'
    )
  })

  it('ignores a frame’s middle but takes its border and title band', () => {
    const frame = defaultObject('frame', { id: 'frame', x: 0, y: 0, z: 1 }) // 640 × 400
    expect(nearestAttachTarget([frame], { x: 320, y: 200 })).toBeNull()
    expect(nearestAttachTarget([frame], { x: 630, y: 200 })?.id).toBe('frame')
    expect(nearestAttachTarget([frame], { x: 320, y: FRAME_TITLE_BAND - 1 })?.id).toBe('frame')
    const inside = note('inside', 200, 100, 1)
    expect(nearestAttachTarget([frame, inside], { x: 300, y: 200 })?.id).toBe('inside')
  })
})

describe('whiteboardPreciseHit', () => {
  it('lets hitTest pick a pen stroke only near its line', () => {
    const behind = note('behind', 0, 0, 1)
    const scribble = pen('pen', 0, 0, [0, 0, 100, 100], 2)
    const objects = [behind, scribble]
    const precise = whiteboardPreciseHit(objectsById(objects))
    expect(hitTest(objects, { x: 50, y: 52 }, 2, precise)?.id).toBe('pen')
    expect(hitTest(objects, { x: 90, y: 10 }, 2, precise)?.id).toBe('behind')
    expect(hitTest([scribble], { x: 90, y: 10 }, 2, precise)).toBeNull()
    expect(hitTest([scribble], { x: 90, y: 10 }, 2)?.id).toBe('pen')
  })

  it('uses the line for connectors and the box for everything else', () => {
    const line = connector('line', end(null, 0, 0), end(null, 100, 0))
    const precise = whiteboardPreciseHit(objectsById([line]))
    expect(precise(line, { x: 50, y: 3 }, 2)).toBe(true)
    expect(precise(line, { x: 50, y: 30 }, 2)).toBe(false)
    expect(precise(note('n', 0, 0, 1), { x: 5, y: 5 }, 2)).toBeUndefined()
  })
})

describe('bend points', () => {
  const free = connector('c', end(null, 0, 0), end(null, 100, 0))

  it('draws a straight line through each bend point in order', () => {
    const bent = withBendPoints(free, [
      { x: 30, y: 40 },
      { x: 70, y: 40 }
    ])
    expect(connectorGeometry(bent, new Map()).points).toEqual([
      { x: 0, y: 0 },
      { x: 30, y: 40 },
      { x: 70, y: 40 },
      { x: 100, y: 0 }
    ])
  })

  it('turns an elbow line only at right angles on its way through a bend point', () => {
    const bent = withBendPoints({ ...free, data: { ...free.data, route: 'elbow' } }, [
      { x: 50, y: 60 }
    ])
    const { points } = connectorGeometry(bent, new Map())
    expect(points[0]).toEqual({ x: 0, y: 0 })
    expect(points[points.length - 1]).toEqual({ x: 100, y: 0 })
    expect(points).toContainEqual({ x: 50, y: 60 })
    for (let index = 1; index < points.length; index += 1) {
      const [a, b] = [points[index - 1], points[index]]
      expect(a.x === b.x || a.y === b.y).toBe(true)
    }
  })

  it('aims a stuck end at its nearest bend point', () => {
    const box = shape('box', 0, 0, 100, 100)
    const line = withBendPoints(connector('c', end('box'), end(null, 400, 50)), [{ x: 50, y: 300 }])
    const { start } = connectorGeometry(line, objectsById([box]))
    // Leaves from the bottom, towards the bend point, not from the right.
    expect(start.y).toBeGreaterThan(100)
  })

  it('lists start, bend points and end, and finds the stretch nearest a point', () => {
    const bent = withBendPoints(free, [{ x: 50, y: 50 }])
    const controls = connectorControlPoints(bent, new Map())
    expect(controls).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 0 }
    ])
    expect(nearestStretch(controls, { x: 20, y: 25 })).toBe(0)
    expect(nearestStretch(controls, { x: 80, y: 25 })).toBe(1)
  })

  it('leaves via out once the last bend point goes', () => {
    const bent = withBendPoints(free, [{ x: 50, y: 50 }])
    expect('via' in withBendPoints(bent, []).data).toBe(false)
  })

  it('moves the bend points with the line', () => {
    const bent = withBendPoints(free, [{ x: 50, y: 50 }])
    const [moved] = moveObjects([bent], ['c'], 10, 20) as ConnectorObject[]
    expect(moved.data.via).toEqual([{ x: 60, y: 70 }])
  })
})

describe('node points (MOP-27)', () => {
  const box = shape('a', 0, 0, 100, 60)
  const other = shape('b', 300, 0, 100, 60, 'rectangle', 2)

  it('sits at the middle of each side', () => {
    expect(nodePoint(box, 'top', 0)).toEqual({ x: 50, y: 0 })
    expect(nodePoint(box, 'right', 0)).toEqual({ x: 100, y: 30 })
    expect(nodePoint(box, 'bottom', 0)).toEqual({ x: 50, y: 60 })
    expect(nodePoint(box, 'left', 4)).toEqual({ x: -4, y: 30 })
  })

  it('finds the nearest node within reach, never on a line or one left out', () => {
    expect(nearestNode([box, other], { x: 103, y: 32 }, 12)).toMatchObject({
      object: { id: 'a' },
      node: 'right'
    })
    expect(nearestNode([box, other], { x: 200, y: 30 }, 12)).toBeNull()
    expect(nearestNode([box], { x: 103, y: 32 }, 12, new Set(['a']))).toBeNull()
  })

  it('keeps a pinned end on its node, wherever the other end is', () => {
    const line = connector(
      'k',
      { objectId: 'a', x: 50, y: 0, node: 'top' },
      { objectId: 'b', x: 300, y: 30, node: 'left' }
    )
    const { start, end: finish } = connectorGeometry(line, objectsById([box, other, line]))
    expect(start).toEqual({ x: 50, y: -CONNECTOR_GAP })
    expect(finish).toEqual({ x: 300 - CONNECTOR_GAP, y: 30 })
  })

  it('reads a node from a saved end, drops it from a free end and refuses a wrong one', () => {
    const saved = (from: unknown) =>
      cleanWhiteboardObject({
        id: 'k',
        kind: 'connector',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        z: 1,
        data: { from, to: { objectId: null, x: 9, y: 9 } }
      })
    const pinned = saved({ objectId: 'a', x: 0, y: 0, node: 'top' })
    expect(pinned.kind === 'connector' && pinned.data.from.node).toBe('top')
    const free = saved({ objectId: null, x: 0, y: 0, node: 'top' })
    expect(free.kind === 'connector' && 'node' in free.data.from).toBe(false)
    expect(() => saved({ objectId: 'a', x: 0, y: 0, node: 'middle' })).toThrow(/node/)
  })

  it('forgets the node when the object is deleted', () => {
    const line = connector('k', { objectId: 'a', x: 50, y: 0, node: 'top' }, end(null, 9, 9))
    const [detached] = detachMissing([line], new Set(['a']))
    expect(detached.data.from).toEqual({ objectId: null, x: 50, y: 0 })
  })
})
