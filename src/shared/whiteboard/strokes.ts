import { distanceToSegment } from './connectors'
import type { Point } from './geometry'
import {
  STROKE_UNITS,
  WHITEBOARD_LIMITS,
  type PenObject,
  type WhiteboardColour,
  type WhiteboardObjectInput,
  type WhiteboardStroke
} from './model'

/**
 * Pen strokes as pure rules (plan `docs/plans/whiteboards/`, prompt 03a):
 * how wide a stroke draws, smoothing and shrinking a freshly drawn line,
 * building the pen object from it, its SVG curve, hit testing along the line
 * and what the eraser rubs out. The eraser removes whole pen strokes only.
 * Every function returns copies and never mutates what it is given. No DOM,
 * Electron, Node or interface words.
 */

/** Ramer–Douglas–Peucker tolerance for a drawn stroke, board units. */
export const SIMPLIFY_TOLERANCE = 1.5
/** How far round the eraser's path it rubs out, board units. */
export const ERASER_RADIUS = 8
/** A marker draws this many times wider than a pen of the same stroke. */
export const MARKER_WIDTH_FACTOR = 3

/** The drawn line width, board units. */
export function penWidth(pen: PenObject): number {
  const width = STROKE_UNITS[pen.data.stroke]
  return pen.data.marker ? width * MARKER_WIDTH_FACTOR : width
}

/** The stroke's points on the board. */
export function penPointsAbsolute(pen: PenObject): Point[] {
  const points: Point[] = []
  const flat = pen.data.points
  for (let index = 0; index + 1 < flat.length; index += 2) {
    points.push({ x: pen.x + flat[index], y: pen.y + flat[index + 1] })
  }
  return points
}

/** One Ramer–Douglas–Peucker pass, without recursion so long strokes cannot overflow the stack. */
function douglasPeucker(points: readonly Point[], tolerance: number): Point[] {
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number]
    let farthest = -1
    let farthestDistance = -1
    for (let index = first + 1; index < last; index += 1) {
      const distance = distanceToSegment(points[index], points[first], points[last])
      if (distance > farthestDistance) {
        farthestDistance = distance
        farthest = index
      }
    }
    if (farthest !== -1 && farthestDistance > tolerance) {
      keep[farthest] = true
      stack.push([first, farthest], [farthest, last])
    }
  }
  return points.filter((_, index) => keep[index]).map((point) => ({ x: point.x, y: point.y }))
}

/**
 * Ramer–Douglas–Peucker. The ends are always kept; while the result has more
 * than `maxPoints` points the tolerance doubles and it runs again. A single
 * point (a tap) comes back as two equal points, so a dot is a valid stroke.
 */
export function simplifyStroke(
  points: readonly Point[],
  tolerance = SIMPLIFY_TOLERANCE,
  maxPoints: number = WHITEBOARD_LIMITS.penPoints
): Point[] {
  if (points.length === 0) return []
  if (points.length === 1) return [{ ...points[0] }, { ...points[0] }]
  let current = tolerance > 0 ? tolerance : SIMPLIFY_TOLERANCE
  let result = douglasPeucker(points, current)
  while (result.length > Math.max(2, maxPoints)) {
    current *= 2
    result = douglasPeucker(points, current)
  }
  return result
}

/**
 * A pen object from points on the board: simplified, its box their bounds
 * (the top-left floored to whole units), the points stored relative to that
 * corner and rounded to integers. Throws for no points.
 */
export function penFromPoints(
  points: readonly Point[],
  at: {
    id: string
    z: number
    colour: WhiteboardColour
    stroke: WhiteboardStroke
    marker: boolean
  }
): PenObject {
  const simplified = simplifyStroke(points)
  if (simplified.length === 0) throw new Error('A pen stroke needs at least one point')
  const left = Math.floor(Math.min(...simplified.map((point) => point.x)))
  const top = Math.floor(Math.min(...simplified.map((point) => point.y)))
  const flat: number[] = []
  for (const point of simplified) {
    flat.push(Math.round(point.x - left) + 0, Math.round(point.y - top) + 0)
  }
  const xs = flat.filter((_, index) => index % 2 === 0)
  const ys = flat.filter((_, index) => index % 2 === 1)
  return {
    id: at.id,
    kind: 'pen',
    x: left,
    y: top,
    width: Math.max(...xs),
    height: Math.max(...ys),
    z: at.z,
    colour: at.colour,
    text: '',
    link: null,
    groupId: null,
    data: { points: flat, stroke: at.stroke, marker: at.marker }
  }
}

/** A number for an SVG path: one decimal, never `-0` (the same rule as `connectorPath`). */
function pathNumber(value: number): string {
  return String(Math.round(value * 10) / 10 + 0)
}

/**
 * The stroke's SVG path `d` on the board: a straight line for two points;
 * otherwise a quadratic curve through each middle point to the midpoint
 * between it and the next, ending with a line to the last point.
 */
export function strokePath(pen: PenObject): string {
  const points = penPointsAbsolute(pen)
  if (points.length === 0) return ''
  const at = (point: Point) => `${pathNumber(point.x)} ${pathNumber(point.y)}`
  const parts = [`M ${at(points[0])}`]
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]
    const next = points[index + 1]
    parts.push(`Q ${at(point)} ${at({ x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 })}`)
  }
  if (points.length > 1) parts.push(`L ${at(points[points.length - 1])}`)
  return parts.join(' ')
}

/** The shortest distance from a point to a polyline (a single point counts as a dot). */
function distanceToPolyline(point: Point, line: readonly Point[]): number {
  if (line.length === 0) return Infinity
  if (line.length === 1) return distanceToSegment(point, line[0], line[0])
  let best = Infinity
  for (let index = 0; index + 1 < line.length; index += 1) {
    best = Math.min(best, distanceToSegment(point, line[index], line[index + 1]))
  }
  return best
}

/** True when the point is within `tolerance` plus half the line's width of the stroke. */
export function strokeHit(pen: PenObject, point: Point, tolerance: number): boolean {
  return distanceToPolyline(point, penPointsAbsolute(pen)) <= tolerance + penWidth(pen) / 2
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/** The shortest distance between two segments: 0 when they cross. */
function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return 0
  }
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b)
  )
}

function segments(line: readonly Point[]): Array<[Point, Point]> {
  if (line.length === 1) return [[line[0], line[0]]]
  const result: Array<[Point, Point]> = []
  for (let index = 0; index + 1 < line.length; index += 1) {
    result.push([line[index], line[index + 1]])
  }
  return result
}

/**
 * The ids of pen strokes (markers too) that the eraser's path passes within
 * `radius` plus half the line's width of. Whole strokes only; never notes,
 * shapes, pictures or any other kind. A one-point path tests that point.
 */
export function eraseHits(
  objects: readonly WhiteboardObjectInput[],
  path: readonly Point[],
  radius = ERASER_RADIUS
): string[] {
  if (path.length === 0) return []
  const eraser = segments(path)
  const hits: string[] = []
  for (const object of objects) {
    if (object.kind !== 'pen') continue
    const reach = radius + penWidth(object) / 2
    const stroke = segments(penPointsAbsolute(object))
    const hit = eraser.some(([a, b]) =>
      stroke.some(([c, d]) => segmentDistance(a, b, c, d) <= reach)
    )
    if (hit) hits.push(object.id)
  }
  return hits
}
