import { BRAND } from '../brand'
import { itemLinkTarget, itemLinkUrl, type ItemLinkRef } from '../item-links'
import type { LibraryItem } from '../ostler-api/library-types'

/**
 * The whiteboard object model (plan `docs/plans/whiteboards/`, decision D8):
 * what an object on a whiteboard is, its kinds, palette, sizes and limits,
 * and the one validator every reader and writer goes through. The main
 * process, the renderer and the tests all use this module, so it stays pure:
 * no DOM, Electron, Node or interface words. Its error messages are English
 * for developers and logs, never shown as interface text.
 *
 * Board units are pixels at 100% zoom. Colours are palette names (D9), never
 * colour values; each object has at most one link, an item link or a web
 * address (D10).
 */

// --- Kinds, palette and named sizes -----------------------------------------

export const WHITEBOARD_OBJECT_KINDS = [
  'note',
  'text',
  'shape',
  'connector',
  'pen',
  'image',
  'card',
  'frame',
  'mindmap'
] as const
export type WhiteboardObjectKind = (typeof WHITEBOARD_OBJECT_KINDS)[number]

/** D9: the palette of ten. Code stores the name; tokens draw it. */
export const WHITEBOARD_COLOURS = [
  'black',
  'grey',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink'
] as const
export type WhiteboardColour = (typeof WHITEBOARD_COLOURS)[number]

export const WHITEBOARD_TEXT_SIZES = ['small', 'medium', 'large', 'huge'] as const
export type WhiteboardTextSize = (typeof WHITEBOARD_TEXT_SIZES)[number]
/** D29: text sizes in board units. */
export const TEXT_SIZE_UNITS: Record<WhiteboardTextSize, number> = {
  small: 14,
  medium: 18,
  large: 28,
  huge: 44
}

export const WHITEBOARD_STROKES = ['thin', 'medium', 'thick'] as const
export type WhiteboardStroke = (typeof WHITEBOARD_STROKES)[number]
/** D29: stroke widths in board units. */
export const STROKE_UNITS: Record<WhiteboardStroke, number> = { thin: 2, medium: 4, thick: 8 }

export const WHITEBOARD_SHAPES = ['rectangle', 'rounded', 'ellipse', 'diamond', 'triangle'] as const
export type WhiteboardShape = (typeof WHITEBOARD_SHAPES)[number]
export const SHAPE_FILLS = ['none', 'light', 'solid'] as const
export type ShapeFill = (typeof SHAPE_FILLS)[number]
export const TEXT_ALIGNS = ['start', 'middle', 'end'] as const
export type TextAlign = (typeof TEXT_ALIGNS)[number]
export const CONNECTOR_HEADS = ['none', 'arrow'] as const
export type ConnectorHead = (typeof CONNECTOR_HEADS)[number]
export const CONNECTOR_ROUTES = ['straight', 'elbow'] as const
export type ConnectorRoute = (typeof CONNECTOR_ROUTES)[number]

/** A point on the board, board units. */
export interface BoardPoint {
  x: number
  y: number
}

/** An object's node points (MOP-27): the middle of each side of its box. */
export const WHITEBOARD_NODES = ['top', 'right', 'bottom', 'left'] as const
export type WhiteboardNode = (typeof WHITEBOARD_NODES)[number]

/** One end of a connector: stuck to an object, or free at a point. x and y are the last drawn point. */
export interface ConnectorEnd {
  objectId: string | null
  x: number
  y: number
  /**
   * The node point a stuck end is pinned to (MOP-27); without one the end
   * slides round the object's outline to face the other end. Left out when
   * there is none, so lines drawn before nodes existed read the same.
   */
  node?: WhiteboardNode
}

// --- Limits and default sizes -----------------------------------------------

/** D8: bounded for sync and memory. */
export const WHITEBOARD_LIMITS = {
  objects: 5000,
  textChars: 10_000,
  penPoints: 2000,
  upserts: 1000,
  deletes: 1000,
  coordinate: 1_000_000,
  linkChars: 2000,
  connectorPoints: 100
} as const
/** D25: the snapping grid. */
export const WHITEBOARD_GRID = 10
/** D29: the size a new object of each kind gets. */
export const WHITEBOARD_DEFAULT_SIZES = {
  note: { width: 200, height: 200 },
  text: { width: 240, height: 32 },
  shape: { width: 160, height: 120 },
  card: { width: 280, height: 72 },
  frame: { width: 640, height: 400 }
} as const
/** D29: a picture is fitted inside a square of this side. */
export const WHITEBOARD_PICTURE_BOX = 480

// --- Objects ----------------------------------------------------------------

interface WhiteboardObjectBase {
  id: string
  /** Top-left corner of the object's box, board units. */
  x: number
  y: number
  width: number
  height: number
  /** Stacking order: higher is in front. */
  z: number
  colour: WhiteboardColour
  /** A note's or shape's words, a frame's title, a connector's label; '' when none. */
  text: string
  /** D10: an item link or an http/https address. */
  link: string | null
  groupId: string | null
}

export interface NoteData {
  textSize: WhiteboardTextSize
}
export interface TextData {
  textSize: WhiteboardTextSize
  align: TextAlign
}
export interface ShapeData {
  shape: WhiteboardShape
  fill: ShapeFill
  stroke: WhiteboardStroke
  textSize: WhiteboardTextSize
}
export interface ConnectorData {
  from: ConnectorEnd
  to: ConnectorEnd
  /**
   * Bend points the line passes through between its ends, in order, board
   * units. Left out when there are none, so lines drawn before bend points
   * existed read the same.
   */
  via?: BoardPoint[]
  startHead: ConnectorHead
  endHead: ConnectorHead
  route: ConnectorRoute
  stroke: WhiteboardStroke
  dashed: boolean
}
export interface PenData {
  /** Flat `[x0, y0, x1, y1, …]`, integers relative to the object's x, y. */
  points: number[]
  stroke: WhiteboardStroke
  marker: boolean
}
/** Named so it does not shadow the DOM's `ImageData` in the renderer. */
export interface ImageObjectData {
  /** The Library image item shown (D11); null while the picture is missing. */
  imageItemId: string | null
}
/** A card shows the item its `link` points to. */
export type CardData = Record<string, never>
/** A frame's title is its `text`. */
export type FrameData = Record<string, never>
export interface MindmapData {
  /** Null for a map's central idea (D18). */
  parentId: string | null
  order: number
  textSize: WhiteboardTextSize
  /**
   * Dragged into place by hand: the automatic layout leaves this idea where
   * it is and lays out its own ideas from there. Left out when false.
   */
  free?: true
}

export type NoteObject = WhiteboardObjectBase & { kind: 'note'; data: NoteData }
export type TextObject = WhiteboardObjectBase & { kind: 'text'; data: TextData }
export type ShapeObject = WhiteboardObjectBase & { kind: 'shape'; data: ShapeData }
export type ConnectorObject = WhiteboardObjectBase & { kind: 'connector'; data: ConnectorData }
export type PenObject = WhiteboardObjectBase & { kind: 'pen'; data: PenData }
export type ImageObject = WhiteboardObjectBase & { kind: 'image'; data: ImageObjectData }
export type CardObject = WhiteboardObjectBase & { kind: 'card'; data: CardData }
export type FrameObject = WhiteboardObjectBase & { kind: 'frame'; data: FrameData }
export type MindmapObject = WhiteboardObjectBase & { kind: 'mindmap'; data: MindmapData }

export type WhiteboardObjectInput =
  | NoteObject
  | TextObject
  | ShapeObject
  | ConnectorObject
  | PenObject
  | ImageObject
  | CardObject
  | FrameObject
  | MindmapObject
/** An object as stored: what the service returns. */
export type WhiteboardObject = WhiteboardObjectInput & { createdAt: string; updatedAt: string }

/** One whiteboard as the editor opens it. */
export interface WhiteboardDocument {
  item: LibraryItem
  objects: WhiteboardObject[]
}
/** One save: the objects that changed or are new, and the ids that went. */
export interface WhiteboardSaveInput {
  upserts: WhiteboardObjectInput[]
  deletes: string[]
}
export interface WhiteboardSaveResult {
  item: LibraryItem
  savedAt: string
}
export interface CreateWhiteboardInput {
  title: string
  objects?: WhiteboardObjectInput[]
}

// --- Small rules ------------------------------------------------------------

const OBJECT_ID = /^[A-Za-z0-9_-]{1,64}$/

/** An object id: letters, digits, `_` and `-`, 1 to 64 of them. Library UUIDs pass. */
export function isWhiteboardObjectId(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID.test(value)
}

/** The colour a new object of a kind gets. */
export function defaultColour(kind: WhiteboardObjectKind): WhiteboardColour {
  switch (kind) {
    case 'note':
      return 'yellow'
    case 'frame':
      return 'grey'
    case 'mindmap':
      return 'blue'
    default:
      return 'black'
  }
}

function webUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/**
 * A link as an object stores it: an item link, rewritten with the current
 * scheme (so legacy-scheme links are normalised), or an http/https address.
 * Anything else throws.
 */
export function cleanWhiteboardLink(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Whiteboard link must be text')
  const link = value.trim()
  if (link.length > WHITEBOARD_LIMITS.linkChars) {
    throw new Error(`Whiteboard link is longer than ${WHITEBOARD_LIMITS.linkChars} characters`)
  }
  const ref = itemLinkTarget(link, BRAND.urlScheme)
  if (ref) return itemLinkUrl(ref, BRAND.urlScheme)
  if (webUrl(link)) return link
  throw new Error('Whiteboard link must be an item link or an http or https address')
}

/** True for an http: or https: link. */
export function isWebLink(link: string | null): boolean {
  return link !== null && webUrl(link) !== null
}

/**
 * True for the kinds that can carry a link (prompt 12): every kind but
 * connectors and pen strokes. A card's link is its whole content.
 */
export function isLinkable(object: { kind: WhiteboardObjectKind }): boolean {
  return object.kind !== 'connector' && object.kind !== 'pen'
}

/** The item an object's link points at, or null (no link, or a web link). */
export function objectLinkTarget(object: { link: string | null }): ItemLinkRef | null {
  return object.link === null ? null : itemLinkTarget(object.link, BRAND.urlScheme)
}

// --- The validator ----------------------------------------------------------

type Fields = Record<string, unknown>

function isPlainObject(value: unknown): value is Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

/** Reads the fields of one object, naming it in every error. */
class ObjectReader {
  constructor(private readonly label: string) {}

  fail(message: string): never {
    throw new Error(`${this.label}: ${message}`)
  }

  number(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.fail(`${field} must be a number`)
    }
    return value
  }

  coordinate(value: unknown, field: string): number {
    const number = this.number(value, field)
    if (Math.abs(number) > WHITEBOARD_LIMITS.coordinate) {
      this.fail(`${field} must lie within ±${WHITEBOARD_LIMITS.coordinate}`)
    }
    return number
  }

  extent(value: unknown, field: string): number {
    const number = this.number(value, field)
    if (number < 0 || number > 2 * WHITEBOARD_LIMITS.coordinate) {
      this.fail(`${field} must be between 0 and ${2 * WHITEBOARD_LIMITS.coordinate}`)
    }
    return number
  }

  oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T, field: string): T {
    if (value === undefined) return fallback
    if (!isOneOf(list, value)) this.fail(`${field} must be one of ${list.join(', ')}`)
    return value
  }

  boolean(value: unknown, fallback: boolean, field: string): boolean {
    if (value === undefined) return fallback
    if (typeof value !== 'boolean') this.fail(`${field} must be true or false`)
    return value
  }

  idOrNull(value: unknown, field: string): string | null {
    if (value === undefined || value === null) return null
    if (!isWhiteboardObjectId(value)) this.fail(`${field} must be an object id or null`)
    return value
  }

  connectorEnd(value: unknown, field: string): ConnectorEnd {
    if (!isPlainObject(value)) this.fail(`${field} must be an object`)
    const end: ConnectorEnd = {
      objectId: this.idOrNull(value.objectId, `${field}.objectId`),
      x: this.coordinate(value.x, `${field}.x`),
      y: this.coordinate(value.y, `${field}.y`)
    }
    if (value.node === undefined) return end
    if (!(WHITEBOARD_NODES as readonly unknown[]).includes(value.node)) {
      this.fail(`${field}.node must be one of ${WHITEBOARD_NODES.join(', ')}`)
    }
    // A free end has no node to be pinned to.
    return end.objectId === null ? end : { ...end, node: value.node as WhiteboardNode }
  }

  /** A connector's bend points: absent or an array of at most `connectorPoints` points. */
  via(value: unknown): BoardPoint[] {
    if (value === undefined) return []
    if (!Array.isArray(value)) this.fail('data.via must be an array of points')
    if (value.length > WHITEBOARD_LIMITS.connectorPoints) {
      this.fail(`data.via must hold at most ${WHITEBOARD_LIMITS.connectorPoints} points`)
    }
    return value.map((point: unknown, index) => {
      if (!isPlainObject(point)) this.fail(`data.via[${index}] must be a point`)
      return {
        x: this.coordinate(point.x, `data.via[${index}].x`),
        y: this.coordinate(point.y, `data.via[${index}].y`)
      }
    })
  }

  points(value: unknown): number[] {
    if (!Array.isArray(value)) this.fail('data.points must be an array of numbers')
    if (value.length % 2 !== 0) this.fail('data.points must hold an even count of numbers')
    if (value.length < 4) this.fail('data.points must hold at least two points')
    if (value.length > 2 * WHITEBOARD_LIMITS.penPoints) {
      this.fail(`data.points must hold at most ${WHITEBOARD_LIMITS.penPoints} points`)
    }
    return value.map((point, index) => Math.round(this.number(point, `data.points[${index}]`)))
  }
}

/**
 * Validates and normalises one object. Returns a new object holding only
 * known fields, with defaults filled in; throws an Error naming the field
 * otherwise.
 */
export function cleanWhiteboardObject(value: unknown): WhiteboardObjectInput {
  if (!isPlainObject(value)) throw new Error('Whiteboard object must be an object')
  if (!isWhiteboardObjectId(value.id)) throw new Error('Whiteboard object: id must be an object id')
  const id = value.id
  // Typed explicitly so `read.fail(...)` (returns never) narrows what follows it.
  const read: ObjectReader = new ObjectReader(`Whiteboard object ${id}`)
  if (!isOneOf(WHITEBOARD_OBJECT_KINDS, value.kind)) {
    read.fail(`kind must be one of ${WHITEBOARD_OBJECT_KINDS.join(', ')}`)
  }
  const kind = value.kind

  let colour: WhiteboardColour = defaultColour(kind)
  if (value.colour !== undefined) {
    colour = read.oneOf(WHITEBOARD_COLOURS, value.colour, colour, 'colour')
  }

  let text = ''
  if (value.text !== undefined) {
    if (typeof value.text !== 'string') read.fail('text must be text')
    text = value.text.replace(/\r\n?/g, '\n')
    if (text.length > WHITEBOARD_LIMITS.textChars) {
      read.fail(`text must be at most ${WHITEBOARD_LIMITS.textChars} characters`)
    }
  }

  let link: string | null = null
  if (value.link !== undefined && value.link !== null) {
    try {
      link = cleanWhiteboardLink(value.link)
    } catch (error) {
      read.fail(`link: ${(error as Error).message}`)
    }
  }

  const base: WhiteboardObjectBase = {
    id,
    x: read.coordinate(value.x, 'x'),
    y: read.coordinate(value.y, 'y'),
    width: read.extent(value.width, 'width'),
    height: read.extent(value.height, 'height'),
    z: read.number(value.z, 'z'),
    colour,
    text,
    link,
    groupId: read.idOrNull(value.groupId, 'groupId')
  }

  let data: Fields = {}
  if (value.data !== undefined) {
    if (!isPlainObject(value.data)) read.fail('data must be an object')
    data = value.data
  }
  const textSize = () => read.oneOf(WHITEBOARD_TEXT_SIZES, data.textSize, 'medium', 'data.textSize')
  const stroke = () => read.oneOf(WHITEBOARD_STROKES, data.stroke, 'medium', 'data.stroke')

  switch (kind) {
    case 'note':
      return { ...base, kind, data: { textSize: textSize() } }
    case 'text':
      return {
        ...base,
        kind,
        data: {
          textSize: textSize(),
          align: read.oneOf(TEXT_ALIGNS, data.align, 'start', 'data.align')
        }
      }
    case 'shape':
      return {
        ...base,
        kind,
        data: {
          shape: read.oneOf(WHITEBOARD_SHAPES, data.shape, 'rectangle', 'data.shape'),
          fill: read.oneOf(SHAPE_FILLS, data.fill, 'light', 'data.fill'),
          stroke: stroke(),
          textSize: textSize()
        }
      }
    case 'connector': {
      const via = read.via(data.via)
      return {
        ...base,
        kind,
        data: {
          from: read.connectorEnd(data.from, 'data.from'),
          to: read.connectorEnd(data.to, 'data.to'),
          startHead: read.oneOf(CONNECTOR_HEADS, data.startHead, 'none', 'data.startHead'),
          endHead: read.oneOf(CONNECTOR_HEADS, data.endHead, 'arrow', 'data.endHead'),
          route: read.oneOf(CONNECTOR_ROUTES, data.route, 'straight', 'data.route'),
          stroke: stroke(),
          dashed: read.boolean(data.dashed, false, 'data.dashed'),
          ...(via.length > 0 ? { via } : {})
        }
      }
    }
    case 'pen':
      return {
        ...base,
        kind,
        data: {
          points: read.points(data.points),
          stroke: stroke(),
          marker: read.boolean(data.marker, false, 'data.marker')
        }
      }
    case 'image':
      return {
        ...base,
        kind,
        data: { imageItemId: read.idOrNull(data.imageItemId, 'data.imageItemId') }
      }
    case 'card':
      if (link === null || objectLinkTarget({ link }) === null) {
        read.fail('a card needs an item link')
      }
      return { ...base, kind, data: {} }
    case 'frame':
      return { ...base, kind, data: {} }
    case 'mindmap': {
      const parentId = read.idOrNull(data.parentId, 'data.parentId')
      if (parentId === id) read.fail('data.parentId must not be the object itself')
      let order = 0
      if (data.order !== undefined) {
        if (typeof data.order !== 'number' || !Number.isInteger(data.order) || data.order < 0) {
          read.fail('data.order must be a whole number, 0 or more')
        }
        order = data.order
      }
      const free = read.boolean(data.free, false, 'data.free')
      return {
        ...base,
        kind,
        data: { parentId, order, textSize: textSize(), ...(free ? { free: true as const } : {}) }
      }
    }
  }
}

/**
 * Validates one save: at most `upserts` objects and `deletes` ids, no id
 * twice in either list and no id in both. Missing lists are empty.
 */
export function cleanWhiteboardSave(value: unknown): WhiteboardSaveInput {
  if (!isPlainObject(value)) throw new Error('Whiteboard save must be an object')
  const upsertsIn = value.upserts ?? []
  const deletesIn = value.deletes ?? []
  if (!Array.isArray(upsertsIn)) throw new Error('Whiteboard save: upserts must be an array')
  if (!Array.isArray(deletesIn)) throw new Error('Whiteboard save: deletes must be an array')
  if (upsertsIn.length > WHITEBOARD_LIMITS.upserts) {
    throw new Error(`Whiteboard save: at most ${WHITEBOARD_LIMITS.upserts} upserts`)
  }
  if (deletesIn.length > WHITEBOARD_LIMITS.deletes) {
    throw new Error(`Whiteboard save: at most ${WHITEBOARD_LIMITS.deletes} deletes`)
  }
  const upserts = upsertsIn.map(cleanWhiteboardObject)
  const upsertIds = new Set<string>()
  for (const object of upserts) {
    if (upsertIds.has(object.id)) throw new Error(`Whiteboard save: ${object.id} upserted twice`)
    upsertIds.add(object.id)
  }
  const deletes: string[] = []
  const deleteIds = new Set<string>()
  for (const id of deletesIn) {
    if (!isWhiteboardObjectId(id)) throw new Error('Whiteboard save: deletes must be object ids')
    if (deleteIds.has(id)) throw new Error(`Whiteboard save: ${id} deleted twice`)
    if (upsertIds.has(id)) throw new Error(`Whiteboard save: ${id} both upserted and deleted`)
    deleteIds.add(id)
    deletes.push(id)
  }
  return { upserts, deletes }
}

// --- Comparing and building -------------------------------------------------

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => sameValue(item, b[index]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    return keys.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key) && sameValue(a[key], b[key])
    )
  }
  return false
}

const COMMON_FIELDS = [
  'id',
  'kind',
  'x',
  'y',
  'width',
  'height',
  'z',
  'colour',
  'text',
  'link',
  'groupId'
] as const

/** True when two objects match in kind, common fields and data; createdAt and updatedAt are ignored. */
export function sameWhiteboardObject(a: WhiteboardObjectInput, b: WhiteboardObjectInput): boolean {
  return COMMON_FIELDS.every((field) => a[field] === b[field]) && sameValue(a.data, b.data)
}

/** A map from id to object. */
export function objectsById<T extends { id: string }>(objects: readonly T[]): Map<string, T> {
  return new Map(objects.map((object) => [object.id, object]))
}

/** A new object of a kind, its top-left at `at`, with the D29 size and default everything. */
export function defaultObject(
  kind: 'note' | 'text' | 'shape' | 'frame',
  at: { id: string; x: number; y: number; z: number }
): WhiteboardObjectInput {
  const base: WhiteboardObjectBase = {
    id: at.id,
    x: at.x,
    y: at.y,
    ...WHITEBOARD_DEFAULT_SIZES[kind],
    z: at.z,
    colour: defaultColour(kind),
    text: '',
    link: null,
    groupId: null
  }
  switch (kind) {
    case 'note':
      return { ...base, kind, data: { textSize: 'medium' } }
    case 'text':
      return { ...base, kind, data: { textSize: 'medium', align: 'start' } }
    case 'shape':
      return {
        ...base,
        kind,
        data: { shape: 'rectangle', fill: 'light', stroke: 'medium', textSize: 'medium' }
      }
    case 'frame':
      return { ...base, kind, data: {} }
  }
}
