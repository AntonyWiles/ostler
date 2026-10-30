import { t } from '@shared/i18n'
import {
  WHITEBOARD_SHORTCUTS,
  whiteboardShortcutLabelKey,
  type WhiteboardShortcutId
} from '@shared/shortcuts'
import { refreshConnectors } from '@shared/whiteboard/connectors'
import type { Point } from '@shared/whiteboard/geometry'
import {
  defaultColour,
  defaultObject,
  type ConnectorEnd,
  type ConnectorHead,
  type ConnectorObject,
  type ConnectorRoute,
  type PenObject,
  type ShapeObject,
  type WhiteboardColour,
  type WhiteboardObjectInput,
  type WhiteboardShape,
  type WhiteboardStroke
} from '@shared/whiteboard/model'
import {
  Eraser,
  Frame,
  Hand,
  Highlighter,
  MousePointer2,
  MoveUpRight,
  Network,
  Pen,
  RectangleHorizontal,
  StickyNote,
  Type,
  Waypoints,
  type LucideIcon
} from '../../ui/icons'

/*
 * The whiteboard editor's tools (plan `docs/plans/whiteboards/`): the tool
 * bar, which tools do what, and the settings each draws with. Pure: no React.
 */

export type WhiteboardToolId =
  | 'select'
  | 'hand'
  | 'note'
  | 'text'
  | 'shape'
  | 'frame'
  | 'pen'
  | 'marker'
  | 'eraser'
  | 'connector'
  | 'node'
  | 'mindmap'

export interface ToolDefinition {
  id: WhiteboardToolId & WhiteboardShortcutId
  icon: LucideIcon
  /** A tool that changes the board; left out when the editor is read-only. */
  edits: boolean
  /**
   * The tool bar's groups, divided by a line: moving round the board; words
   * (notes, text, mind maps); boxes and lines; ink.
   */
  group: number
}

/** The tool bar, in order and in its groups. */
export const TOOLS: readonly ToolDefinition[] = [
  { id: 'select', icon: MousePointer2, edits: false, group: 0 },
  { id: 'hand', icon: Hand, edits: false, group: 0 },
  { id: 'note', icon: StickyNote, edits: true, group: 1 },
  { id: 'text', icon: Type, edits: true, group: 1 },
  { id: 'mindmap', icon: Network, edits: true, group: 1 },
  { id: 'shape', icon: RectangleHorizontal, edits: true, group: 2 },
  { id: 'frame', icon: Frame, edits: true, group: 2 },
  { id: 'connector', icon: MoveUpRight, edits: true, group: 2 },
  { id: 'node', icon: Waypoints, edits: true, group: 2 },
  { id: 'pen', icon: Pen, edits: true, group: 3 },
  { id: 'marker', icon: Highlighter, edits: true, group: 3 },
  { id: 'eraser', icon: Eraser, edits: true, group: 3 }
]

/** The tools that place one object of their own kind, each in the colour it last used. */
export type ColourTool = 'note' | 'text' | 'mindmap' | 'shape' | 'frame'
const COLOUR_TOOLS: readonly ColourTool[] = ['note', 'text', 'mindmap', 'shape', 'frame']
export const isColourTool = (tool: WhiteboardToolId): tool is ColourTool =>
  (COLOUR_TOOLS as readonly string[]).includes(tool)
export const DEFAULT_TOOL_COLOURS: Record<ColourTool, WhiteboardColour> = {
  note: defaultColour('note'),
  text: defaultColour('text'),
  mindmap: defaultColour('mindmap'),
  shape: defaultColour('shape'),
  frame: defaultColour('frame')
}

/** The tools that place an object with a click or Enter, and the kind each places. */
export type PlacingTool = 'note' | 'text'
export const isPlacingTool = (tool: WhiteboardToolId): tool is PlacingTool =>
  tool === 'note' || tool === 'text'

/** The tools that place with a click or Enter, or draw the object's box with a drag (prompt 09). */
export type BoxTool = 'shape' | 'frame'
export const isBoxTool = (tool: WhiteboardToolId): tool is BoxTool =>
  tool === 'shape' || tool === 'frame'

/**
 * The tools whose press on an object's border moves the object instead
 * (MOP-34). Not the connector, which joins what it is pressed on, nor the
 * eraser, which rubs it out.
 */
export const movesByBorder = (tool: WhiteboardToolId): boolean =>
  isPlacingTool(tool) || isBoxTool(tool) || isInkTool(tool) || tool === 'mindmap'

/**
 * The tools that draw lines and arrows: the connector, and the node tool
 * (MOP-27), which shows every object's node points and pins a line's ends to
 * them.
 */
export type LineTool = 'connector' | 'node'
export const isLineTool = (tool: WhiteboardToolId): tool is LineTool =>
  tool === 'connector' || tool === 'node'

/** The tools that draw freehand strokes. */
export type InkTool = 'pen' | 'marker'
export const isInkTool = (tool: WhiteboardToolId): tool is InkTool =>
  tool === 'pen' || tool === 'marker'

/** The colour and stroke the next pen or marker stroke draws with. */
export interface Ink {
  colour: WhiteboardColour
  stroke: WhiteboardStroke
}
export const DEFAULT_INKS: Record<InkTool, Ink> = {
  pen: { colour: 'black', stroke: 'medium' },
  marker: { colour: 'yellow', stroke: 'thick' }
}

/** What the Connector tool draws next (prompt 10); kept for the session. */
export interface ConnectorStyle {
  colour: WhiteboardColour
  route: ConnectorRoute
  startHead: ConnectorHead
  endHead: ConnectorHead
  stroke: WhiteboardStroke
  dashed: boolean
}
export const DEFAULT_CONNECTOR_STYLE: ConnectorStyle = {
  colour: 'black',
  route: 'straight',
  startHead: 'none',
  endHead: 'arrow',
  stroke: 'medium',
  dashed: false
}
/** The style bar's controls for the Connector tool. */
export const CONNECTOR_TOOL_CONTROLS = ['colour', 'route', 'heads', 'dashed', 'stroke'] as const

/**
 * A connector in `style` from one end to the other, its box and drawn ends
 * worked out from the board (`refreshConnectors`). Never mutates `board`.
 */
export function makeConnector(
  board: readonly WhiteboardObjectInput[],
  fields: { id: string; z: number; from: ConnectorEnd; to: ConnectorEnd; text?: string },
  style: ConnectorStyle
): ConnectorObject {
  const { colour, ...data } = style
  const connector: ConnectorObject = {
    id: fields.id,
    kind: 'connector',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    z: fields.z,
    colour,
    text: fields.text ?? '',
    link: null,
    groupId: null,
    data: { ...data, from: { ...fields.from }, to: { ...fields.to } }
  }
  const [fresh] = refreshConnectors([...board, connector], new Set([connector.id]))
  return fresh ?? connector
}

/** The Connector tool's settings, as a connector the style bar can read. */
export function toolConnector(style: ConnectorStyle): ConnectorObject {
  const end = { objectId: null, x: 0, y: 0 }
  return makeConnector([], { id: 'connector-tool', z: 0, from: end, to: end }, style)
}

/** The style a connector (or the tool's stand-in) carries. */
export function connectorStyleOf(connector: ConnectorObject): ConnectorStyle {
  const { route, startHead, endHead, stroke, dashed } = connector.data
  return { colour: connector.colour, route, startHead, endHead, stroke, dashed }
}

export const keysOf = (id: WhiteboardShortcutId) =>
  WHITEBOARD_SHORTCUTS.find((entry) => entry.id === id)?.keys ?? ''
export const label = (id: WhiteboardShortcutId) => t(whiteboardShortcutLabelKey(id))

/** The tool a bare key picks, from the shortcut table. */
export function toolForKey(key: string, tools: readonly ToolDefinition[]): WhiteboardToolId | null {
  const lower = key.toLowerCase()
  return tools.find((tool) => keysOf(tool.id).toLowerCase() === lower)?.id ?? null
}

/** A pen object for a stroke under way (or the pen tool's settings): never on the board. */
export function inkPreview(points: readonly Point[], ink: Ink, marker: boolean): PenObject {
  return {
    id: 'drawing',
    kind: 'pen',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    z: 0,
    colour: ink.colour,
    text: '',
    link: null,
    groupId: null,
    data: { points: points.flatMap((point) => [point.x, point.y]), stroke: ink.stroke, marker }
  }
}

/** The Shape tool's settings, as a shape the style bar can read. */
export function toolShape(shape: WhiteboardShape): ShapeObject {
  const object = defaultObject('shape', { id: 'shape-tool', x: 0, y: 0, z: 0 }) as ShapeObject
  return { ...object, data: { ...object.data, shape } }
}
