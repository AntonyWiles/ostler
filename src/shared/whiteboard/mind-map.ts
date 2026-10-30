import {
  TEXT_SIZE_UNITS,
  type MindmapObject,
  type WhiteboardColour,
  type WhiteboardObjectInput,
  type WhiteboardTextSize
} from './model'
import { SHAPE_PADDING, textBlockHeight, wrapText, type MeasureText } from './text-layout'

/**
 * Mind-map rules (plan `docs/plans/whiteboards/`, prompt 02c, decision D18):
 * the trees that `mindmap` objects form through `data.parentId` and
 * `data.order`, the automatic layout that grows to the right of the central
 * idea, the builders for new nodes and the moves the editor's keys make along
 * the tree. Every function returns copies and never mutates what it is given,
 * because the editor keeps every past state for undo. No DOM, Electron, Node
 * or interface words.
 *
 * A node with `parentId: null`, or whose parent is not on the board, is a
 * map's central idea. Every walk is guarded against cycles.
 */

export const MIND_MAP_H_GAP = 64
export const MIND_MAP_V_GAP = 16
export const MIND_MAP_ROOT_SIZE = { width: 200, height: 64 } as const
export const MIND_MAP_NODE_SIZE = { width: 160, height: 48 } as const
/** A node sized to its words (prompt 14) is at least this wide and at most `MIND_MAP_MAX_WIDTH`. */
export const MIND_MAP_MIN_WIDTH = 120
export const MIND_MAP_MAX_WIDTH = 320

/** The keyboard moves along a map: up to the parent, down to the first child, or across siblings. */
export type MindMapDirection = 'parent' | 'firstChild' | 'previous' | 'next'

/** The size a node should have, from its text (the renderer measures); absent = keep its size. */
export type MindMapNodeSize = (node: MindmapObject) => { width: number; height: number }

/** A box in board units. Kept local so this module imports only the model. */
interface Rect {
  x: number
  y: number
  width: number
  height: number
}

type Objects = readonly WhiteboardObjectInput[]

export function isMindmap(object: WhiteboardObjectInput): object is MindmapObject {
  return object.kind === 'mindmap'
}

function mindmapById(objects: Objects): Map<string, MindmapObject> {
  const map = new Map<string, MindmapObject>()
  for (const object of objects) if (isMindmap(object)) map.set(object.id, object)
  return map
}

function byOrder(a: MindmapObject, b: MindmapObject): number {
  if (a.data.order !== b.data.order) return a.data.order - b.data.order
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Every node's children, each list sorted by `order`, then `id`. */
function childrenIndex(objects: Objects): Map<string, MindmapObject[]> {
  const index = new Map<string, MindmapObject[]>()
  for (const object of objects) {
    if (!isMindmap(object) || object.data.parentId === null) continue
    const list = index.get(object.data.parentId)
    if (list) list.push(object)
    else index.set(object.data.parentId, [object])
  }
  for (const list of index.values()) list.sort(byOrder)
  return index
}

/** The node's parent, or null for a central idea (no parent, or the parent is not on the board). */
function parentOf(nodes: Map<string, MindmapObject>, node: MindmapObject): MindmapObject | null {
  return node.data.parentId === null ? null : (nodes.get(node.data.parentId) ?? null)
}

/** The central idea of the map holding `nodeId`; null when the node is missing or sits in a cycle. */
export function mindMapRoot(objects: Objects, nodeId: string): MindmapObject | null {
  const nodes = mindmapById(objects)
  let node = nodes.get(nodeId)
  const visited = new Set<string>()
  while (node) {
    if (visited.has(node.id)) return null
    visited.add(node.id)
    const parent = parentOf(nodes, node)
    if (!parent) return node
    node = parent
  }
  return null
}

/** The node's direct children, sorted by `data.order`, then `id`. */
export function mindMapChildren(objects: Objects, nodeId: string): MindmapObject[] {
  return childrenIndex(objects).get(nodeId) ?? []
}

function subtreeOf(
  nodes: Map<string, MindmapObject>,
  index: Map<string, MindmapObject[]>,
  nodeId: string
): MindmapObject[] {
  const start = nodes.get(nodeId)
  if (!start) return []
  const out: MindmapObject[] = []
  const visited = new Set<string>()
  const visit = (node: MindmapObject) => {
    if (visited.has(node.id)) return
    visited.add(node.id)
    out.push(node)
    for (const child of index.get(node.id) ?? []) visit(child)
  }
  visit(start)
  return out
}

/** The node and every descendant, depth first, children in order. Empty when the node is missing. */
export function mindMapSubtree(objects: Objects, nodeId: string): MindmapObject[] {
  return subtreeOf(mindmapById(objects), childrenIndex(objects), nodeId)
}

/** Steps from the node up to its central idea: 0 for a central idea (and for a missing node). */
export function mindMapDepth(objects: Objects, nodeId: string): number {
  const nodes = mindmapById(objects)
  let node = nodes.get(nodeId)
  const visited = new Set<string>()
  let depth = 0
  while (node) {
    visited.add(node.id)
    const parent = parentOf(nodes, node)
    if (!parent || visited.has(parent.id)) return depth
    depth += 1
    node = parent
  }
  return depth
}

/** D18: the central idea is large, its branches medium, everything further out small. */
export function textSizeForDepth(depth: number): WhiteboardTextSize {
  if (depth <= 0) return 'large'
  if (depth === 1) return 'medium'
  return 'small'
}

/**
 * Lays out the map under `rootId`, growing to the right. The central idea
 * keeps its `x` and `y`; with `size`, every node first takes that size. Each
 * child's left edge is its parent's right edge plus `MIND_MAP_H_GAP`. A
 * node's block is as tall as the larger of itself and its children's blocks
 * stacked with `MIND_MAP_V_GAP` between them; the stack is centred on the
 * parent's vertical centre, and each node on its own block. An idea dragged
 * by hand (`data.free`) keeps its place and takes no room in its parent's
 * stack; its own ideas are laid out from where it is. Returns copies of only
 * the nodes whose box changed.
 */
export function layoutMindMap(
  objects: Objects,
  rootId: string,
  size?: MindMapNodeSize
): MindmapObject[] {
  const nodes = mindmapById(objects)
  const index = childrenIndex(objects)
  const tree = subtreeOf(nodes, index, rootId)
  if (tree.length === 0) return []
  // Each node has one parent, so the children lists are disjoint; the only loop
  // possible leads back to `rootId` (when it sits in a cycle), so leave it out.
  const kids = new Map<string, MindmapObject[]>()
  for (const node of tree) {
    kids.set(
      node.id,
      (index.get(node.id) ?? []).filter((child) => child.id !== rootId)
    )
  }

  const boxes = new Map<string, Rect>()
  for (const node of tree) {
    const { width, height } = size ? size(node) : node
    boxes.set(node.id, { x: node.x, y: node.y, width, height })
  }

  /** The children the layout places: an idea dragged by hand stays where it was put. */
  const placed = (id: string) => (kids.get(id) ?? []).filter((child) => !child.data.free)

  const blocks = new Map<string, number>()
  const blockHeight = (id: string): number => {
    const known = blocks.get(id)
    if (known !== undefined) return known
    const children = placed(id)
    let stack = 0
    children.forEach((child, i) => {
      stack += blockHeight(child.id) + (i > 0 ? MIND_MAP_V_GAP : 0)
    })
    const block = Math.max(boxes.get(id)!.height, stack)
    blocks.set(id, block)
    return block
  }

  const placeChildren = (id: string) => {
    const parent = boxes.get(id)!
    for (const child of kids.get(id) ?? []) if (child.data.free) placeChildren(child.id)
    const children = placed(id)
    if (children.length === 0) return
    let stack = 0
    children.forEach((child, i) => {
      stack += blockHeight(child.id) + (i > 0 ? MIND_MAP_V_GAP : 0)
    })
    let top = parent.y + parent.height / 2 - stack / 2
    const left = parent.x + parent.width + MIND_MAP_H_GAP
    for (const child of children) {
      const block = blockHeight(child.id)
      const box = boxes.get(child.id)!
      box.x = left
      box.y = top + block / 2 - box.height / 2
      placeChildren(child.id)
      top += block + MIND_MAP_V_GAP
    }
  }
  placeChildren(rootId)

  const changed: MindmapObject[] = []
  for (const node of tree) {
    const box = boxes.get(node.id)!
    if (
      box.x !== node.x ||
      box.y !== node.y ||
      box.width !== node.width ||
      box.height !== node.height
    ) {
      changed.push({ ...node, ...box, data: { ...node.data } })
    }
  }
  return changed
}

/**
 * The size of a node from its words (prompt 14): its widest line plus
 * `SHAPE_PADDING` on each side, between `MIND_MAP_MIN_WIDTH` and
 * `MIND_MAP_MAX_WIDTH` (a central idea at least `MIND_MAP_ROOT_SIZE`'s width);
 * as tall as its words wrapped at that width, with the padding, and at least
 * its default height. Whole units. A node is a central idea when it has no
 * parent or is `rootId`. `measure` is the renderer's; tests pass a fixed one.
 */
export function mindMapNodeSize(measure: MeasureText, rootId?: string): MindMapNodeSize {
  return (node) => {
    const root = node.data.parentId === null || node.id === rootId
    const least = root ? MIND_MAP_ROOT_SIZE : MIND_MAP_NODE_SIZE
    const fontSize = TEXT_SIZE_UNITS[node.data.textSize]
    const widest = Math.max(0, ...node.text.split('\n').map((line) => measure(line, fontSize)))
    const width = Math.min(
      MIND_MAP_MAX_WIDTH,
      Math.max(root ? least.width : MIND_MAP_MIN_WIDTH, Math.ceil(widest + 2 * SHAPE_PADDING))
    )
    const lines = wrapText(node.text, width - 2 * SHAPE_PADDING, fontSize, measure).length
    const height = Math.max(
      least.height,
      Math.ceil(textBlockHeight(lines, fontSize) + 2 * SHAPE_PADDING)
    )
    return { width, height }
  }
}

/**
 * Lays out again every map that holds one of `nodeIds` (ids that are not
 * mind-map nodes on the board are ignored), each node sized to its words by
 * `mindMapNodeSize(measure)`. Returns copies of only the nodes that changed.
 */
export function relayoutMindMaps(
  objects: Objects,
  nodeIds: Iterable<string>,
  measure: MeasureText
): MindmapObject[] {
  const roots = new Set<string>()
  for (const id of nodeIds) {
    const root = mindMapRoot(objects, id)
    if (root) roots.add(root.id)
  }
  return [...roots].flatMap((rootId) =>
    layoutMindMap(objects, rootId, mindMapNodeSize(measure, rootId))
  )
}

/** Copies of the nodes of the map under `rootId` not yet in `colour`, in it. */
export function recolourMindMap(
  objects: Objects,
  rootId: string,
  colour: WhiteboardColour
): MindmapObject[] {
  return mindMapSubtree(objects, rootId)
    .filter((node) => node.colour !== colour)
    .map((node) => ({ ...node, colour, data: { ...node.data } }))
}

/** Where a node sits in its map, as its spoken name gives it (prompt 14). */
export interface MindMapPlace {
  /** 0 for the central idea. */
  depth: number
  /** 1-based place among its parent's children, in order (1 for a central idea). */
  position: number
  /** How many children its parent has (1 for a central idea). */
  siblings: number
  /** How many children it has. */
  branches: number
}

/**
 * The place of every node in a map, by id, worked out in one pass. Nodes in
 * a parent cycle are in no map and are left out.
 */
export function mindMapPlaces(objects: Objects): Map<string, MindMapPlace> {
  const nodes = mindmapById(objects)
  const index = childrenIndex(objects)
  const places = new Map<string, MindMapPlace>()
  const visit = (node: MindmapObject, depth: number, position: number, siblings: number) => {
    if (places.has(node.id)) return
    const children = index.get(node.id) ?? []
    places.set(node.id, { depth, position, siblings, branches: children.length })
    children.forEach((child, i) => visit(child, depth + 1, i + 1, children.length))
  }
  for (const node of nodes.values()) {
    if (parentOf(nodes, node) === null) visit(node, 0, 1, 1)
  }
  return places
}

/** A new central idea at `at`: `MIND_MAP_ROOT_SIZE`, blue, large text. */
export function newMindMapRoot(at: {
  id: string
  x: number
  y: number
  z: number
  text?: string
}): MindmapObject {
  return {
    id: at.id,
    kind: 'mindmap',
    x: at.x,
    y: at.y,
    ...MIND_MAP_ROOT_SIZE,
    z: at.z,
    colour: 'blue',
    text: at.text ?? '',
    link: null,
    groupId: null,
    data: { parentId: null, order: 0, textSize: 'large' }
  }
}

/**
 * A new last child of `parentId`, placed provisionally to the parent's right
 * and centred on it; the caller then runs `layoutMindMap`. Throws when the
 * parent is not a mind-map node on the board.
 */
export function addMindMapChild(
  objects: Objects,
  parentId: string,
  at: { id: string; z: number }
): MindmapObject {
  const parent = mindmapById(objects).get(parentId)
  if (!parent) throw new Error(`Mind map: ${parentId} is not a mind-map node`)
  const siblings = mindMapChildren(objects, parentId)
  const order = siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.data.order)) + 1
  return {
    id: at.id,
    kind: 'mindmap',
    x: parent.x + parent.width + MIND_MAP_H_GAP,
    y: parent.y + parent.height / 2 - MIND_MAP_NODE_SIZE.height / 2,
    ...MIND_MAP_NODE_SIZE,
    z: at.z,
    colour: parent.colour,
    text: '',
    link: null,
    groupId: null,
    data: {
      parentId,
      order,
      textSize: textSizeForDepth(mindMapDepth(objects, parentId) + 1)
    }
  }
}

/**
 * A new node straight after `nodeId` under the same parent, with the later
 * siblings' `order` moved up by one (returned as copies in `renumbered`).
 * Null for a central idea, which has no siblings, or a missing node. The new
 * node is placed provisionally just below `nodeId`; the caller then runs
 * `layoutMindMap`.
 */
export function addMindMapSibling(
  objects: Objects,
  nodeId: string,
  at: { id: string; z: number }
): { node: MindmapObject; renumbered: MindmapObject[] } | null {
  const nodes = mindmapById(objects)
  const node = nodes.get(nodeId)
  if (!node) return null
  const parent = parentOf(nodes, node)
  if (!parent) return null
  const siblings = mindMapChildren(objects, parent.id)
  const later = siblings.slice(siblings.findIndex((s) => s.id === nodeId) + 1)
  const renumbered = later.map((s) => ({ ...s, data: { ...s.data, order: s.data.order + 1 } }))
  return {
    node: {
      id: at.id,
      kind: 'mindmap',
      x: node.x,
      y: node.y + node.height + MIND_MAP_V_GAP,
      ...MIND_MAP_NODE_SIZE,
      z: at.z,
      colour: node.colour,
      text: '',
      link: null,
      groupId: null,
      data: {
        parentId: parent.id,
        order: node.data.order + 1,
        textSize: textSizeForDepth(mindMapDepth(objects, nodeId))
      }
    },
    renumbered
  }
}

/** The ids to delete with a node: the node and all its descendants. */
export function removeMindMapBranch(objects: Objects, nodeId: string): string[] {
  return mindMapSubtree(objects, nodeId).map((node) => node.id)
}

/** The node an arrow key moves to from `nodeId`, or null when there is none. */
export function mindMapNeighbour(
  objects: Objects,
  nodeId: string,
  direction: MindMapDirection
): string | null {
  const nodes = mindmapById(objects)
  const node = nodes.get(nodeId)
  if (!node) return null
  if (direction === 'firstChild') return mindMapChildren(objects, nodeId)[0]?.id ?? null
  const parent = parentOf(nodes, node)
  if (!parent) return null
  if (direction === 'parent') return parent.id
  const siblings = mindMapChildren(objects, parent.id)
  const at = siblings.findIndex((s) => s.id === nodeId)
  const target = siblings[direction === 'previous' ? at - 1 : at + 1]
  return target?.id ?? null
}

/**
 * Copies of the branch under `nodeId` shifted by `dx`, `dy`, the node itself
 * marked as placed by hand (`data.free`) so the layout leaves it there. For a
 * central idea this is `moveMindMap`.
 */
export function moveMindMapBranch(
  objects: Objects,
  nodeId: string,
  dx: number,
  dy: number
): MindmapObject[] {
  return moveMindMap(objects, nodeId, dx, dy).map((node) =>
    node.id === nodeId && node.data.parentId !== null && mindMapRoot(objects, nodeId)?.id !== nodeId
      ? { ...node, data: { ...node.data, free: true as const } }
      : node
  )
}

/** Copies of the idea back in the automatic layout: `data.free` left out. */
export function unfreeMindMapNode(node: MindmapObject): MindmapObject {
  const { free: _free, ...data } = node.data
  return { ...node, data }
}

/** Copies of every node of the map under `rootId`, shifted by `dx`, `dy`. */
export function moveMindMap(
  objects: Objects,
  rootId: string,
  dx: number,
  dy: number
): MindmapObject[] {
  return mindMapSubtree(objects, rootId).map((node) => ({
    ...node,
    x: node.x + dx,
    y: node.y + dy,
    data: { ...node.data }
  }))
}

function oneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return String(rounded === 0 ? 0 : rounded)
}

/**
 * The SVG path `d` of a branch: one cubic curve from the parent's right
 * middle to the child's left middle, both control points halfway across.
 */
export function branchPath(parent: Rect, child: Rect): string {
  const x1 = parent.x + parent.width
  const y1 = parent.y + parent.height / 2
  const x2 = child.x
  const y2 = child.y + child.height / 2
  const mx = (x1 + x2) / 2
  const [a, b, m, c, d] = [x1, y1, mx, x2, y2].map(oneDecimal)
  return `M ${a} ${b} C ${m} ${b}, ${m} ${d}, ${c} ${d}`
}
