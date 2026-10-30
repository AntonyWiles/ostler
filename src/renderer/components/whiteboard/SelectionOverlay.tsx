import {
  RESIZE_HANDLES,
  type Point,
  type Rect,
  type ResizeHandle
} from '@shared/whiteboard/geometry'

/** A resize handle's side, in screen pixels. */
export const HANDLE_SIZE = 8
/**
 * An object smaller than this on screen, both ways, shows no resize handles:
 * they would cover it, and a drag on it must move it. Zooming in, or Alt and
 * the arrow keys, still resize it.
 */
export const HANDLES_MIN_SPAN = 3 * HANDLE_SIZE

/** True when `rect` (board units) is big enough at `zoom` for its handles to leave it grabbable. */
export function hasRoomForHandles(rect: Rect, zoom: number): boolean {
  return rect.width * zoom >= HANDLES_MIN_SPAN || rect.height * zoom >= HANDLES_MIN_SPAN
}

/** The gap between an object and its dashed selection box, in screen pixels. */
const SELECTION_GAP = 3

export interface SelectionOverlayProps {
  /** The boxes of the selected objects, in board units. */
  selected: readonly Rect[]
  /** The selection box being dragged on empty board, if any. */
  box: Rect | null
  /** The one object to show resize handles for, or null for none. */
  handlesFor: Rect | null
  /** A single selected connector's drawn start and end: a handle on each (prompt 10). */
  ends?: readonly [Point, Point] | null
  /** The object a connector end being dragged would stick to, outlined. */
  attachTo?: Rect | null
  /** A single selected connector's bend points: drag one to move it, double-click to remove it. */
  bends?: readonly Point[]
  /** Halfway along each stretch of that connector: drag one to add a bend point there. */
  splits?: readonly Point[]
  /** Each whole group in the selection: its bounds and how many objects it holds. */
  groups?: readonly { rect: Rect; count: number }[]
  /** The words on a group's tag. */
  groupTag?: (count: number) => string
  /** Node points to show (MOP-27); `hot` is the one a line being drawn would pin to. */
  nodes?: readonly { x: number; y: number; hot: boolean }[]
  zoom: number
}

/** A node point's radius, and the one a line would pin to, in screen pixels. */
const NODE_RADIUS = 4
const HOT_NODE_RADIUS = 7

/** A group tag's height and its words' size, in screen pixels. */
const TAG_HEIGHT = 18
const TAG_TEXT = 11
const TAG_PADDING = 6
/** A rough width per character of the tag's words, in screen pixels, for its box. */
const TAG_CHAR = 6.2

/** Where a handle sits on a box's edge or corner. */
function handleCentre(rect: Rect, handle: ResizeHandle): { x: number; y: number } {
  const x = handle.includes('w')
    ? rect.x
    : handle.includes('e')
      ? rect.x + rect.width
      : rect.x + rect.width / 2
  const y = handle.includes('n')
    ? rect.y
    : handle.includes('s')
      ? rect.y + rect.height
      : rect.y + rect.height / 2
  return { x, y }
}

/**
 * The whiteboard editor's selection (plan `docs/plans/whiteboards/`, prompt 05),
 * drawn in the scene's overlay slot in board units: a dashed box around each
 * selected object, the selection box while one is dragged, and eight resize
 * handles around a single resizable object, or a handle on each end of a
 * single connector (prompt 10), with the object a dragged end would stick to
 * outlined, and on a single connector its bend points and the handles that
 * add one. Each whole group in the selection is outlined, dashed, with a tag
 * that names it. Every size is divided by the zoom,
 * so lines stay one screen pixel wide at any zoom. Handles are for the mouse
 * only (keyboard resizing is Alt and the arrow keys), so all of it is hidden
 * from assistive technology.
 */
export function SelectionOverlay({
  selected,
  box,
  handlesFor,
  ends = null,
  attachTo = null,
  bends = [],
  splits = [],
  groups = [],
  groupTag,
  nodes = [],
  zoom
}: SelectionOverlayProps) {
  const line = 1 / zoom
  const gap = SELECTION_GAP / zoom
  const dash = `${4 / zoom} ${3 / zoom}`
  const handle = HANDLE_SIZE / zoom
  const groupGap = 3 * gap
  return (
    <g className="wb-selection-layer" aria-hidden="true">
      {groups.map(({ rect, count }, index) => {
        const words = groupTag?.(count) ?? ''
        const tagWidth = (words.length * TAG_CHAR + 2 * TAG_PADDING) / zoom
        const tagHeight = TAG_HEIGHT / zoom
        const left = rect.x - groupGap
        const top = rect.y - groupGap
        return (
          <g key={`group-${index}`} data-group-outline="">
            <rect
              className="wb-group-outline"
              x={left}
              y={top}
              width={rect.width + 2 * groupGap}
              height={rect.height + 2 * groupGap}
              strokeWidth={line * 1.5}
              strokeDasharray={`${8 / zoom} ${4 / zoom}`}
            />
            {words && (
              <>
                <rect
                  className="wb-group-tag"
                  x={left}
                  y={top - tagHeight}
                  width={tagWidth}
                  height={tagHeight}
                  rx={3 / zoom}
                />
                <text
                  className="wb-group-tag-text"
                  x={left + TAG_PADDING / zoom}
                  y={top - tagHeight / 2 + (TAG_TEXT * 0.35) / zoom}
                  fontSize={TAG_TEXT / zoom}
                >
                  {words}
                </text>
              </>
            )}
          </g>
        )
      })}
      {selected.map((rect, index) => (
        <rect
          key={index}
          className="wb-selection"
          x={rect.x - gap}
          y={rect.y - gap}
          width={rect.width + 2 * gap}
          height={rect.height + 2 * gap}
          strokeWidth={line}
          strokeDasharray={dash}
        />
      ))}
      {box && (
        <rect
          className="wb-selection-box"
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          strokeWidth={line}
          data-selection-box=""
        />
      )}
      {handlesFor &&
        RESIZE_HANDLES.map((id) => {
          const centre = handleCentre(handlesFor, id)
          return (
            <rect
              key={id}
              className={`wb-handle wb-handle--${id}`}
              x={centre.x - handle / 2}
              y={centre.y - handle / 2}
              width={handle}
              height={handle}
              strokeWidth={line}
              data-handle={id}
            />
          )
        })}
      {ends?.map((end, index) => (
        <circle
          key={index}
          className="wb-handle wb-end-handle"
          cx={end.x}
          cy={end.y}
          r={handle / 2 + line}
          strokeWidth={line}
          data-end={index === 0 ? 'from' : 'to'}
        />
      ))}
      {splits.map((point, index) => (
        <circle
          key={`split-${index}`}
          className="wb-split-handle"
          cx={point.x}
          cy={point.y}
          r={handle / 2}
          strokeWidth={line}
          data-split={index}
        />
      ))}
      {bends.map((point, index) => (
        <rect
          key={`bend-${index}`}
          className="wb-bend-handle"
          x={point.x - handle / 2}
          y={point.y - handle / 2}
          width={handle}
          height={handle}
          transform={`rotate(45 ${point.x} ${point.y})`}
          strokeWidth={line}
          data-via={index}
        />
      ))}
      {nodes.map((node) => (
        <circle
          key={`${node.x},${node.y}`}
          className={node.hot ? 'wb-node wb-node--hot' : 'wb-node'}
          cx={node.x}
          cy={node.y}
          r={(node.hot ? HOT_NODE_RADIUS : NODE_RADIUS) / zoom}
          strokeWidth={line}
          data-node={node.hot ? 'hot' : ''}
        />
      ))}
      {attachTo && (
        <rect
          className="wb-attach-target"
          x={attachTo.x - gap}
          y={attachTo.y - gap}
          width={attachTo.width + 2 * gap}
          height={attachTo.height + 2 * gap}
          strokeWidth={2 * line}
          data-attach-target=""
        />
      )}
    </g>
  )
}
