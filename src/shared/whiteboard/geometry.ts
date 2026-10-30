import { WHITEBOARD_GRID, isLinkable, type WhiteboardObjectInput } from './model'

/**
 * Whiteboard geometry (plan `docs/plans/whiteboards/`, prompt 02a): the pure
 * arithmetic on boxes behind the editor. Hit testing, selection boxes,
 * moving, resizing, stacking, aligning, distributing, snapping and the
 * viewport's zoom and pan. Every function returns copies and never mutates
 * what it is given, because the editor keeps every past state for undo. No
 * DOM, Electron, Node or interface words.
 *
 * Board units are pixels at 100% zoom; screen points are pixels in the
 * editor's viewport.
 */

export interface Point {
  x: number
  y: number
}
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface Size {
  width: number
  height: number
}
/** x, y: the board point at the viewport's top-left. */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** The strip along a frame's top edge that picks the frame (its title). */
export const FRAME_TITLE_BAND = 32
export const MIN_OBJECT_SIZE = 8
/** D26: zoom 10% to 400%. */
export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 4
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const
/** Screen pixels left around a board fitted to the viewport. */
export const FIT_PADDING = 48
export const RESIZE_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type ResizeHandle = (typeof RESIZE_HANDLES)[number]
export type AlignEdge = 'left' | 'hcentre' | 'right' | 'top' | 'vcentre' | 'bottom'
export type DistributeAxis = 'horizontal' | 'vertical'
/** A finer hit test for one object (prompt 03a supplies one for pen strokes and connectors). */
export type PreciseHit = (
  object: WhiteboardObjectInput,
  point: Point,
  tolerance: number
) => boolean | undefined

// --- Rectangles -------------------------------------------------------------

/** The object's box. */
export function objectRect(object: Rect): Rect {
  return { x: object.x, y: object.y, width: object.width, height: object.height }
}

export function rectCentre(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/** The smallest box holding every rect; null for none. */
export function unionRect(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const rect of rects) {
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.width)
    bottom = Math.max(bottom, rect.y + rect.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Grown by `by` on every side. */
export function expandRect(rect: Rect, by: number): Rect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    width: rect.width + 2 * by,
    height: rect.height + 2 * by
  }
}

/** The box between two drag corners, whatever their order. */
export function normaliseRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

/** Inside or on the edge, with the rect grown by `tolerance`. */
export function pointInRect(point: Point, rect: Rect, tolerance = 0): boolean {
  return (
    point.x >= rect.x - tolerance &&
    point.x <= rect.x + rect.width + tolerance &&
    point.y >= rect.y - tolerance &&
    point.y <= rect.y + rect.height + tolerance
  )
}

/** True when they overlap or touch. */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
  )
}

/** True when `inner` lies wholly inside `outer`, edges included. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  )
}

// --- Order and picking ------------------------------------------------------

interface Stacked {
  id: string
  kind: string
  z: number
}

function compareStacked(a: Stacked, b: Stacked): number {
  if (a.z !== b.z) return a.z - b.z
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** A sorted copy: every frame first, then everything else; within each by z, ties by id. */
export function drawOrder<T extends Stacked>(objects: readonly T[]): T[] {
  const frames = objects.filter((object) => object.kind === 'frame').sort(compareStacked)
  const others = objects.filter((object) => object.kind !== 'frame').sort(compareStacked)
  return [...frames, ...others]
}

/** A frame is picked by its title band or its border, never its empty middle. */
function frameHit(rect: Rect, point: Point, tolerance: number): boolean {
  if (!pointInRect(point, rect, tolerance)) return false
  if (point.y <= rect.y + FRAME_TITLE_BAND) return true
  const inner: Rect = {
    x: rect.x + tolerance,
    y: rect.y + tolerance,
    width: rect.width - 2 * tolerance,
    height: rect.height - 2 * tolerance
  }
  // Strictly inside the inner box is the frame's middle.
  return !(
    point.x > inner.x &&
    point.x < inner.x + inner.width &&
    point.y > inner.y &&
    point.y < inner.y + inner.height
  )
}

/** The front-most object under the point, or null. */
export function hitTest<T extends WhiteboardObjectInput>(
  objects: readonly T[],
  point: Point,
  tolerance: number,
  precise?: PreciseHit
): T | null {
  const ordered = drawOrder(objects)
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const object = ordered[index]
    const decided = precise?.(object, point, tolerance)
    if (decided !== undefined) {
      if (decided) return object
      continue
    }
    const rect = objectRect(object)
    const hit =
      object.kind === 'frame'
        ? frameHit(rect, point, tolerance)
        : pointInRect(point, rect, tolerance)
    if (hit) return object
  }
  return null
}

/**
 * The front-most boxed object whose edge is under the point (MOP-34): with a
 * drawing tool chosen, its border moves it without going back to Select. Ink
 * and connectors have no border to take hold of. A point inside the middle of
 * an object in front finds nothing, so a border behind it stays out of reach.
 */
export function borderHit<T extends WhiteboardObjectInput>(
  objects: readonly T[],
  point: Point,
  tolerance: number
): T | null {
  const ordered = drawOrder(objects)
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const object = ordered[index]
    const rect = objectRect(object)
    if (!pointInRect(point, rect, tolerance)) continue
    const middle =
      point.x > rect.x + tolerance &&
      point.x < rect.x + rect.width - tolerance &&
      point.y > rect.y + tolerance &&
      point.y < rect.y + rect.height - tolerance
    if (object.kind === 'pen' || object.kind === 'connector') {
      if (middle) return null
      continue
    }
    return middle ? null : object
  }
  return null
}

/** The objects whose box lies wholly inside `rect` (a selection box). */
export function objectsInRect<T extends Rect>(objects: readonly T[], rect: Rect): T[] {
  return objects.filter((object) => rectContains(rect, objectRect(object)))
}

/** `ids` plus every object sharing a non-null groupId with one of them. */
export function expandToGroups(
  objects: readonly WhiteboardObjectInput[],
  ids: Iterable<string>
): Set<string> {
  const result = new Set(ids)
  const groups = new Set<string>()
  for (const object of objects) {
    if (result.has(object.id) && object.groupId !== null) groups.add(object.groupId)
  }
  for (const object of objects) {
    if (object.groupId !== null && groups.has(object.groupId)) result.add(object.id)
  }
  return result
}

// --- Link badges (prompt 12) ------------------------------------------------

/** A link badge's side, in board units. */
export const LINK_BADGE_SIZE = 20
/** How far inside the object's top-right corner the badge sits. */
export const LINK_BADGE_INSET = 4

/**
 * The box of a linked object's link badge, inside its top-right corner; null
 * for an object without a link, a card (its link is its content), a
 * connector and a pen stroke. The scene draws the badge here and the editor
 * opens the link when it is clicked, so both read this one box.
 */
export function linkBadgeRect(object: WhiteboardObjectInput): Rect | null {
  if (object.link === null || object.kind === 'card' || !isLinkable(object)) return null
  return {
    x: object.x + object.width - LINK_BADGE_INSET - LINK_BADGE_SIZE,
    y: object.y + LINK_BADGE_INSET,
    width: LINK_BADGE_SIZE,
    height: LINK_BADGE_SIZE
  }
}

// --- Snapping, moving and resizing ------------------------------------------

/** Rounded to the nearest multiple of `grid`. */
export function snap(value: number, grid: number = WHITEBOARD_GRID): number {
  // `+ 0` turns -0 into 0.
  return Math.round(value / grid) * grid + 0
}

export function snapPoint(point: Point, grid: number = WHITEBOARD_GRID): Point {
  return { x: snap(point.x, grid), y: snap(point.y, grid) }
}

/**
 * New copies of the objects in `ids`, shifted by dx, dy; only the moved ones.
 * A pen's points are relative, so only its box moves. A connector's free ends
 * and bend points move with it; its stuck ends are left for
 * `refreshConnectors` (prompt 03a).
 */
export function moveObjects(
  objects: readonly WhiteboardObjectInput[],
  ids: Iterable<string>,
  dx: number,
  dy: number
): WhiteboardObjectInput[] {
  const selected = new Set(ids)
  const moved: WhiteboardObjectInput[] = []
  for (const object of objects) {
    if (!selected.has(object.id)) continue
    if (object.kind === 'connector') {
      const { from, to } = object.data
      moved.push({
        ...object,
        x: object.x + dx,
        y: object.y + dy,
        data: {
          ...object.data,
          from: from.objectId === null ? { ...from, x: from.x + dx, y: from.y + dy } : { ...from },
          to: to.objectId === null ? { ...to, x: to.x + dx, y: to.y + dy } : { ...to },
          ...(object.data.via
            ? { via: object.data.via.map((point) => ({ x: point.x + dx, y: point.y + dy })) }
            : {})
        }
      })
    } else {
      moved.push({ ...object, x: object.x + dx, y: object.y + dy })
    }
  }
  return moved
}

/**
 * Moves the edges `handle` names to `point`; the opposite edges stay put. No
 * side goes below `minSize`. With `keepRatio`, a corner handle keeps the
 * starting ratio, following whichever side changed more (relative to its
 * starting length); edge handles ignore it.
 */
export function resizeRect(
  rect: Rect,
  handle: ResizeHandle,
  point: Point,
  options: { keepRatio?: boolean; minSize?: number } = {}
): Rect {
  const minSize = options.minSize ?? MIN_OBJECT_SIZE
  const movesLeft = handle.includes('w')
  const movesRight = handle.includes('e')
  const movesTop = handle.includes('n')
  const movesBottom = handle.includes('s')

  let left = rect.x
  let right = rect.x + rect.width
  let top = rect.y
  let bottom = rect.y + rect.height
  if (movesLeft) left = Math.min(point.x, right - minSize)
  if (movesRight) right = Math.max(point.x, left + minSize)
  if (movesTop) top = Math.min(point.y, bottom - minSize)
  if (movesBottom) bottom = Math.max(point.y, top + minSize)

  const corner = handle.length === 2
  if (options.keepRatio && corner && rect.width > 0 && rect.height > 0) {
    const scaleX = (right - left) / rect.width
    const scaleY = (bottom - top) / rect.height
    let scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY
    scale = Math.max(scale, minSize / rect.width, minSize / rect.height)
    const width = rect.width * scale
    const height = rect.height * scale
    if (movesLeft) left = right - width
    else right = left + width
    if (movesTop) top = bottom - height
    else bottom = top + height
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Keyboard resize: the top-left stays; width and height change by dw, dh, never below minSize. */
export function resizeBy(rect: Rect, dw: number, dh: number, minSize = MIN_OBJECT_SIZE): Rect {
  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(minSize, rect.width + dw),
    height: Math.max(minSize, rect.height + dh)
  }
}

/**
 * A copy with the new box. A pen's points scale with its box (a 0-wide side
 * is left as it is) and are rounded. A connector comes back unchanged: it is
 * resized by moving its ends.
 */
export function resizeObject(object: WhiteboardObjectInput, rect: Rect): WhiteboardObjectInput {
  if (object.kind === 'connector') return object
  const box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  if (object.kind === 'pen') {
    const scaleX = object.width === 0 ? 1 : rect.width / object.width
    const scaleY = object.height === 0 ? 1 : rect.height / object.height
    const points = object.data.points.map(
      (value, index) => Math.round(value * (index % 2 === 0 ? scaleX : scaleY)) + 0
    )
    return { ...object, ...box, data: { ...object.data, points } }
  }
  return { ...object, ...box }
}

// --- Stacking ---------------------------------------------------------------

/** One more than the largest z, or 1 for an empty board. */
export function nextZ(objects: readonly { z: number }[]): number {
  if (objects.length === 0) return 1
  return Math.max(...objects.map((object) => object.z)) + 1
}

type Reorder = (order: WhiteboardObjectInput[], selected: Set<string>) => WhiteboardObjectInput[]

/**
 * Runs `reorder` on frames and on everything else separately (frames are
 * always drawn first), renumbers each group that holds a selected object to
 * 1, 2, 3… and returns the copies whose z changed.
 */
function restack(
  objects: readonly WhiteboardObjectInput[],
  ids: Iterable<string>,
  reorder: Reorder
): WhiteboardObjectInput[] {
  const selected = new Set(ids)
  const changed: WhiteboardObjectInput[] = []
  const groups = [
    objects.filter((object) => object.kind === 'frame'),
    objects.filter((object) => object.kind !== 'frame')
  ]
  for (const group of groups) {
    if (!group.some((object) => selected.has(object.id))) continue
    const order = reorder([...group].sort(compareStacked), selected)
    order.forEach((object, index) => {
      const z = index + 1
      if (object.z !== z) changed.push({ ...object, z })
    })
  }
  return changed
}

/** Each selected object moves one place past the nearest unselected object above it. */
export function bringForward(
  objects: readonly WhiteboardObjectInput[],
  ids: Iterable<string>
): WhiteboardObjectInput[] {
  return restack(objects, ids, (order, selected) => {
    for (let index = order.length - 2; index >= 0; index -= 1) {
      if (selected.has(order[index].id) && !selected.has(order[index + 1].id)) {
        ;[order[index], order[index + 1]] = [order[index + 1], order[index]]
      }
    }
    return order
  })
}

/** Each selected object moves one place past the nearest unselected object below it. */
export function sendBackward(
  objects: readonly WhiteboardObjectInput[],
  ids: Iterable<string>
): WhiteboardObjectInput[] {
  return restack(objects, ids, (order, selected) => {
    for (let index = 1; index < order.length; index += 1) {
      if (selected.has(order[index].id) && !selected.has(order[index - 1].id)) {
        ;[order[index], order[index - 1]] = [order[index - 1], order[index]]
      }
    }
    return order
  })
}

/** The selection, in its current order, moves to the front of its group. */
export function bringToFront(
  objects: readonly WhiteboardObjectInput[],
  ids: Iterable<string>
): WhiteboardObjectInput[] {
  return restack(objects, ids, (order, selected) => [
    ...order.filter((object) => !selected.has(object.id)),
    ...order.filter((object) => selected.has(object.id))
  ])
}

/** The selection, in its current order, moves to the back of its group. */
export function sendToBack(
  objects: readonly WhiteboardObjectInput[],
  ids: Iterable<string>
): WhiteboardObjectInput[] {
  return restack(objects, ids, (order, selected) => [
    ...order.filter((object) => selected.has(object.id)),
    ...order.filter((object) => !selected.has(object.id))
  ])
}

// --- Align and distribute ---------------------------------------------------

function selectedBoxes(
  objects: readonly WhiteboardObjectInput[],
  ids: Iterable<string>
): WhiteboardObjectInput[] {
  const selected = new Set(ids)
  return objects.filter((object) => selected.has(object.id) && object.kind !== 'connector')
}

/** Lines the selection up on its own bounding box. Needs two or more; returns only changed copies. */
export function align(
  objects: readonly WhiteboardObjectInput[],
  ids: Iterable<string>,
  edge: AlignEdge
): WhiteboardObjectInput[] {
  const chosen = selectedBoxes(objects, ids)
  const bounds = unionRect(chosen.map(objectRect))
  if (chosen.length < 2 || bounds === null) return []
  const changed: WhiteboardObjectInput[] = []
  for (const object of chosen) {
    let { x, y } = object
    switch (edge) {
      case 'left':
        x = bounds.x
        break
      case 'hcentre':
        x = bounds.x + (bounds.width - object.width) / 2
        break
      case 'right':
        x = bounds.x + bounds.width - object.width
        break
      case 'top':
        y = bounds.y
        break
      case 'vcentre':
        y = bounds.y + (bounds.height - object.height) / 2
        break
      case 'bottom':
        y = bounds.y + bounds.height - object.height
        break
    }
    if (x !== object.x || y !== object.y) changed.push({ ...object, x, y })
  }
  return changed
}

/**
 * Needs three or more. Sorts by left (or top), keeps the first and last in
 * place and makes the gaps between neighbours equal. Returns only changed copies.
 */
export function distribute(
  objects: readonly WhiteboardObjectInput[],
  ids: Iterable<string>,
  axis: DistributeAxis
): WhiteboardObjectInput[] {
  const chosen = selectedBoxes(objects, ids)
  if (chosen.length < 3) return []
  const start = (object: WhiteboardObjectInput) => (axis === 'horizontal' ? object.x : object.y)
  const length = (object: WhiteboardObjectInput) =>
    axis === 'horizontal' ? object.width : object.height
  const sorted = [...chosen].sort(
    (a, b) => start(a) - start(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const span = start(last) + length(last) - start(first)
  const filled = sorted.reduce((total, object) => total + length(object), 0)
  const gap = (span - filled) / (sorted.length - 1)

  const changed: WhiteboardObjectInput[] = []
  let at = start(first) + length(first) + gap
  for (const object of sorted.slice(1, -1)) {
    if (start(object) !== at) {
      changed.push(axis === 'horizontal' ? { ...object, x: at } : { ...object, y: at })
    }
    at += length(object) + gap
  }
  return changed
}

// --- Zoom and the viewport --------------------------------------------------

/** Within ZOOM_MIN to ZOOM_MAX. */
export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

const ZOOM_EPSILON = 1e-9

/** The next value in ZOOM_STEPS above (1) or below (-1) `zoom`, or the end value. */
export function nextZoomStep(zoom: number, direction: 1 | -1): number {
  if (direction === 1) {
    return ZOOM_STEPS.find((step) => step > zoom + ZOOM_EPSILON) ?? ZOOM_MAX
  }
  for (let index = ZOOM_STEPS.length - 1; index >= 0; index -= 1) {
    if (ZOOM_STEPS[index] < zoom - ZOOM_EPSILON) return ZOOM_STEPS[index]
  }
  return ZOOM_MIN
}

/** board = viewport.xy + screen / zoom */
export function screenToBoard(viewport: Viewport, point: Point): Point {
  return { x: viewport.x + point.x / viewport.zoom, y: viewport.y + point.y / viewport.zoom }
}

/** screen = (board - viewport.xy) * zoom */
export function boardToScreen(viewport: Viewport, point: Point): Point {
  return { x: (point.x - viewport.x) * viewport.zoom, y: (point.y - viewport.y) * viewport.zoom }
}

/** The viewport at the new (clamped) zoom with the board point under `screenPoint` unchanged. */
export function zoomAt(viewport: Viewport, screenPoint: Point, zoom: number): Viewport {
  const next = clampZoom(zoom)
  const anchor = screenToBoard(viewport, screenPoint)
  return { x: anchor.x - screenPoint.x / next, y: anchor.y - screenPoint.y / next, zoom: next }
}

/**
 * The viewport showing `rect` centred in a viewport of `size`, with `padding`
 * screen pixels around it. Zoom stays within ZOOM_MIN to 1, so a small board
 * is never blown up past 100%.
 */
export function fitRect(rect: Rect, size: Size, padding = FIT_PADDING): Viewport {
  const room = {
    width: Math.max(1, size.width - 2 * padding),
    height: Math.max(1, size.height - 2 * padding)
  }
  const fit = Math.min(
    rect.width > 0 ? room.width / rect.width : Infinity,
    rect.height > 0 ? room.height / rect.height : Infinity
  )
  const zoom = Math.min(1, Math.max(ZOOM_MIN, fit))
  const centre = rectCentre(rect)
  return {
    x: centre.x - size.width / (2 * zoom),
    y: centre.y - size.height / (2 * zoom),
    zoom
  }
}
