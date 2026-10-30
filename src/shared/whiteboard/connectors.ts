import {
  FRAME_TITLE_BAND,
  drawOrder,
  objectRect,
  pointInRect,
  rectCentre,
  type Point,
  type PreciseHit,
  type Rect
} from './geometry'
import {
  STROKE_UNITS,
  WHITEBOARD_NODES,
  type ConnectorObject,
  type WhiteboardNode,
  type WhiteboardObjectInput
} from './model'
import { strokeHit } from './strokes'

/**
 * Connectors as pure rules (plan `docs/plans/whiteboards/`, prompt 03a):
 * where a line stuck to an object leaves its outline, straight and elbow
 * routes, keeping stuck ends up to date when objects move, freeing ends whose
 * object went, hit testing along the line, the arrow head (the same head the
 * picture mark-up editor draws) and which object a dropped end sticks to.
 * Every function returns copies and never mutates what it is given. No DOM,
 * Electron, Node or interface words.
 */

/** Space left between a stuck end and its object's outline, board units. */
export const CONNECTOR_GAP = 4
/** How near an object a dropped end must land to stick to it, board units. */
export const ATTACH_TOLERANCE = 16
/** The angle between an arrow head's sides and its line (as `drawArrow`). */
export const ARROW_HEAD_ANGLE = Math.PI / 7
/** The shortest arrow head, board units (as `drawArrow`). */
export const ARROW_HEAD_MIN = 10

export interface ConnectorGeometry {
  /** The drawn polyline, start to end. */
  points: Point[]
  start: Point
  end: Point
}

/** The fraction of the head's length the line stops short of the tip (as `drawArrow`). */
const HEAD_TRIM = 0.8

// --- Distances --------------------------------------------------------------

/** The shortest distance from a point to the segment a–b. */
export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  let t = 0
  if (lengthSquared > 0) {
    t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared
    t = Math.max(0, Math.min(1, t))
  }
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

function distanceToPolyline(point: Point, line: readonly Point[]): number {
  if (line.length === 0) return Infinity
  if (line.length === 1) return Math.hypot(point.x - line[0].x, point.y - line[0].y)
  let best = Infinity
  for (let index = 0; index + 1 < line.length; index += 1) {
    best = Math.min(best, distanceToSegment(point, line[index], line[index + 1]))
  }
  return best
}

// --- Anchors ----------------------------------------------------------------

/** The target's outline as a polygon, for every outline that is not an ellipse. */
function outlinePolygon(target: WhiteboardObjectInput, rect: Rect): Point[] {
  const { x, y, width, height } = rect
  const middleX = x + width / 2
  const middleY = y + height / 2
  if (target.kind === 'shape' && target.data.shape === 'diamond') {
    return [
      { x: middleX, y },
      { x: x + width, y: middleY },
      { x: middleX, y: y + height },
      { x, y: middleY }
    ]
  }
  if (target.kind === 'shape' && target.data.shape === 'triangle') {
    return [
      { x: middleX, y },
      { x: x + width, y: y + height },
      { x, y: y + height }
    ]
  }
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height }
  ]
}

/** How far along the unit ray from `origin` it first meets the polygon's edge; 0 when it never does. */
function rayToPolygon(origin: Point, direction: Point, polygon: readonly Point[]): number {
  let best = Infinity
  for (let index = 0; index < polygon.length; index += 1) {
    const p = polygon[index]
    const q = polygon[(index + 1) % polygon.length]
    const ex = q.x - p.x
    const ey = q.y - p.y
    const denominator = direction.x * ey - direction.y * ex
    if (Math.abs(denominator) < 1e-12) continue
    const wx = p.x - origin.x
    const wy = p.y - origin.y
    const t = (wx * ey - wy * ex) / denominator
    const s = (wx * direction.y - wy * direction.x) / denominator
    if (t >= 0 && s >= -1e-9 && s <= 1 + 1e-9) best = Math.min(best, t)
  }
  return Number.isFinite(best) ? best : 0
}

/**
 * Where the ray from the target's centre toward `toward` leaves its outline,
 * pushed `gap` further out. The outline is the shape for a shape (box,
 * ellipse, rhombus through the side midpoints, or triangle with its apex at
 * the top middle) and the box for every other kind. When `toward` is the
 * centre, the right-middle point.
 */
export function anchorPoint(
  target: WhiteboardObjectInput,
  toward: Point,
  gap: number = CONNECTOR_GAP
): Point {
  const rect = objectRect(target)
  const centre = rectCentre(rect)
  const dx = toward.x - centre.x
  const dy = toward.y - centre.y
  const length = Math.hypot(dx, dy)
  const direction = length === 0 ? { x: 1, y: 0 } : { x: dx / length, y: dy / length }
  let reach: number
  if (target.kind === 'shape' && target.data.shape === 'ellipse') {
    const a = rect.width / 2
    const b = rect.height / 2
    reach =
      a > 0 && b > 0
        ? 1 / Math.sqrt((direction.x / a) ** 2 + (direction.y / b) ** 2)
        : rayToPolygon(centre, direction, outlinePolygon(target, rect))
  } else {
    reach = rayToPolygon(centre, direction, outlinePolygon(target, rect))
  }
  return {
    x: centre.x + direction.x * (reach + gap),
    y: centre.y + direction.y * (reach + gap)
  }
}

/** True when the horizontal distance is at least the vertical one (ties go horizontal). */
function horizontalLeads(dx: number, dy: number): boolean {
  return Math.abs(dx) >= Math.abs(dy)
}

/**
 * For elbow routes: the middle of the target's box side facing `toward` (left
 * or right when the horizontal distance is the larger, else top or bottom),
 * pushed `gap` out.
 */
export function sideAnchor(
  target: WhiteboardObjectInput,
  toward: Point,
  gap: number = CONNECTOR_GAP
): Point {
  const rect = objectRect(target)
  const centre = rectCentre(rect)
  const dx = toward.x - centre.x
  const dy = toward.y - centre.y
  if (horizontalLeads(dx, dy)) {
    return dx >= 0
      ? { x: rect.x + rect.width + gap, y: centre.y }
      : { x: rect.x - gap, y: centre.y }
  }
  return dy >= 0 ? { x: centre.x, y: rect.y + rect.height + gap } : { x: centre.x, y: rect.y - gap }
}

/** The objects a node point belongs to: anything a line can stick to. */
export function hasNodes(object: WhiteboardObjectInput): boolean {
  return object.kind !== 'connector' && object.kind !== 'pen'
}

/** Where one of the target's node points is (MOP-27): the middle of that side, pushed `gap` out. */
export function nodePoint(
  target: WhiteboardObjectInput,
  node: WhiteboardNode,
  gap: number = CONNECTOR_GAP
): Point {
  const rect = objectRect(target)
  const centre = rectCentre(rect)
  switch (node) {
    case 'top':
      return { x: centre.x, y: rect.y - gap }
    case 'right':
      return { x: rect.x + rect.width + gap, y: centre.y }
    case 'bottom':
      return { x: centre.x, y: rect.y + rect.height + gap }
    case 'left':
      return { x: rect.x - gap, y: centre.y }
  }
}

/**
 * The node point nearest `point` within `tolerance`, on the front-most object
 * that has one there, leaving out the ids in `exclude`; null when none is that
 * near.
 */
export function nearestNode(
  objects: readonly WhiteboardObjectInput[],
  point: Point,
  tolerance: number,
  exclude?: ReadonlySet<string>
): { object: WhiteboardObjectInput; node: WhiteboardNode } | null {
  const ordered = drawOrder(objects)
  let best: { object: WhiteboardObjectInput; node: WhiteboardNode; distance: number } | null = null
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const object = ordered[index]
    if (!hasNodes(object) || exclude?.has(object.id)) continue
    for (const node of WHITEBOARD_NODES) {
      const at = nodePoint(object, node, 0)
      const distance = Math.hypot(at.x - point.x, at.y - point.y)
      if (distance <= tolerance && (best === null || distance < best.distance)) {
        best = { object, node, distance }
      }
    }
  }
  return best && { object: best.object, node: best.node }
}

// --- Geometry ---------------------------------------------------------------

/** Each step between neighbours turned into a right angle, the first across when `firstAcross`, then alternating. */
function elbowThrough(points: readonly Point[], firstAcross: boolean): Point[] {
  const out: Point[] = [points[0]]
  let across = firstAcross
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]
    const b = points[index]
    if (a.x !== b.x && a.y !== b.y) out.push(across ? { x: b.x, y: a.y } : { x: a.x, y: b.y })
    out.push(b)
    across = !across
  }
  return out
}

/**
 * The connector's drawn line. A stuck end whose object exists sits on that
 * object's anchor, aimed at the nearest bend point, or with none at the other
 * end's reference point (its object's centre when stuck, else its x, y); any
 * other end is at its own x, y. The line passes through every bend point in
 * order; an elbow line turns its corners on the way.
 */
export function connectorGeometry(
  connector: ConnectorObject,
  byId: ReadonlyMap<string, WhiteboardObjectInput>
): ConnectorGeometry {
  const { from, to, route } = connector.data
  const via = connector.data.via ?? []
  const fromObject = from.objectId === null ? undefined : byId.get(from.objectId)
  const toObject = to.objectId === null ? undefined : byId.get(to.objectId)
  const fromRef = fromObject ? rectCentre(objectRect(fromObject)) : { x: from.x, y: from.y }
  const toRef = toObject ? rectCentre(objectRect(toObject)) : { x: to.x, y: to.y }
  const anchor = route === 'elbow' ? sideAnchor : anchorPoint
  const startAim = via[0] ?? toRef
  const endAim = via[via.length - 1] ?? fromRef
  // An end pinned to a node point (MOP-27) stays there; any other stuck end faces the other.
  const start = fromObject
    ? from.node
      ? nodePoint(fromObject, from.node)
      : anchor(fromObject, startAim)
    : { x: from.x, y: from.y }
  const end = toObject
    ? to.node
      ? nodePoint(toObject, to.node)
      : anchor(toObject, endAim)
    : { x: to.x, y: to.y }
  const bends = via.map((point) => ({ x: point.x, y: point.y }))

  if (route === 'straight') return { points: [start, ...bends, end], start, end }
  if (bends.length > 0) {
    const first = bends[0]
    return {
      points: elbowThrough(
        [start, ...bends, end],
        horizontalLeads(first.x - start.x, first.y - start.y)
      ),
      start,
      end
    }
  }
  // Decided between the reference points, the same way `sideAnchor` picks the
  // sides, so the route always leaves each object straight out of its side.
  const points: Point[] = horizontalLeads(toRef.x - fromRef.x, toRef.y - fromRef.y)
    ? [start, { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }, end]
    : [start, { x: start.x, y: (start.y + end.y) / 2 }, { x: end.x, y: (start.y + end.y) / 2 }, end]
  return { points, start, end }
}

/**
 * The points a person edits on a connector: its drawn start, each bend point
 * and its drawn end. The handles that split a line sit halfway between
 * neighbours here.
 */
export function connectorControlPoints(
  connector: ConnectorObject,
  byId: ReadonlyMap<string, WhiteboardObjectInput>
): Point[] {
  const { start, end } = connectorGeometry(connector, byId)
  return [start, ...(connector.data.via ?? []).map((point) => ({ ...point })), end]
}

/** The connector with `via` as its bend points (left out when empty). */
export function withBendPoints(connector: ConnectorObject, via: readonly Point[]): ConnectorObject {
  const { via: _via, ...data } = connector.data
  return {
    ...connector,
    data: via.length > 0 ? { ...data, via: via.map((point) => ({ ...point })) } : data
  }
}

/**
 * Which stretch of the connector's control points (`connectorControlPoints`)
 * lies nearest `point`: the index of the bend point a split there would
 * insert, 0 for the stretch from the start.
 */
export function nearestStretch(controls: readonly Point[], point: Point): number {
  let best = 0
  let bestDistance = Infinity
  for (let index = 0; index + 1 < controls.length; index += 1) {
    const distance = distanceToSegment(point, controls[index], controls[index + 1])
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  }
  return best
}

/** The bounds of the points; an empty box at 0, 0 for none. */
export function connectorBox(points: readonly Point[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
}

/**
 * Recomputes every connector (or, with `changedIds`, only those stuck to one
 * of those ids or in it themselves): the drawn start and end go into
 * `data.from` and `data.to`, and the box becomes the line's bounds. Returns
 * only the connectors that changed, as copies.
 */
export function refreshConnectors(
  objects: readonly WhiteboardObjectInput[],
  changedIds?: ReadonlySet<string>
): ConnectorObject[] {
  const byId = new Map(objects.map((object) => [object.id, object]))
  const changed: ConnectorObject[] = []
  for (const object of objects) {
    if (object.kind !== 'connector') continue
    const { from, to } = object.data
    if (
      changedIds &&
      !changedIds.has(object.id) &&
      !(from.objectId !== null && changedIds.has(from.objectId)) &&
      !(to.objectId !== null && changedIds.has(to.objectId))
    ) {
      continue
    }
    const geometry = connectorGeometry(object, byId)
    const box = connectorBox(geometry.points)
    const same =
      from.x === geometry.start.x &&
      from.y === geometry.start.y &&
      to.x === geometry.end.x &&
      to.y === geometry.end.y &&
      object.x === box.x &&
      object.y === box.y &&
      object.width === box.width &&
      object.height === box.height
    if (same) continue
    changed.push({
      ...object,
      ...box,
      data: {
        ...object.data,
        from: { ...from, x: geometry.start.x, y: geometry.start.y },
        to: { ...to, x: geometry.end.x, y: geometry.end.y }
      }
    })
  }
  return changed
}

/**
 * Frees each connector end stuck to a deleted id, or to an id no longer among
 * `objects`; the end keeps its last drawn point. Deleted connectors are
 * skipped. Returns changed copies.
 */
export function detachMissing(
  objects: readonly WhiteboardObjectInput[],
  deletedIds: ReadonlySet<string>
): ConnectorObject[] {
  const present = new Set(objects.map((object) => object.id))
  const gone = (id: string | null) => id !== null && (deletedIds.has(id) || !present.has(id))
  const changed: ConnectorObject[] = []
  for (const object of objects) {
    if (object.kind !== 'connector' || deletedIds.has(object.id)) continue
    const { from, to } = object.data
    if (!gone(from.objectId) && !gone(to.objectId)) continue
    changed.push({
      ...object,
      data: {
        ...object.data,
        from: gone(from.objectId) ? { objectId: null, x: from.x, y: from.y } : { ...from },
        to: gone(to.objectId) ? { objectId: null, x: to.x, y: to.y } : { ...to }
      }
    })
  }
  return changed
}

// --- Hit testing, labels and drawing ----------------------------------------

/** True when the point is within `tolerance` plus half the line's width of the connector. */
export function connectorHit(
  connector: ConnectorObject,
  byId: ReadonlyMap<string, WhiteboardObjectInput>,
  point: Point,
  tolerance: number
): boolean {
  const { points } = connectorGeometry(connector, byId)
  return distanceToPolyline(point, points) <= tolerance + STROKE_UNITS[connector.data.stroke] / 2
}

/** The point halfway along the polyline's length. */
export function connectorLabelPoint(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  const lengths: number[] = []
  let total = 0
  for (let index = 0; index + 1 < points.length; index += 1) {
    const length = Math.hypot(
      points[index + 1].x - points[index].x,
      points[index + 1].y - points[index].y
    )
    lengths.push(length)
    total += length
  }
  let remaining = total / 2
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]
    if (length > 0 && remaining <= length) {
      const t = remaining / length
      const a = points[index]
      const b = points[index + 1]
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    remaining -= length
  }
  return { ...points[0] }
}

/** A number for an SVG path: one decimal, never `-0` (the same rule as `strokePath`). */
function pathNumber(value: number): string {
  return String(Math.round(value * 10) / 10 + 0)
}

/** The SVG path `d` for the polyline: `M` then `L` for each further point. */
export function connectorPath(points: readonly Point[]): string {
  return points
    .map(
      (point, index) => `${index === 0 ? 'M' : 'L'} ${pathNumber(point.x)} ${pathNumber(point.y)}`
    )
    .join(' ')
}

function headLength(strokeWidth: number): number {
  return Math.max(ARROW_HEAD_MIN, strokeWidth * 4)
}

/** The arrow head as a triangle: the tip, then its two back corners (as `drawArrow`). */
export function arrowHead(tip: Point, from: Point, strokeWidth: number): [Point, Point, Point] {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
  const head = headLength(strokeWidth)
  return [
    { x: tip.x, y: tip.y },
    {
      x: tip.x - head * Math.cos(angle - ARROW_HEAD_ANGLE),
      y: tip.y - head * Math.sin(angle - ARROW_HEAD_ANGLE)
    },
    {
      x: tip.x - head * Math.cos(angle + ARROW_HEAD_ANGLE),
      y: tip.y - head * Math.sin(angle + ARROW_HEAD_ANGLE)
    }
  ]
}

/**
 * `tip` pulled back toward the nearest point before it in `line` that differs
 * from it, by `amount`, never past that point.
 */
function pullBack(tip: Point, line: readonly Point[], amount: number): Point {
  const previous = line.find((point) => point.x !== tip.x || point.y !== tip.y)
  if (!previous) return { ...tip }
  const length = Math.hypot(tip.x - previous.x, tip.y - previous.y)
  const step = Math.min(amount, length)
  return {
    x: tip.x - ((tip.x - previous.x) / length) * step,
    y: tip.y - ((tip.y - previous.y) / length) * step
  }
}

/**
 * The line pulled back by 0.8 of the head's length at each end with a head,
 * so a thick line never pokes through the tip (as `drawArrow`). An end is
 * never pulled back past the point before it.
 */
export function trimForHeads(
  points: readonly Point[],
  startHead: boolean,
  endHead: boolean,
  strokeWidth: number
): Point[] {
  const result = points.map((point) => ({ x: point.x, y: point.y }))
  if (result.length < 2) return result
  const amount = headLength(strokeWidth) * HEAD_TRIM
  const last = result.length - 1
  if (endHead) result[last] = pullBack(points[last], [...points.slice(0, last)].reverse(), amount)
  if (startHead) result[0] = pullBack(points[0], points.slice(1), amount)
  return result
}

// --- Sticking ends ----------------------------------------------------------

/** A frame takes an end only near its border or in its title band. */
function frameAttaches(rect: Rect, point: Point, tolerance: number): boolean {
  if (!pointInRect(point, rect, tolerance)) return false
  if (point.y <= rect.y + FRAME_TITLE_BAND) return true
  return !(
    point.x > rect.x + tolerance &&
    point.x < rect.x + rect.width - tolerance &&
    point.y > rect.y + tolerance &&
    point.y < rect.y + rect.height - tolerance
  )
}

/**
 * The front-most object an end dropped at `point` would stick to: its box
 * grown by `tolerance` holds the point. Connectors, pen strokes and ids in
 * `exclude` never count; a frame counts only near its border or in its title
 * band, so ends can be dropped on objects inside it.
 */
export function nearestAttachTarget(
  objects: readonly WhiteboardObjectInput[],
  point: Point,
  tolerance: number = ATTACH_TOLERANCE,
  exclude?: ReadonlySet<string>
): WhiteboardObjectInput | null {
  const ordered = drawOrder(objects)
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const object = ordered[index]
    if (object.kind === 'connector' || object.kind === 'pen' || exclude?.has(object.id)) continue
    const rect = objectRect(object)
    const hit =
      object.kind === 'frame'
        ? frameAttaches(rect, point, tolerance)
        : pointInRect(point, rect, tolerance)
    if (hit) return object
  }
  return null
}

/**
 * The finer hit test for `hitTest`: along the line for pen strokes and
 * connectors, the box (undefined) for every other kind.
 */
export function whiteboardPreciseHit(byId: ReadonlyMap<string, WhiteboardObjectInput>): PreciseHit {
  return (object, point, tolerance) => {
    if (object.kind === 'pen') return strokeHit(object, point, tolerance)
    if (object.kind === 'connector') return connectorHit(object, byId, point, tolerance)
    return undefined
  }
}
