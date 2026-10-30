import { t } from '@shared/i18n'
import { refreshConnectors, withBendPoints } from '@shared/whiteboard/connectors'
import { remapWhiteboardIds } from '@shared/whiteboard/file-format'
import {
  bringForward,
  bringToFront,
  moveObjects,
  nextZ,
  objectRect,
  rectCentre,
  rectContains,
  sendBackward,
  sendToBack,
  type AlignEdge,
  type DistributeAxis,
  type Rect
} from '@shared/whiteboard/geometry'
import type { ObjectMap } from '@shared/whiteboard/history'
import { isMindmap, mindMapRoot, moveMindMapBranch } from '@shared/whiteboard/mind-map'
import type { MindmapObject, WhiteboardObjectInput } from '@shared/whiteboard/model'

/*
 * What the whiteboard editor does to a selection (plan `docs/plans/whiteboards/`):
 * moving, copying and restacking objects, with the connectors and frame
 * contents that go with them. Pure: no React.
 */

/** True for a connector with an end stuck to an object on the board: it follows, never moves itself. */
function isStuckConnector(
  object: WhiteboardObjectInput,
  byId: ReadonlyMap<string, WhiteboardObjectInput>
): boolean {
  if (object.kind !== 'connector') return false
  const { from, to } = object.data
  return (
    (from.objectId !== null && byId.has(from.objectId)) ||
    (to.objectId !== null && byId.has(to.objectId))
  )
}

/** Objects a connector can stick to: not connectors or pen strokes (prompt 03a). */
export const isConnectable = (object: WhiteboardObjectInput) =>
  object.kind !== 'connector' && object.kind !== 'pen'

/** Duplicates and pasted copies land this far right and down of what they copy. */
export const COPY_OFFSET = 20

export type RestackAction = 'bring-to-front' | 'bring-forward' | 'send-backward' | 'send-to-back'
export const RESTACK: Record<RestackAction, { reorder: typeof bringForward; announce: string }> = {
  'bring-to-front': { reorder: bringToFront, announce: 'library:whiteboard.announce.toFront' },
  'bring-forward': { reorder: bringForward, announce: 'library:whiteboard.announce.forward' },
  'send-backward': { reorder: sendBackward, announce: 'library:whiteboard.announce.backward' },
  'send-to-back': { reorder: sendToBack, announce: 'library:whiteboard.announce.toBack' }
}
export const ALIGN_ITEMS: readonly { edge: AlignEdge; label: string }[] = [
  { edge: 'left', label: 'library:whiteboard.arrange.alignLeft' },
  { edge: 'hcentre', label: 'library:whiteboard.arrange.alignCentre' },
  { edge: 'right', label: 'library:whiteboard.arrange.alignRight' },
  { edge: 'top', label: 'library:whiteboard.arrange.alignTop' },
  { edge: 'vcentre', label: 'library:whiteboard.arrange.alignMiddle' },
  { edge: 'bottom', label: 'library:whiteboard.arrange.alignBottom' }
]
export const DISTRIBUTE_ITEMS: readonly { axis: DistributeAxis; label: string }[] = [
  { axis: 'horizontal', label: 'library:whiteboard.arrange.distributeHorizontally' },
  { axis: 'vertical', label: 'library:whiteboard.arrange.distributeVertically' }
]

/** A new object id (letters, digits and `-`: a valid whiteboard id). */
export const newId = () => crypto.randomUUID()

/** The translated word for an object copied with no text of its own. */
export const kindWord = (object: WhiteboardObjectInput) =>
  t(`library:whiteboard.kinds.${object.kind}`)

export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}

const area = (rect: Rect) => rect.width * rect.height
const centreBox = (object: WhiteboardObjectInput): Rect => ({
  ...rectCentre(objectRect(object)),
  width: 0,
  height: 0
})

/**
 * `ids` plus what every moving frame holds (prompt 09): each object whose
 * centre lies inside a moving frame and not inside a smaller frame that stays
 * put. A frame inside a moving frame moves too, and so does what it holds. A
 * mind map moves only when its central idea is inside.
 */
export function withFrameContents(
  objects: readonly WhiteboardObjectInput[],
  ids: ReadonlySet<string>
): Set<string> {
  const moving = new Set(ids)
  const frames = objects.filter((object) => object.kind === 'frame')
  let grew = frames.some((frame) => moving.has(frame.id))
  while (grew) {
    grew = false
    for (const frame of frames) {
      if (!moving.has(frame.id)) continue
      const rect = objectRect(frame)
      for (const object of objects) {
        if (moving.has(object.id)) continue
        const centre = centreBox(object)
        if (!rectContains(rect, centre)) continue
        if (isMindmap(object) && mindMapRoot(objects, object.id)?.id !== object.id) continue
        const held = frames.some(
          (other) =>
            other.id !== object.id &&
            other.id !== frame.id &&
            !moving.has(other.id) &&
            area(objectRect(other)) < area(rect) &&
            rectContains(objectRect(other), centre)
        )
        if (held) continue
        moving.add(object.id)
        grew = true
      }
    }
  }
  return moving
}

/**
 * Copies of the selection moved by dx, dy. A mind map's central idea moves its
 * whole map; any other idea moves with its own branch and stays where it is
 * put (`moveMindMapBranch`), so the layout no longer moves it. A frame takes
 * what it holds with it (`withFrameContents`). A selected connector with a
 * stuck end does not move: it follows its objects, and its bend points move
 * too when every object it is stuck to moves.
 */
export function moveSelection(
  objects: readonly WhiteboardObjectInput[],
  selection: ReadonlySet<string>,
  dx: number,
  dy: number
): WhiteboardObjectInput[] {
  const byId = new Map(objects.map((object) => [object.id, object]))
  // A connector with a stuck end follows its objects; it never moves on its own (prompt 10).
  const own = new Set(
    [...selection].filter((id) => {
      const object = byId.get(id)
      return object !== undefined && !isStuckConnector(object, byId)
    })
  )
  const ids = withFrameContents(objects, own)
  /** True when an idea higher up the same map moves too: its branch carries this one. */
  const carried = (node: MindmapObject) => {
    const visited = new Set<string>([node.id])
    let parentId = node.data.parentId
    while (parentId !== null && !visited.has(parentId)) {
      if (ids.has(parentId)) return true
      visited.add(parentId)
      const parent = byId.get(parentId)
      parentId = parent && isMindmap(parent) ? parent.data.parentId : null
    }
    return false
  }
  const plain = new Set<string>()
  const branches: string[] = []
  for (const object of objects) {
    if (!ids.has(object.id)) continue
    if (!isMindmap(object)) plain.add(object.id)
    else if (!carried(object)) branches.push(object.id)
  }
  const moved = moveObjects(objects, plain, dx, dy)
  const seen = new Set(moved.map((object) => object.id))
  for (const branch of branches) {
    for (const node of moveMindMapBranch(objects, branch, dx, dy)) {
      if (!seen.has(node.id)) {
        seen.add(node.id)
        moved.push(node)
      }
    }
  }
  // A stuck line's bend points travel with it when both its objects move.
  for (const object of objects) {
    if (object.kind !== 'connector' || seen.has(object.id) || !object.data.via) continue
    const { from, to } = object.data
    const ends = [from.objectId, to.objectId]
    if (ends.every((id) => id !== null && seen.has(id))) {
      moved.push(
        withBendPoints(
          object,
          object.data.via.map((point) => ({ x: point.x + dx, y: point.y + dy }))
        )
      )
    }
  }
  return moved
}

/** `changed` plus every connector they move, as one change (prompt 03a). */
export function withConnectors(
  present: ObjectMap,
  changed: readonly WhiteboardObjectInput[]
): WhiteboardObjectInput[] {
  if (changed.length === 0) return []
  const after = new Map(present)
  for (const object of changed) after.set(object.id, object)
  const merged = new Map(changed.map((object) => [object.id, object]))
  const ids = new Set(merged.keys())
  for (const connector of refreshConnectors([...after.values()], ids)) {
    merged.set(connector.id, connector)
  }
  return [...merged.values()]
}

/**
 * Fresh copies of `objects` (new ids, connectors between them still
 * attached, their own groups), moved by dx, dy and stacked above everything
 * on the board in their order.
 */
export function copiesOf(
  board: readonly WhiteboardObjectInput[],
  objects: readonly WhiteboardObjectInput[],
  dx: number,
  dy: number
): WhiteboardObjectInput[] {
  const fresh = remapWhiteboardIds(objects, newId)
  const base = nextZ(board)
  const moved = moveObjects(
    fresh,
    fresh.map((object) => object.id),
    dx,
    dy
  ).map((object, index) => ({ ...object, z: base + index }))
  const ids = new Set(moved.map((object) => object.id))
  const refreshed = new Map(
    refreshConnectors([...board, ...moved], ids).map((connector) => [connector.id, connector])
  )
  return moved.map((object) => refreshed.get(object.id) ?? object)
}
