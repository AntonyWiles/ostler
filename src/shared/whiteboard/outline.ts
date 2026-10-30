import type { ItemLinkRef } from '../item-links'
import {
  isWebLink,
  objectLinkTarget,
  type ConnectorObject,
  type MindmapObject,
  type WhiteboardObjectInput,
  type WhiteboardShape
} from './model'

/**
 * A whiteboard's outline (plan `docs/plans/whiteboards/`, prompt 02b,
 * decision D6): the Markdown text the service writes into a whiteboard's
 * Library `body` on every save. Search, the "Linked from" index, Ostler AI's
 * Library context and coding agents' attachments all read `body`, so the
 * outline is how they understand a board. Every link is written as a
 * Markdown link, `[words](url)`, so `extractItemLinks` finds it.
 *
 * The outline is text for models and agents, not interface text: its words
 * are English and stay here, outside the translated strings (docs/translating.md). It
 * also holds `readingOrder`, the order the outline and the editor's Tab key
 * walk a board in. Pure: no DOM, Electron, Node or interface words.
 */

/** The Library body cap (`MAX_BODY_CHARS` in electron/services/library-service.ts). */
export const WHITEBOARD_OUTLINE_MAX = 200_000
export const OUTLINE_CUT_LINE = '(The rest of this whiteboard is not in this outline.)'
export const OUTLINE_EMPTY = 'This whiteboard is empty.'

export interface OutlineOptions {
  /** Library picture titles by item id, so a picture is named. */
  imageTitles?: ReadonlyMap<string, string>
}

// --- Reading order ----------------------------------------------------------

/** How far two objects' vertical extents overlap; 0 or less when they do not. */
function verticalOverlap(a: WhiteboardObjectInput, b: WhiteboardObjectInput): number {
  return Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Rows, top to bottom, then left to right. Objects are sorted by `y`; an
 * object joins the current row when its vertical overlap with the row's first
 * object is more than half the shorter of the two heights, and otherwise
 * starts a new row. Within a row, by `x`, ties by `id`. Returns a copy.
 */
export function readingOrder<T extends WhiteboardObjectInput>(objects: readonly T[]): T[] {
  const sorted = [...objects].sort((a, b) => a.y - b.y || a.x - b.x || byId(a, b))
  const rows: T[][] = []
  for (const object of sorted) {
    const row = rows[rows.length - 1]
    const first = row?.[0]
    if (
      row &&
      first &&
      verticalOverlap(first, object) > Math.min(first.height, object.height) / 2
    ) {
      row.push(object)
    } else {
      rows.push([object])
    }
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x || byId(a, b)))
}

// --- Words ------------------------------------------------------------------

const SHAPE_WORDS: Record<WhiteboardShape, string> = {
  rectangle: 'Rectangle',
  rounded: 'Rounded rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  triangle: 'Triangle'
}

/** The word for an object with no text, as the bullets and the connections name it. */
function kindWord(object: WhiteboardObjectInput): string {
  switch (object.kind) {
    case 'note':
      return 'Note'
    case 'text':
      return 'Text'
    case 'shape':
      return SHAPE_WORDS[object.data.shape]
    case 'image':
      return 'Picture'
    case 'card':
      return 'Card'
    case 'frame':
      return 'Frame'
    case 'mindmap':
      return 'Idea'
    case 'connector':
      return 'Connector'
    case 'pen':
      return 'Drawing'
  }
}

/** User text on one line: each run of newlines becomes ` / `, runs of spaces collapse. */
function oneLine(text: string): string {
  return text
    .replace(/[ \t]*\n[\s]*/g, ' / ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

const NAME_MAX = 80

/** How a connection names an object: its text's first line, at most 80 characters, or its kind's word. */
function objectName(object: WhiteboardObjectInput): string {
  const firstLine = (object.text.split('\n').find((line) => line.trim() !== '') ?? '')
    .replace(/[ \t]+/g, ' ')
    .trim()
  if (firstLine === '') return kindWord(object)
  const chars = Array.from(firstLine)
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join('')}…` : firstLine
}

/** A URL safe inside `](…)`: spaces and parentheses are percent-encoded. */
function linkTarget(url: string): string {
  return url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')
}

/** ` ([linked item](url))` or ` ([web link](url))` for an object's link; '' when it has none. */
function linkSuffix(object: WhiteboardObjectInput): string {
  if (object.link === null) return ''
  if (objectLinkTarget(object)) return ` ([linked item](${linkTarget(object.link)}))`
  if (isWebLink(object.link)) return ` ([web link](${linkTarget(object.link)}))`
  return ''
}

/** One object's bullet, or null when it has none (an empty text object). */
function bullet(object: WhiteboardObjectInput, options: OutlineOptions): string | null {
  const text = oneLine(object.text)
  const link = linkSuffix(object)
  switch (object.kind) {
    case 'note':
      return (text === '' ? '- Note (empty)' : `- Note: ${text}`) + link
    case 'text':
      if (text === '') return link === '' ? null : `- Text${link}`
      return `- Text: ${text}${link}`
    case 'shape': {
      const word = SHAPE_WORDS[object.data.shape]
      return (text === '' ? `- ${word}` : `- ${word}: ${text}`) + link
    }
    case 'image': {
      const id = object.data.imageItemId
      const title = id === null ? undefined : options.imageTitles?.get(id)
      const name = title === undefined ? '' : oneLine(title)
      return (name === '' ? '- Picture' : `- Picture: ${name}`) + link
    }
    case 'card':
      return object.link !== null && objectLinkTarget(object)
        ? `- Card: [linked item](${linkTarget(object.link)})`
        : `- Card${link}`
    case 'mindmap':
      return `- ${text === '' ? '(empty idea)' : text}${link}`
    case 'frame':
    case 'connector':
    case 'pen':
      return null
  }
}

// --- Sections ---------------------------------------------------------------

type Box = Pick<WhiteboardObjectInput, 'x' | 'y' | 'width' | 'height'>

function containsCentre(frame: Box, object: Box): boolean {
  const cx = object.x + object.width / 2
  const cy = object.y + object.height / 2
  return (
    cx >= frame.x && cx <= frame.x + frame.width && cy >= frame.y && cy <= frame.y + frame.height
  )
}

/** Each mind map as its central idea and every node under it, depth first, children by `order` then `id`. */
function mindMapSections(nodes: readonly MindmapObject[], options: OutlineOptions): string[][] {
  const ids = new Set(nodes.map((node) => node.id))
  const children = new Map<string, MindmapObject[]>()
  for (const node of nodes) {
    const parent = node.data.parentId
    if (parent === null || !ids.has(parent)) continue
    const list = children.get(parent) ?? []
    list.push(node)
    children.set(parent, list)
  }
  for (const list of children.values())
    list.sort((a, b) => a.data.order - b.data.order || byId(a, b))

  // A central idea has no parent, or a parent that is not on the board. Nodes
  // left unreached (a loop of parents) start a map of their own, so no text is lost.
  const ordered = readingOrder(nodes)
  const roots = ordered.filter(
    (node) => node.data.parentId === null || !ids.has(node.data.parentId)
  )
  const reached = new Set<string>()
  const sections: string[][] = []
  const walk = (root: MindmapObject) => {
    const text = oneLine(root.text)
    const lines = [(text === '' ? '## Mind map' : `## Mind map: ${text}`) + linkSuffix(root)]
    reached.add(root.id)
    const visit = (node: MindmapObject, depth: number) => {
      for (const child of children.get(node.id) ?? []) {
        if (reached.has(child.id)) continue
        reached.add(child.id)
        lines.push('  '.repeat(depth) + (bullet(child, options) ?? ''))
        visit(child, depth + 1)
      }
    }
    visit(root, 0)
    sections.push(lines)
  }
  for (const root of roots) walk(root)
  for (const node of ordered) if (!reached.has(node.id)) walk(node)
  return sections
}

/** A connector's line in "Connections", or null when both ends are free and it has no label. */
function connection(
  connector: ConnectorObject,
  byObjectId: ReadonlyMap<string, WhiteboardObjectInput>
): string | null {
  const end = (objectId: string | null) => {
    const object = objectId === null ? undefined : byObjectId.get(objectId)
    return object && object.id !== connector.id ? object : undefined
  }
  const from = end(connector.data.from.objectId)
  const to = end(connector.data.to.objectId)
  const label = oneLine(connector.text)
  if (!from && !to && label === '') return null
  const start = connector.data.startHead === 'arrow'
  const finish = connector.data.endHead === 'arrow'
  const arrow = start && finish ? '↔' : finish ? '→' : start ? '←' : '—'
  const name = (object: WhiteboardObjectInput | undefined) =>
    object ? objectName(object) : '(open end)'
  return (
    `- ${name(from)} ${arrow} ${name(to)}` +
    (label === '' ? '' : `: ${label}`) +
    linkSuffix(connector)
  )
}

function cut(outline: string): string {
  if (outline.length <= WHITEBOARD_OUTLINE_MAX) return outline
  const tail = `\n\n${OUTLINE_CUT_LINE}`
  const room = WHITEBOARD_OUTLINE_MAX - tail.length
  const breakAt = outline.lastIndexOf('\n', room)
  const head = breakAt > 0 ? outline.slice(0, breakAt) : outline.slice(0, room)
  return head.replace(/\n+$/, '') + tail
}

/**
 * The board as an English Markdown outline: frames, then mind maps, then the
 * objects in no frame, then the connections and a count of freehand strokes.
 * At most `WHITEBOARD_OUTLINE_MAX` characters; no trailing newline.
 */
export function whiteboardOutline(
  objects: readonly WhiteboardObjectInput[],
  options: OutlineOptions = {}
): string {
  if (objects.length === 0) return OUTLINE_EMPTY

  const frames = readingOrder(objects.filter((object) => object.kind === 'frame'))
  const nodes = objects.filter((object): object is MindmapObject => object.kind === 'mindmap')
  const connectors = objects.filter(
    (object): object is ConnectorObject => object.kind === 'connector'
  )
  const strokes = objects.filter((object) => object.kind === 'pen').length
  const placed = objects.filter(
    (object) =>
      object.kind !== 'frame' &&
      object.kind !== 'mindmap' &&
      object.kind !== 'connector' &&
      object.kind !== 'pen'
  )

  // Each object goes in the smallest frame holding its centre; ties go to the
  // frame earlier in reading order.
  const inFrame = new Map<string, WhiteboardObjectInput[]>(frames.map((frame) => [frame.id, []]))
  const loose: WhiteboardObjectInput[] = []
  for (const object of placed) {
    let best: WhiteboardObjectInput | undefined
    for (const frame of frames) {
      if (!containsCentre(frame, object)) continue
      if (!best || frame.width * frame.height < best.width * best.height) best = frame
    }
    if (best) inFrame.get(best.id)?.push(object)
    else loose.push(object)
  }

  const bullets = (list: readonly WhiteboardObjectInput[]) =>
    readingOrder(list).flatMap((object) => bullet(object, options) ?? [])

  const sections: string[][] = []
  for (const frame of frames) {
    const title = oneLine(frame.text)
    sections.push([
      (title === '' ? '## Frame' : `## ${title}`) + linkSuffix(frame),
      ...bullets(inFrame.get(frame.id) ?? [])
    ])
  }
  const maps = mindMapSections(nodes, options)
  sections.push(...maps)
  const looseLines = bullets(loose)
  if (looseLines.length > 0) {
    sections.push(
      frames.length > 0 || maps.length > 0
        ? ['## Elsewhere on the board', ...looseLines]
        : looseLines
    )
  }
  const byObjectId = new Map(objects.map((object) => [object.id, object]))
  const connectionLines = readingOrder(connectors).flatMap(
    (connector) => connection(connector, byObjectId) ?? []
  )
  if (connectionLines.length > 0) sections.push(['## Connections', ...connectionLines])
  if (strokes > 0) {
    sections.push([
      `Drawings: ${strokes} ${strokes === 1 ? 'freehand stroke' : 'freehand strokes'}.`
    ])
  }

  if (sections.length === 0) return OUTLINE_EMPTY
  return cut(sections.map((lines) => lines.join('\n')).join('\n\n'))
}

/** Every distinct item the board's objects link to, once each, in reading order. */
export function whiteboardItemLinks(objects: readonly WhiteboardObjectInput[]): ItemLinkRef[] {
  const found = new Map<string, ItemLinkRef>()
  for (const object of readingOrder(objects)) {
    const ref = objectLinkTarget(object)
    const key = ref && `${ref.kind}:${ref.id}`
    if (ref && key && !found.has(key)) found.set(key, ref)
  }
  return [...found.values()]
}
