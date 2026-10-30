import { describe, expect, it } from 'vitest'
import {
  FRAME_TITLE_BAND,
  RESIZE_HANDLES,
  ZOOM_MAX,
  ZOOM_MIN,
  align,
  boardToScreen,
  borderHit,
  bringForward,
  bringToFront,
  clampZoom,
  distribute,
  drawOrder,
  expandRect,
  expandToGroups,
  fitRect,
  LINK_BADGE_INSET,
  LINK_BADGE_SIZE,
  linkBadgeRect,
  hitTest,
  moveObjects,
  nextZ,
  nextZoomStep,
  normaliseRect,
  objectsInRect,
  pointInRect,
  rectContains,
  rectsIntersect,
  resizeBy,
  resizeObject,
  resizeRect,
  screenToBoard,
  sendBackward,
  sendToBack,
  snap,
  snapPoint,
  unionRect,
  zoomAt,
  type Rect,
  type ResizeHandle
} from '../../src/shared/whiteboard/geometry'
import {
  defaultObject,
  type ConnectorObject,
  type PenObject,
  type WhiteboardObjectInput
} from '../../src/shared/whiteboard/model'

/** Whiteboard geometry (docs/plans/whiteboards/, prompt 02a): boxes, picking, stacking and zoom. */

function note(id: string, x: number, y: number, z: number, size = 100): WhiteboardObjectInput {
  return { ...defaultObject('note', { id, x, y, z }), width: size, height: size }
}

function frame(id: string, x: number, y: number, z: number): WhiteboardObjectInput {
  return defaultObject('frame', { id, x, y, z })
}

function pen(id: string): PenObject {
  return {
    id,
    kind: 'pen',
    x: 10,
    y: 20,
    width: 100,
    height: 50,
    z: 1,
    colour: 'black',
    text: '',
    link: null,
    groupId: null,
    data: { points: [0, 0, 100, 50, 50, 25], stroke: 'medium', marker: false }
  }
}

function connector(id: string): ConnectorObject {
  return {
    id,
    kind: 'connector',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    z: 3,
    colour: 'black',
    text: '',
    link: null,
    groupId: null,
    data: {
      from: { objectId: 'a', x: 0, y: 0 },
      to: { objectId: null, x: 200, y: 100 },
      startHead: 'none',
      endHead: 'arrow',
      route: 'straight',
      stroke: 'medium',
      dashed: false
    }
  }
}

describe('rectangles', () => {
  it('unions, expands and normalises', () => {
    expect(unionRect([])).toBeNull()
    expect(
      unionRect([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: -5, width: 5, height: 5 }
      ])
    ).toEqual({ x: 0, y: -5, width: 25, height: 15 })
    expect(expandRect({ x: 10, y: 10, width: 10, height: 10 }, 2)).toEqual({
      x: 8,
      y: 8,
      width: 14,
      height: 14
    })
    expect(normaliseRect({ x: 30, y: 5 }, { x: 10, y: 25 })).toEqual({
      x: 10,
      y: 5,
      width: 20,
      height: 20
    })
  })

  it('tests points, overlaps and containment, edges included', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 }
    expect(pointInRect({ x: 10, y: 10 }, rect)).toBe(true)
    expect(pointInRect({ x: 12, y: 5 }, rect)).toBe(false)
    expect(pointInRect({ x: 12, y: 5 }, rect, 2)).toBe(true)
    expect(rectsIntersect(rect, { x: 10, y: 0, width: 5, height: 5 })).toBe(true)
    expect(rectsIntersect(rect, { x: 11, y: 0, width: 5, height: 5 })).toBe(false)
    expect(rectContains(rect, rect)).toBe(true)
    expect(rectContains(rect, { x: 5, y: 5, width: 6, height: 1 })).toBe(false)
  })
})

describe('drawOrder and hitTest', () => {
  it('draws frames first, then by z, ties by id', () => {
    const objects = [
      note('b', 0, 0, 1),
      frame('f', 0, 0, 9),
      note('a', 0, 0, 1),
      note('c', 0, 0, 0)
    ]
    expect(drawOrder(objects).map((object) => object.id)).toEqual(['f', 'c', 'a', 'b'])
  })

  it('picks the front-most of two overlapping notes', () => {
    const objects = [note('front', 50, 50, 2), note('back', 0, 0, 1)]
    expect(hitTest(objects, { x: 75, y: 75 }, 0)?.id).toBe('front')
    expect(hitTest(objects, { x: 25, y: 25 }, 0)?.id).toBe('back')
    expect(hitTest(objects, { x: 500, y: 500 }, 0)).toBeNull()
  })

  it("skips a frame's middle but hits its title band and border", () => {
    const objects = [frame('f', 0, 0, 1)]
    expect(hitTest(objects, { x: 300, y: 200 }, 4)).toBeNull()
    expect(hitTest(objects, { x: 300, y: FRAME_TITLE_BAND - 1 }, 4)?.id).toBe('f')
    expect(hitTest(objects, { x: 2, y: 200 }, 4)?.id).toBe('f')
    expect(hitTest(objects, { x: 643, y: 200 }, 4)?.id).toBe('f')
  })

  it('picks an object inside a frame', () => {
    const objects = [note('n', 100, 100, 1), frame('f', 0, 0, 5)]
    expect(hitTest(objects, { x: 150, y: 150 }, 4)?.id).toBe('n')
  })

  it('lets a precise test decide, and the box decide when it returns undefined', () => {
    const objects = [note('front', 0, 0, 2), note('back', 0, 0, 1)]
    const missFront = (object: WhiteboardObjectInput) => (object.id === 'front' ? false : undefined)
    expect(hitTest(objects, { x: 50, y: 50 }, 0, missFront)?.id).toBe('back')
    expect(hitTest(objects, { x: 50, y: 50 }, 0, () => undefined)?.id).toBe('front')
  })
})

describe('selection', () => {
  it('objectsInRect leaves out an object that only overlaps', () => {
    const objects = [note('inside', 10, 10, 1, 20), note('across', 90, 90, 1, 20)]
    const picked = objectsInRect(objects, { x: 0, y: 0, width: 100, height: 100 })
    expect(picked.map((object) => object.id)).toEqual(['inside'])
  })

  it('expandToGroups adds group members', () => {
    const objects = [
      { ...note('a', 0, 0, 1), groupId: 'g' },
      { ...note('b', 0, 0, 2), groupId: 'g' },
      { ...note('c', 0, 0, 3), groupId: 'h' },
      note('d', 0, 0, 4)
    ]
    expect([...expandToGroups(objects, ['a', 'd'])].sort()).toEqual(['a', 'b', 'd'])
  })
})

describe('snapping and moving', () => {
  it('snaps to the grid', () => {
    expect(snap(14)).toBe(10)
    expect(snap(15)).toBe(20)
    expect(snap(-4)).toBe(0)
    expect(snapPoint({ x: 7, y: 23 }, 5)).toEqual({ x: 5, y: 25 })
  })

  it("moves a connector's free end and leaves its stuck end", () => {
    const line = connector('c')
    const [moved] = moveObjects([line, note('a', 0, 0, 1)], ['c'], 10, 20) as ConnectorObject[]
    expect(moved.x).toBe(10)
    expect(moved.y).toBe(20)
    expect(moved.data.from).toEqual({ objectId: 'a', x: 0, y: 0 })
    expect(moved.data.to).toEqual({ objectId: null, x: 210, y: 120 })
    expect(line.data.to.x).toBe(200)
  })

  it('moves only the objects asked for, and a pen keeps its points', () => {
    const stroke = pen('p')
    const moved = moveObjects([stroke, note('n', 0, 0, 1)], ['p'], 5, 5) as PenObject[]
    expect(moved).toHaveLength(1)
    expect(moved[0]).toMatchObject({ x: 15, y: 25 })
    expect(moved[0].data.points).toEqual(stroke.data.points)
  })
})

describe('resizing', () => {
  const rect: Rect = { x: 100, y: 100, width: 100, height: 50 }

  it('moves only the edges each handle names', () => {
    // x 250 is right of the right edge and y 30 above the top, so the west
    // and south edges, dragged past their opposite edge, stop at the minimum size (8).
    const point = { x: 250, y: 30 }
    const expected: Record<ResizeHandle, Rect> = {
      nw: { x: 192, y: 30, width: 8, height: 120 },
      n: { x: 100, y: 30, width: 100, height: 120 },
      ne: { x: 100, y: 30, width: 150, height: 120 },
      e: { x: 100, y: 100, width: 150, height: 50 },
      se: { x: 100, y: 100, width: 150, height: 8 },
      s: { x: 100, y: 100, width: 100, height: 8 },
      sw: { x: 192, y: 100, width: 8, height: 8 },
      w: { x: 192, y: 100, width: 8, height: 50 }
    }
    for (const handle of RESIZE_HANDLES) {
      expect(resizeRect(rect, handle, point), handle).toEqual(expected[handle])
    }
  })

  it('grows from the opposite corner', () => {
    expect(resizeRect(rect, 'nw', { x: 50, y: 80 })).toEqual({
      x: 50,
      y: 80,
      width: 150,
      height: 70
    })
    expect(resizeRect(rect, 'se', { x: 260, y: 170 })).toEqual({
      x: 100,
      y: 100,
      width: 160,
      height: 70
    })
  })

  it('never goes below minSize', () => {
    expect(resizeRect(rect, 'e', { x: 0, y: 0 }, { minSize: 20 })).toEqual({
      x: 100,
      y: 100,
      width: 20,
      height: 50
    })
    expect(resizeRect(rect, 'n', { x: 0, y: 500 }, { minSize: 20 })).toEqual({
      x: 100,
      y: 130,
      width: 100,
      height: 20
    })
  })

  it('keeps the ratio on a corner, following the larger change', () => {
    // Width doubles, height barely changes: the width leads.
    expect(resizeRect(rect, 'se', { x: 300, y: 155 }, { keepRatio: true })).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 100
    })
    // Height triples: the height leads, anchored at the bottom-right.
    expect(resizeRect(rect, 'nw', { x: 90, y: 0 }, { keepRatio: true })).toEqual({
      x: -100,
      y: 0,
      width: 300,
      height: 150
    })
    // Edge handles ignore keepRatio.
    expect(resizeRect(rect, 'e', { x: 300, y: 0 }, { keepRatio: true })).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 50
    })
  })

  it('resizes by the keyboard from the top-left', () => {
    expect(resizeBy(rect, 10, -100)).toEqual({ x: 100, y: 100, width: 110, height: 8 })
  })

  it('scales pen points and leaves a connector alone', () => {
    const stroke = pen('p')
    const resized = resizeObject(stroke, { x: 0, y: 0, width: 50, height: 100 }) as PenObject
    expect(resized).toMatchObject({ x: 0, y: 0, width: 50, height: 100 })
    expect(resized.data.points).toEqual([0, 0, 50, 100, 25, 50])
    expect(stroke.data.points).toEqual([0, 0, 100, 50, 50, 25])

    const flat = { ...stroke, height: 0, data: { ...stroke.data, points: [0, 0, 100, 0] } }
    const stretched = resizeObject(flat, { x: 0, y: 0, width: 33, height: 10 }) as PenObject
    expect(stretched.data.points).toEqual([0, 0, 33, 0])

    const line = connector('c')
    expect(resizeObject(line, { x: 0, y: 0, width: 1, height: 1 })).toBe(line)
  })
})

describe('stacking', () => {
  it('nextZ is one past the top, or 1', () => {
    expect(nextZ([])).toBe(1)
    expect(nextZ([note('a', 0, 0, 4), note('b', 0, 0, 7)])).toBe(8)
  })

  it('bringForward passes one unselected object and renumbers', () => {
    const objects = [note('a', 0, 0, 5), note('b', 0, 0, 10), note('c', 0, 0, 20)]
    const changed = bringForward(objects, ['a'])
    const z = Object.fromEntries(changed.map((object) => [object.id, object.z]))
    expect(z).toEqual({ b: 1, a: 2, c: 3 })
    expect(objects[0].z).toBe(5)
  })

  it('bringForward of the top object only renumbers', () => {
    const objects = [note('a', 0, 0, 1), note('b', 0, 0, 2)]
    expect(bringForward(objects, ['b'])).toEqual([])
  })

  it('sendBackward, bringToFront and sendToBack keep the selection in order', () => {
    const objects = [1, 2, 3, 4].map((z) => note(`n${z}`, 0, 0, z))
    const order = (changed: WhiteboardObjectInput[]) =>
      drawOrder(
        objects.map((object) => changed.find((moved) => moved.id === object.id) ?? object)
      ).map((object) => object.id)
    expect(order(sendBackward(objects, ['n3', 'n4']))).toEqual(['n1', 'n3', 'n4', 'n2'])
    expect(order(bringToFront(objects, ['n1', 'n2']))).toEqual(['n3', 'n4', 'n1', 'n2'])
    expect(order(sendToBack(objects, ['n4', 'n2']))).toEqual(['n2', 'n4', 'n1', 'n3'])
  })

  it('sendToBack of a frame keeps it among frames', () => {
    const objects = [frame('f1', 0, 0, 1), frame('f2', 0, 0, 2), note('n', 0, 0, 1)]
    const changed = sendToBack(objects, ['f2'])
    expect(changed.every((object) => object.kind === 'frame')).toBe(true)
    const z = Object.fromEntries(changed.map((object) => [object.id, object.z]))
    expect(z).toEqual({ f2: 1, f1: 2 })
  })
})

describe('align and distribute', () => {
  const objects = [
    note('a', 0, 0, 1, 20),
    note('b', 50, 40, 2, 40),
    note('c', 200, 10, 3, 10),
    connector('line')
  ]

  it('aligns left edges and returns only changed copies', () => {
    const changed = align(objects, ['a', 'b', 'line'], 'left')
    expect(changed.map((object) => [object.id, object.x])).toEqual([['b', 0]])
  })

  it('aligns vertical centres on the selection box', () => {
    // a: y 0–20, b: y 40–80 → box 0–80, centre 40.
    const changed = align(objects, ['a', 'b'], 'vcentre')
    expect(changed.map((object) => [object.id, object.y])).toEqual([
      ['a', 30],
      ['b', 20]
    ])
  })

  it('needs two objects to align', () => {
    expect(align(objects, ['a', 'line'], 'left')).toEqual([])
  })

  it('distributes three objects horizontally with equal gaps', () => {
    // a: 0–20, b: 50–90, c: 200–210 → span 210, filled 70, gap 70.
    const changed = distribute(objects, ['c', 'a', 'b'], 'horizontal')
    expect(changed.map((object) => [object.id, object.x])).toEqual([['b', 90]])
    expect(distribute(objects, ['a', 'b'], 'horizontal')).toEqual([])
  })
})

describe('zoom and the viewport', () => {
  it('clamps zoom', () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN)
    expect(clampZoom(10)).toBe(ZOOM_MAX)
    expect(clampZoom(1.3)).toBe(1.3)
  })

  it('steps through the zoom steps and stops at both ends', () => {
    expect(nextZoomStep(1, 1)).toBe(1.25)
    expect(nextZoomStep(1, -1)).toBe(0.75)
    expect(nextZoomStep(1.1, -1)).toBe(1)
    expect(nextZoomStep(4, 1)).toBe(4)
    expect(nextZoomStep(0.1, -1)).toBe(0.1)
  })

  it('converts between screen and board', () => {
    const viewport = { x: 100, y: 50, zoom: 2 }
    expect(screenToBoard(viewport, { x: 40, y: 20 })).toEqual({ x: 120, y: 60 })
    expect(boardToScreen(viewport, { x: 120, y: 60 })).toEqual({ x: 40, y: 20 })
  })

  it('zoomAt keeps the point under the cursor', () => {
    const viewport = { x: 30, y: -20, zoom: 1 }
    const cursor = { x: 400, y: 300 }
    const before = screenToBoard(viewport, cursor)
    const zoomed = zoomAt(viewport, cursor, 2)
    expect(zoomed.zoom).toBe(2)
    const after = screenToBoard(zoomed, cursor)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(zoomAt(viewport, cursor, 99).zoom).toBe(ZOOM_MAX)
  })

  it('fitRect centres the rect and never zooms past 1', () => {
    const small = fitRect({ x: 0, y: 0, width: 10, height: 10 }, { width: 800, height: 600 })
    expect(small.zoom).toBe(1)
    expect(boardToScreen(small, { x: 5, y: 5 })).toEqual({ x: 400, y: 300 })

    const large = fitRect({ x: 0, y: 0, width: 2000, height: 500 }, { width: 1096, height: 600 })
    expect(large.zoom).toBeCloseTo(0.5)
    const centre = boardToScreen(large, { x: 1000, y: 250 })
    expect(centre.x).toBeCloseTo(548)
    expect(centre.y).toBeCloseTo(300)

    const huge = fitRect({ x: 0, y: 0, width: 1e6, height: 1e6 }, { width: 800, height: 600 })
    expect(huge.zoom).toBe(ZOOM_MIN)
  })
})

describe('linkBadgeRect (prompt 12)', () => {
  const ITEM =
    'ostler://task/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222'

  it('puts the badge inside the top-right corner, 4 units in, 20 across', () => {
    const linked = { ...note('n', 100, 50, 1, 200), link: 'https://example.com' }
    expect(LINK_BADGE_SIZE).toBe(20)
    expect(LINK_BADGE_INSET).toBe(4)
    expect(linkBadgeRect(linked)).toEqual({ x: 276, y: 54, width: 20, height: 20 })
  })

  it('gives every linkable kind a badge, item links and web links alike', () => {
    for (const kind of ['note', 'text', 'shape', 'frame'] as const) {
      const object = { ...defaultObject(kind, { id: kind, x: 0, y: 0, z: 1 }), link: ITEM }
      expect(linkBadgeRect(object)).not.toBeNull()
    }
  })

  it('is null for an unlinked object, a card, a connector and a pen stroke', () => {
    expect(linkBadgeRect(note('n', 0, 0, 1))).toBeNull()
    const card: WhiteboardObjectInput = {
      id: 'c',
      kind: 'card',
      x: 0,
      y: 0,
      width: 280,
      height: 72,
      z: 1,
      colour: 'black',
      text: '',
      link: ITEM,
      groupId: null,
      data: {}
    }
    expect(linkBadgeRect(card)).toBeNull()
    expect(linkBadgeRect({ ...connector('l'), link: 'https://example.com' })).toBeNull()
    expect(linkBadgeRect({ ...pen('p'), link: 'https://example.com' })).toBeNull()
  })
})

describe('borderHit (MOP-34)', () => {
  it('finds an object by its edge only, and nothing behind the middle of one in front', () => {
    const back = note('back', 0, 0, 1, 100)
    const front = note('front', 50, 50, 2, 100)
    expect(borderHit([back, front], { x: 0, y: 20 }, 4)?.id).toBe('back')
    expect(borderHit([back, front], { x: 20, y: 20 }, 4)).toBeNull()
    expect(borderHit([back, front], { x: 52, y: 80 }, 4)?.id).toBe('front')
    // The back note's edge runs under the front note's middle.
    expect(borderHit([back, front], { x: 100, y: 80 }, 4)).toBeNull()
  })

  it('takes no hold of ink', () => {
    expect(borderHit([pen('p1')], { x: 0, y: 0 }, 4)).toBeNull()
  })
})
