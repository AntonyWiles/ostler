import { describe, expect, it } from 'vitest'
import type { MindmapObject, WhiteboardObjectInput } from '../../src/shared/whiteboard/model'
import {
  MIND_MAP_H_GAP,
  MIND_MAP_NODE_SIZE,
  MIND_MAP_ROOT_SIZE,
  MIND_MAP_V_GAP,
  addMindMapChild,
  addMindMapSibling,
  branchPath,
  isMindmap,
  layoutMindMap,
  mindMapChildren,
  mindMapDepth,
  mindMapNeighbour,
  mindMapNodeSize,
  mindMapPlaces,
  mindMapRoot,
  mindMapSubtree,
  moveMindMap,
  moveMindMapBranch,
  newMindMapRoot,
  recolourMindMap,
  relayoutMindMaps,
  removeMindMapBranch,
  textSizeForDepth,
  unfreeMindMapNode
} from '../../src/shared/whiteboard/mind-map'

/** Mind-map rules (docs/plans/whiteboards/, prompt 02c, D18): trees, layout, builders and moves. */

function node(
  id: string,
  parentId: string | null,
  order = 0,
  box: Partial<Pick<MindmapObject, 'x' | 'y' | 'width' | 'height'>> = {}
): MindmapObject {
  return {
    id,
    kind: 'mindmap',
    x: 0,
    y: 0,
    ...MIND_MAP_NODE_SIZE,
    ...box,
    z: 1,
    colour: 'green',
    text: '',
    link: null,
    groupId: null,
    data: { parentId, order, textSize: 'medium' }
  }
}

const note: WhiteboardObjectInput = {
  id: 'note',
  kind: 'note',
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  z: 0,
  colour: 'yellow',
  text: '',
  link: null,
  groupId: null,
  data: { textSize: 'medium' }
}

/** root → a, b, c; a → a1, a2. */
function sampleMap(): WhiteboardObjectInput[] {
  return [
    note,
    { ...node('root', null), ...MIND_MAP_ROOT_SIZE },
    node('c', 'root', 2),
    node('a', 'root', 0),
    node('b', 'root', 1),
    node('a2', 'a', 1),
    node('a1', 'a', 0)
  ]
}

const ids = (list: { id: string }[]) => list.map((o) => o.id)

describe('trees', () => {
  it('isMindmap checks the kind', () => {
    expect(isMindmap(note)).toBe(false)
    expect(isMindmap(node('x', null))).toBe(true)
  })

  it('finds the central idea from a grandchild', () => {
    expect(mindMapRoot(sampleMap(), 'a2')?.id).toBe('root')
    expect(mindMapRoot(sampleMap(), 'root')?.id).toBe('root')
    expect(mindMapRoot(sampleMap(), 'nope')).toBeNull()
  })

  it('returns null for a cycle', () => {
    const objects = [node('p', 'q'), node('q', 'p')]
    expect(mindMapRoot(objects, 'p')).toBeNull()
  })

  it('treats a node whose parent is missing as a central idea', () => {
    const objects = [node('orphan', 'gone'), node('kid', 'orphan')]
    expect(mindMapRoot(objects, 'kid')?.id).toBe('orphan')
    expect(mindMapDepth(objects, 'orphan')).toBe(0)
  })

  it('sorts children by order, then id', () => {
    const objects = [node('r', null), node('z', 'r', 1), node('y', 'r', 1), node('x', 'r', 0)]
    expect(ids(mindMapChildren(objects, 'r'))).toEqual(['x', 'y', 'z'])
    expect(mindMapChildren(objects, 'x')).toEqual([])
  })

  it('lists a subtree depth first and is safe against cycles', () => {
    expect(ids(mindMapSubtree(sampleMap(), 'root'))).toEqual(['root', 'a', 'a1', 'a2', 'b', 'c'])
    expect(ids(mindMapSubtree([node('p', 'q'), node('q', 'p')], 'p'))).toEqual(['p', 'q'])
  })

  it('measures depth and picks a text size for it', () => {
    expect(mindMapDepth(sampleMap(), 'root')).toBe(0)
    expect(mindMapDepth(sampleMap(), 'a')).toBe(1)
    expect(mindMapDepth(sampleMap(), 'a1')).toBe(2)
    expect(textSizeForDepth(0)).toBe('large')
    expect(textSizeForDepth(1)).toBe('medium')
    expect(textSizeForDepth(2)).toBe('small')
    expect(textSizeForDepth(5)).toBe('small')
  })
})

describe('layoutMindMap', () => {
  const root = { ...node('root', null, 0, { x: 100, y: 200 }), ...MIND_MAP_ROOT_SIZE }

  it('puts three children in a column to the right, centred on the root', () => {
    const objects = [root, node('a', 'root', 0), node('b', 'root', 1), node('c', 'root', 2)]
    const changed = layoutMindMap(objects, 'root')
    expect(ids(changed)).toEqual(['a', 'b', 'c'])
    const left = root.x + root.width + MIND_MAP_H_GAP
    const h = MIND_MAP_NODE_SIZE.height
    const stack = 3 * h + 2 * MIND_MAP_V_GAP
    const top = root.y + root.height / 2 - stack / 2
    expect(changed.map((o) => [o.x, o.y])).toEqual([
      [left, top],
      [left, top + h + MIND_MAP_V_GAP],
      [left, top + 2 * (h + MIND_MAP_V_GAP)]
    ])
    // The central idea keeps its place.
    expect(changed.find((o) => o.id === 'root')).toBeUndefined()
    // The input is untouched.
    expect(objects[1].x).toBe(0)

    const next = objects.map((o) => changed.find((c) => c.id === o.id) ?? o)
    expect(layoutMindMap(next, 'root')).toEqual([])
  })

  it('gives a child with two children of its own a taller block', () => {
    const objects = [
      root,
      node('a', 'root', 0),
      node('b', 'root', 1),
      node('a1', 'a', 0),
      node('a2', 'a', 1)
    ]
    const byId = new Map(layoutMindMap(objects, 'root').map((o) => [o.id, o]))
    const h = MIND_MAP_NODE_SIZE.height
    const aBlock = 2 * h + MIND_MAP_V_GAP
    const stack = aBlock + MIND_MAP_V_GAP + h
    const top = root.y + root.height / 2 - stack / 2
    const a = byId.get('a')!
    const b = byId.get('b')!
    expect(a.y).toBe(top + aBlock / 2 - h / 2)
    expect(b.y).toBe(top + aBlock + MIND_MAP_V_GAP)
    expect(byId.get('a1')!.x).toBe(a.x + a.width + MIND_MAP_H_GAP)
    expect(byId.get('a1')!.y).toBe(top)
    expect(byId.get('a2')!.y).toBe(top + h + MIND_MAP_V_GAP)
  })

  it('applies the size callback first', () => {
    const objects = [root, node('a', 'root', 0)]
    const changed = layoutMindMap(objects, 'root', (n) =>
      n.id === 'root' ? { width: 300, height: 100 } : { width: 90, height: 30 }
    )
    const byId = new Map(changed.map((o) => [o.id, o]))
    expect(byId.get('root')).toMatchObject({ x: 100, y: 200, width: 300, height: 100 })
    expect(byId.get('a')).toMatchObject({ x: 100 + 300 + MIND_MAP_H_GAP, y: 235, width: 90 })
  })

  it('returns nothing for a missing root', () => {
    expect(layoutMindMap(sampleMap(), 'nope')).toEqual([])
  })
})

describe('builders', () => {
  it('newMindMapRoot makes a blue central idea', () => {
    expect(newMindMapRoot({ id: 'r', x: 5, y: 6, z: 7 })).toEqual({
      id: 'r',
      kind: 'mindmap',
      x: 5,
      y: 6,
      width: 200,
      height: 64,
      z: 7,
      colour: 'blue',
      text: '',
      link: null,
      groupId: null,
      data: { parentId: null, order: 0, textSize: 'large' }
    })
    expect(newMindMapRoot({ id: 'r', x: 0, y: 0, z: 0, text: 'Idea' }).text).toBe('Idea')
  })

  it('addMindMapChild picks the next order and the depth text size', () => {
    const objects = sampleMap()
    const child = addMindMapChild(objects, 'a', { id: 'a3', z: 9 })
    expect(child.data).toEqual({ parentId: 'a', order: 2, textSize: 'small' })
    expect(child).toMatchObject({ ...MIND_MAP_NODE_SIZE, colour: 'green', text: '', z: 9 })
    expect(child.x).toBe(MIND_MAP_NODE_SIZE.width + MIND_MAP_H_GAP)

    const first = addMindMapChild(objects, 'b', { id: 'b1', z: 1 })
    expect(first.data.order).toBe(0)
    expect(addMindMapChild(objects, 'root', { id: 'd', z: 1 }).data.textSize).toBe('medium')
    expect(() => addMindMapChild(objects, 'nope', { id: 'x', z: 1 })).toThrow()
  })

  it('addMindMapSibling renumbers later siblings and refuses a central idea', () => {
    const objects = sampleMap()
    const result = addMindMapSibling(objects, 'a', { id: 'new', z: 3 })!
    expect(result.node.data).toEqual({ parentId: 'root', order: 1, textSize: 'medium' })
    expect(result.renumbered.map((o) => [o.id, o.data.order])).toEqual([
      ['b', 2],
      ['c', 3]
    ])
    // Copies: the input keeps its numbers.
    expect(mindMapChildren(objects, 'root').map((o) => o.data.order)).toEqual([0, 1, 2])

    expect(addMindMapSibling(objects, 'c', { id: 'n', z: 1 })!.renumbered).toEqual([])
    expect(addMindMapSibling(objects, 'root', { id: 'n', z: 1 })).toBeNull()
  })

  it('removeMindMapBranch lists the whole branch', () => {
    expect(removeMindMapBranch(sampleMap(), 'a')).toEqual(['a', 'a1', 'a2'])
    expect(removeMindMapBranch(sampleMap(), 'root')).toHaveLength(6)
  })
})

describe('moves', () => {
  it('mindMapNeighbour moves in all four directions', () => {
    const objects = sampleMap()
    expect(mindMapNeighbour(objects, 'a1', 'parent')).toBe('a')
    expect(mindMapNeighbour(objects, 'root', 'parent')).toBeNull()
    expect(mindMapNeighbour(objects, 'root', 'firstChild')).toBe('a')
    expect(mindMapNeighbour(objects, 'b', 'firstChild')).toBeNull()
    expect(mindMapNeighbour(objects, 'b', 'previous')).toBe('a')
    expect(mindMapNeighbour(objects, 'a', 'previous')).toBeNull()
    expect(mindMapNeighbour(objects, 'b', 'next')).toBe('c')
    expect(mindMapNeighbour(objects, 'c', 'next')).toBeNull()
    expect(mindMapNeighbour(objects, 'root', 'next')).toBeNull()
  })

  it('moveMindMap shifts copies of every node of the map', () => {
    const objects = sampleMap()
    const moved = moveMindMap(objects, 'root', 10, -5)
    expect(moved).toHaveLength(6)
    expect(moved.every((o) => o.x === 10 && o.y === -5)).toBe(true)
    expect((objects[1] as MindmapObject).x).toBe(0)
  })

  it('branchPath draws one curve from right-middle to left-middle', () => {
    const path = branchPath(
      { x: 0, y: 0, width: 200, height: 64 },
      { x: 264, y: 10.25, width: 160, height: 48 }
    )
    expect(path).toBe('M 200 32 C 232 32, 232 34.3, 264 34.3')
  })
})

describe('sizing to words, colour and places (prompt 14)', () => {
  /** A fixed measure: every character is 10 units wide, whatever the size. */
  const tenPerChar = (text: string) => text.length * 10
  const size = mindMapNodeSize(tenPerChar)
  const withText = (base: MindmapObject, text: string): MindmapObject => ({ ...base, text })

  it('mindMapNodeSize keeps short words at the default size', () => {
    expect(size(withText(node('n', 'p'), 'Venue'))).toEqual({ width: 120, height: 48 })
    expect(size(newMindMapRoot({ id: 'r', x: 0, y: 0, z: 1 }))).toEqual(MIND_MAP_ROOT_SIZE)
    expect(size(newMindMapRoot({ id: 'r', x: 0, y: 0, z: 1, text: 'Launch' }))).toEqual(
      MIND_MAP_ROOT_SIZE
    )
  })

  it('mindMapNodeSize widens to the widest line and wraps beyond 320 units', () => {
    // Widest line 150 + 2 × 12 padding; two lines of 18-unit text plus padding.
    expect(size(withText(node('n', 'p'), 'a\nbbbbbbbbbbbbbbb'))).toEqual({ width: 174, height: 71 })
    const long = withText(node('n', 'p'), 'one two three four five six seven eight')
    expect(size(long)).toEqual({ width: 320, height: 71 })
  })

  it('mindMapNodeSize treats rootId as a central idea even with a parent', () => {
    const orphan = node('o', 'gone')
    expect(mindMapNodeSize(tenPerChar, 'o')(orphan).width).toBe(200)
    expect(size(orphan).width).toBe(120)
  })

  it('relayoutMindMaps lays out the whole map of any node it is given', () => {
    const objects = sampleMap().map((o) =>
      o.id === 'a' ? withText(o as MindmapObject, 'abcdefghijklmnopqrst') : o
    )
    const changed = new Map(relayoutMindMaps(objects, ['a1'], tenPerChar).map((o) => [o.id, o]))
    expect(changed.get('a')).toMatchObject({ x: 200 + MIND_MAP_H_GAP, width: 224 })
    expect(changed.get('a1')).toMatchObject({ x: 200 + MIND_MAP_H_GAP + 224 + MIND_MAP_H_GAP })
    expect(changed.has('root')).toBe(false)
    expect(relayoutMindMaps(objects, ['note', 'missing'], tenPerChar)).toEqual([])
  })

  it('recolourMindMap returns only the nodes not yet in the colour', () => {
    expect(ids(recolourMindMap(sampleMap(), 'root', 'blue')).sort()).toEqual(
      ['a', 'a1', 'a2', 'b', 'c', 'root'].sort()
    )
    expect(recolourMindMap(sampleMap(), 'root', 'green')).toEqual([])
    expect(recolourMindMap(sampleMap(), 'a', 'blue').every((o) => o.colour === 'blue')).toBe(true)
  })

  it('mindMapPlaces gives each node its level, place among siblings and branches', () => {
    const places = mindMapPlaces(sampleMap())
    expect(places.get('root')).toEqual({ depth: 0, position: 1, siblings: 1, branches: 3 })
    expect(places.get('a')).toEqual({ depth: 1, position: 1, siblings: 3, branches: 2 })
    expect(places.get('c')).toEqual({ depth: 1, position: 3, siblings: 3, branches: 0 })
    expect(places.get('a2')).toEqual({ depth: 2, position: 2, siblings: 2, branches: 0 })
    expect(places.has('note')).toBe(false)
    const cycle = [node('x', 'y'), node('y', 'x')]
    expect(mindMapPlaces(cycle).size).toBe(0)
  })
})

describe('ideas dragged by hand', () => {
  function laid(objects: MindmapObject[]): MindmapObject[] {
    const changed = new Map(layoutMindMap(objects, 'root').map((o) => [o.id, o]))
    return objects.map((o) => changed.get(o.id) ?? o)
  }
  const start = () =>
    laid([
      node('root', null, 0, MIND_MAP_ROOT_SIZE),
      node('a', 'root', 0),
      node('b', 'root', 1),
      node('b1', 'b', 0)
    ])
  const byId = (objects: readonly MindmapObject[]) => new Map(objects.map((o) => [o.id, o]))
  const movedB = () => {
    const objects = start()
    const moved = byId(moveMindMapBranch(objects, 'b', 30, 200))
    return { objects, moved, after: objects.map((o) => moved.get(o.id) ?? o) }
  }

  it('moves the branch and marks only its idea as placed by hand', () => {
    const { objects, moved } = movedB()
    const before = byId(objects)
    expect([...moved.keys()].sort()).toEqual(['b', 'b1'])
    expect(moved.get('b')).toMatchObject({ x: before.get('b')!.x + 30, data: { free: true } })
    expect(moved.get('b1')!.y).toBe(before.get('b1')!.y + 200)
    expect(moved.get('b1')!.data.free).toBeUndefined()
  })

  it('never marks a central idea', () => {
    const root = moveMindMapBranch(start(), 'root', 10, 10).find((o) => o.id === 'root')!
    expect(root.data.free).toBeUndefined()
  })

  it('keeps a free idea where it was put, lays its ideas out from there, and gives its room back', () => {
    const { moved, after } = movedB()
    const laidOut = byId(laid(after))
    expect(laidOut.get('b')).toMatchObject({ x: moved.get('b')!.x, y: moved.get('b')!.y })
    expect(laidOut.get('b1')!.x).toBe(
      laidOut.get('b')!.x + MIND_MAP_NODE_SIZE.width + MIND_MAP_H_GAP
    )
    // a is alone in the stack now: centred on the central idea.
    const root = laidOut.get('root')!
    const a = laidOut.get('a')!
    expect(a.y + a.height / 2).toBe(root.y + root.height / 2)
  })

  it('goes back into the layout once unfreed', () => {
    const { objects, after } = movedB()
    const freed = after.map((o) => (o.id === 'b' ? unfreeMindMapNode(o) : o))
    expect('free' in freed.find((o) => o.id === 'b')!.data).toBe(false)
    const b = objects.find((o) => o.id === 'b')!
    expect(byId(laid(freed)).get('b')).toMatchObject({ x: b.x, y: b.y })
  })
})
