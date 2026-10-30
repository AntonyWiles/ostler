import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import { t } from '@shared/i18n'
import type { ItemLinkInfo } from '@shared/ostler-api'
import { whiteboardPreciseHit } from '@shared/whiteboard/connectors'
import {
  borderHit,
  expandToGroups,
  hitTest,
  normaliseRect,
  objectRect,
  objectsInRect,
  resizeObject,
  resizeRect,
  snap,
  snapPoint,
  type Point,
  type Rect,
  type ResizeHandle
} from '@shared/whiteboard/geometry'
import type { ObjectMap } from '@shared/whiteboard/history'
import type {
  ConnectorEnd,
  ConnectorObject,
  WhiteboardNode,
  WhiteboardObjectInput
} from '@shared/whiteboard/model'
import { eraseHits } from '@shared/whiteboard/strokes'
import { objectName } from './object-names'
import { moveSelection, newId, withConnectors } from './selection-ops'
import { isTextEditable } from './TextEditor'
import {
  isBoxTool,
  isInkTool,
  isLineTool,
  isPlacingTool,
  movesByBorder,
  type BoxTool,
  type InkTool,
  type PlacingTool,
  type WhiteboardToolId
} from './tools'
import type { ViewportApi } from './useViewport'

/** Hit testing reaches this many screen pixels around an object. */
export const HIT_TOLERANCE = 6
/** How many screen pixels either side of an object's edge a drawing tool takes hold of it (MOP-34). */
const BORDER_GRAB = 5
/** Ctrl+wheel (and a touchpad pinch) zooms by this factor per wheel pixel. */
const WHEEL_ZOOM = 0.01
/** A wheel "line" (deltaMode 1) in pixels. */
const WHEEL_LINE = 16

export type Drag =
  | { kind: 'pan'; last: Point }
  | { kind: 'box'; start: Point; additive: boolean }
  | { kind: 'move'; start: Point; anchor: Point; ids: ReadonlySet<string> }
  | { kind: 'resize'; id: string; handle: ResizeHandle; start: Rect }
  | { kind: 'ink'; tool: InkTool; points: Point[] }
  | { kind: 'erase'; last: Point; hits: Set<string> }
  | { kind: 'draw-box'; tool: BoxTool; start: Point; startClient: Point }
  | {
      kind: 'connect'
      from: ConnectorEnd
      startClient: Point
      id: string
      /** Drawn with the node tool: its ends pin to node points (MOP-27). */
      nodes: boolean
    }
  | { kind: 'end'; id: string; end: 'from' | 'to'; startClient: Point }
  /** A connector's bend point dragged (`insert` false), or a new one pulled out of a stretch. */
  | { kind: 'bend'; id: string; index: number; insert: boolean; startClient: Point }

export interface Modifiers {
  altKey: boolean
  shiftKey: boolean
}

export const clientPoint = (event: { clientX: number; clientY: number }) => ({
  x: event.clientX,
  y: event.clientY
})

/** A connector being drawn or an end being dragged, and the object it would stick to. */
type ConnectorDraft = { connector: ConnectorObject; target: WhiteboardObjectInput | null } | null

/** What the pointer handlers read and do: the editor's state and actions this render. */
export interface WhiteboardPointerActions {
  tool: WhiteboardToolId
  readOnly: boolean
  /** Space is held: a press pans. */
  spaceHeld: boolean
  list: readonly WhiteboardObjectInput[]
  present: ObjectMap
  /** The one selected object, if exactly one is. */
  single: WhiteboardObjectInput | null
  /** The selection, read between a change and its render. */
  selectionRef: RefObject<ReadonlySet<string>>
  links: ReadonlyMap<string, ItemLinkInfo> | undefined
  pictureTitles: ReadonlyMap<string, string> | undefined
  /** The host opens links: a badge's double-click is taken. */
  opensLinks: boolean
  isEditing(): boolean
  select(ids: ReadonlySet<string>, options?: { announce?: boolean }): void
  commit(changed: readonly WhiteboardObjectInput[]): void
  announce(message: string): void
  finishEditing(how: 'pointer'): void
  startEditing(id: string, isNew: boolean): void
  place(kind: PlacingTool, at: Point): void
  placeMindMap(at: Point): void
  eraserRadius(): number
  finishInk(drag: Extract<Drag, { kind: 'ink' }>): void
  finishErase(hits: ReadonlySet<string>): void
  newBoxObject(kind: BoxTool, at: Point): WhiteboardObjectInput
  placeBox(object: WhiteboardObjectInput): void
  draftAt(
    drag: Extract<Drag, { kind: 'draw-box' }>,
    client: Point,
    point: Point,
    keys: Modifiers
  ): WhiteboardObjectInput | null
  endAt(
    point: Point,
    keys: Modifiers,
    exclude: ReadonlySet<string>,
    nodes?: boolean
  ): { end: ConnectorEnd; target: WhiteboardObjectInput | null }
  connectDraft(
    drag: Extract<Drag, { kind: 'connect' }>,
    client: Point,
    point: Point,
    keys: Modifiers
  ): ConnectorDraft
  endDraft(
    drag: Extract<Drag, { kind: 'end' }>,
    client: Point,
    point: Point,
    keys: Modifiers
  ): ConnectorDraft
  bendDraft(
    drag: Extract<Drag, { kind: 'bend' }>,
    client: Point,
    point: Point,
    keys: Modifiers
  ): ConnectorObject | null
  addConnector(connector: ConnectorObject): void
  removeBendPoint(connector: ConnectorObject, index: number | null): void
  /** True when `point` (board units) is on the link badge of `object`. */
  onBadge(object: WhiteboardObjectInput | null, point: Point): boolean
  /** Opens an object's link through the host; false when there is nothing to open. */
  openLink(object: WhiteboardObjectInput | null | undefined): boolean
}

type PointerHandler = (event: ReactPointerEvent<HTMLDivElement>) => void

export interface WhiteboardPointerHandlers {
  onPointerDown: PointerHandler
  onPointerMove: PointerHandler
  onPointerUp: PointerHandler
  onPointerCancel: PointerHandler
  /** A double-click on an object with words opens them for editing; on a card, its link. */
  onDoubleClick(event: ReactMouseEvent<HTMLDivElement>): void
}

export interface WhiteboardPointerApi {
  /** Moved or resized copies shown while a drag is under way; nothing is committed yet. */
  preview: readonly WhiteboardObjectInput[] | null
  /** The selection box being dragged out. */
  box: Rect | null
  panning: boolean
  /** The pointer is on an object's border with a drawing tool: a press moves it (MOP-34). */
  onBorder: boolean
  /** The stroke being drawn, in board units; nothing is committed until release. */
  inkPoints: readonly Point[] | null
  /** Strokes the eraser has touched in this drag: faded until release deletes them. */
  erasing: ReadonlySet<string>
  /** The shape, frame or connector being dragged out. */
  draft: WhiteboardObjectInput | null
  /** The object a connector end being dragged would stick to, outlined. */
  attachRect: Rect | null
  /** The node point a line end being drawn or dragged would pin to (MOP-27). */
  hotNode: { objectId: string; node: WhiteboardNode } | null
  /** A line end with node points is being drawn or dragged: they show on every object. */
  nodesShown: boolean
  /** A drag is under way. */
  dragging(): boolean
  /** The board's pointer handlers, over this render's state and actions. */
  handlers(actions: WhiteboardPointerActions): WhiteboardPointerHandlers
}

/**
 * The whiteboard editor's pointer (plan `docs/plans/whiteboards/`): pressing,
 * dragging and releasing on the board with every tool, double-clicks, and the
 * wheel, which pans (Ctrl+wheel zooms). It holds what a drag shows while it is
 * under way; the editor's actions commit what it ends in.
 */
export function useWhiteboardPointer(
  view: ViewportApi,
  boardRef: RefObject<HTMLElement | null>,
  version: number
): WhiteboardPointerApi {
  const [preview, setPreview] = useState<readonly WhiteboardObjectInput[] | null>(null)
  const [box, setBox] = useState<Rect | null>(null)
  const [panning, setPanning] = useState(false)
  const [onBorder, setOnBorder] = useState(false)
  const dragRef = useRef<Drag | null>(null)
  const [inkPoints, setInkPoints] = useState<readonly Point[] | null>(null)
  const [erasing, setErasing] = useState<ReadonlySet<string>>(() => new Set())
  const [draft, setDraft] = useState<WhiteboardObjectInput | null>(null)
  const [attachRect, setAttachRect] = useState<Rect | null>(null)
  const [hotNode, setHotNode] = useState<{ objectId: string; node: WhiteboardNode } | null>(null)
  const [nodesShown, setNodesShown] = useState(false)
  /** The animation frame that draws the stroke under way next, if one is due. */
  const inkFrame = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (inkFrame.current !== null) cancelAnimationFrame(inkFrame.current)
    },
    []
  )

  // A new version is a new board: no drag.
  useEffect(() => {
    setPreview(null)
    setBox(null)
    setInkPoints(null)
    setErasing(new Set())
    setDraft(null)
    setAttachRect(null)
    dragRef.current = null
  }, [version])

  const zoom = view.viewport.zoom

  // The wheel pans; Ctrl+wheel, which a touchpad pinch also sends, zooms at the pointer.
  // A native listener, because React's wheel listener is passive and cannot stop the page scrolling.
  useEffect(() => {
    const node = boardRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const unit = event.deltaMode === 1 ? WHEEL_LINE : 1
      if (event.ctrlKey) {
        const bounds = node.getBoundingClientRect()
        view.zoomTo(zoom * Math.exp(-event.deltaY * unit * WHEEL_ZOOM), {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top
        })
        return
      }
      const dx = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
      const dy = event.shiftKey && event.deltaX === 0 ? 0 : event.deltaY
      view.panBy(-dx * unit, -dy * unit)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [boardRef, view, zoom])

  const handlers = (actions: WhiteboardPointerActions): WhiteboardPointerHandlers => {
    const { tool, readOnly, list, present, single, selectionRef, select } = actions

    /** What a move or resize drag changes at `point`, connectors included. */
    const dragChange = (drag: Drag, point: Point, keys: Modifiers): WhiteboardObjectInput[] => {
      if (drag.kind === 'move') {
        const rawX = point.x - drag.start.x
        const rawY = point.y - drag.start.y
        // D25: the dragged object's top-left lands on the grid, unless Alt is held.
        const dx = keys.altKey ? rawX : snap(drag.anchor.x + rawX) - drag.anchor.x
        const dy = keys.altKey ? rawY : snap(drag.anchor.y + rawY) - drag.anchor.y
        if (dx === 0 && dy === 0) return []
        return withConnectors(present, moveSelection(list, drag.ids, dx, dy))
      }
      if (drag.kind === 'resize') {
        const object = present.get(drag.id)
        if (!object) return []
        const target = keys.altKey ? point : snapPoint(point)
        const rect = resizeRect(drag.start, drag.handle, target, {
          keepRatio: keys.shiftKey || object.kind === 'image'
        })
        return withConnectors(present, [resizeObject(object, rect)])
      }
      return []
    }

    const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
      dragRef.current = { kind: 'pan', last: clientPoint(event) }
      setPanning(true)
    }

    const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.button !== 1) return
      if (actions.isEditing()) {
        // A click outside the text box ends editing, and does nothing else.
        event.preventDefault()
        actions.finishEditing('pointer')
        return
      }
      const capture = () => {
        if (event.pointerId !== undefined) event.currentTarget.setPointerCapture?.(event.pointerId)
      }
      if (event.button === 1 || tool === 'hand' || actions.spaceHeld) {
        event.preventDefault()
        capture()
        startPan(event)
        return
      }
      const point = view.toBoard(clientPoint(event))
      // A drawing tool pressed on an object's border moves the object (MOP-34).
      const border =
        movesByBorder(tool) && !readOnly ? borderHit(list, point, BORDER_GRAB / zoom) : null
      if (border) {
        event.preventDefault()
        capture()
        const ids = expandToGroups(list, [border.id])
        select(ids)
        dragRef.current = { kind: 'move', start: point, anchor: { x: border.x, y: border.y }, ids }
        return
      }
      if (isPlacingTool(tool) && !readOnly) {
        // No focus moves to the board: the new object's text box takes it.
        event.preventDefault()
        actions.place(tool, event.altKey ? point : snapPoint(point))
        return
      }
      if (tool === 'mindmap' && !readOnly) {
        event.preventDefault()
        actions.placeMindMap(event.altKey ? point : snapPoint(point))
        return
      }
      if (isInkTool(tool) && !readOnly) {
        event.preventDefault()
        capture()
        dragRef.current = { kind: 'ink', tool, points: [point] }
        setInkPoints([point])
        return
      }
      if (tool === 'eraser' && !readOnly) {
        event.preventDefault()
        capture()
        // A click rubs out what is under it; a drag, everything its path crosses.
        const hits = new Set(eraseHits(list, [point], actions.eraserRadius()))
        dragRef.current = { kind: 'erase', last: point, hits }
        setErasing(hits)
        return
      }
      if (isBoxTool(tool) && !readOnly) {
        event.preventDefault()
        capture()
        dragRef.current = { kind: 'draw-box', tool, start: point, startClient: clientPoint(event) }
        return
      }
      if (isLineTool(tool) && !readOnly) {
        event.preventDefault()
        capture()
        // The start pins to a node point (the node tool), sticks to the object pressed on (or
        // near), or is free there.
        const nodes = tool === 'node'
        const { end } = actions.endAt(point, event, new Set(), nodes)
        dragRef.current = {
          kind: 'connect',
          from: end,
          startClient: clientPoint(event),
          id: newId(),
          nodes
        }
        return
      }
      const bendHandle =
        event.target instanceof Element ? event.target.closest('[data-via], [data-split]') : null
      if (bendHandle && single?.kind === 'connector' && !readOnly) {
        event.preventDefault()
        capture()
        const via = bendHandle.getAttribute('data-via')
        dragRef.current = {
          kind: 'bend',
          id: single.id,
          index: Number(via ?? bendHandle.getAttribute('data-split')),
          insert: via === null,
          startClient: clientPoint(event)
        }
        return
      }
      const endHandle =
        event.target instanceof Element
          ? event.target.closest('[data-end]')?.getAttribute('data-end')
          : null
      if (
        (endHandle === 'from' || endHandle === 'to') &&
        single?.kind === 'connector' &&
        !readOnly
      ) {
        event.preventDefault()
        capture()
        setNodesShown(true)
        dragRef.current = {
          kind: 'end',
          id: single.id,
          end: endHandle,
          startClient: clientPoint(event)
        }
        return
      }
      const handle =
        event.target instanceof Element
          ? event.target.closest('[data-handle]')?.getAttribute('data-handle')
          : null
      if (handle && single && !readOnly) {
        event.preventDefault()
        capture()
        dragRef.current = {
          kind: 'resize',
          id: single.id,
          handle: handle as ResizeHandle,
          start: objectRect(single)
        }
        return
      }
      const hit = hitTest(list, point, HIT_TOLERANCE / zoom, whiteboardPreciseHit(present))
      // A click on a link badge opens the link and leaves the selection as it is.
      if (!event.shiftKey && actions.onBadge(hit, point) && actions.openLink(hit)) {
        event.preventDefault()
        return
      }
      capture()
      if (hit) {
        // A click picks a whole group; Ctrl+click picks the one object inside it.
        const pickOne = event.ctrlKey || event.metaKey
        const group = pickOne ? new Set([hit.id]) : expandToGroups(list, [hit.id])
        if (event.shiftKey) {
          const next = new Set(selectionRef.current)
          const adding = !next.has(hit.id)
          for (const id of group) {
            if (adding) next.add(id)
            else next.delete(id)
          }
          select(next)
          return
        }
        // Pressing on the selection drags all of it, unless Ctrl picks one out.
        const ids = selectionRef.current.has(hit.id) && !pickOne ? selectionRef.current : group
        select(ids)
        if (!readOnly) {
          dragRef.current = { kind: 'move', start: point, anchor: { x: hit.x, y: hit.y }, ids }
        }
        return
      }
      dragRef.current = { kind: 'box', start: point, additive: event.shiftKey }
      setBox({ x: point.x, y: point.y, width: 0, height: 0 })
    }

    const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) {
        // Over an object's border, a drawing tool shows that a press moves it (MOP-34).
        const over =
          movesByBorder(tool) && !readOnly && event.pointerType !== 'touch'
            ? borderHit(list, view.toBoard(clientPoint(event)), BORDER_GRAB / zoom) !== null
            : false
        if (over !== onBorder) setOnBorder(over)
        return
      }
      if (drag.kind === 'pan') {
        const now = clientPoint(event)
        view.panBy(now.x - drag.last.x, now.y - drag.last.y)
        drag.last = now
        return
      }
      if (drag.kind === 'ink') {
        // Every point the pointer passed through since the last event, for a smooth line.
        const native = event.nativeEvent as PointerEvent
        const coalesced =
          typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
        for (const passed of coalesced.length > 0 ? coalesced : [native]) {
          drag.points.push(view.toBoard(clientPoint(passed)))
        }
        // The live line is drawn at most once a frame, however fast the events come.
        if (inkFrame.current === null) {
          inkFrame.current = requestAnimationFrame(() => {
            inkFrame.current = null
            if (dragRef.current === drag) setInkPoints([...drag.points])
          })
        }
        return
      }
      const point = view.toBoard(clientPoint(event))
      if (drag.kind === 'erase') {
        const fresh = eraseHits(
          list.filter((object) => !drag.hits.has(object.id)),
          [drag.last, point],
          actions.eraserRadius()
        )
        drag.last = point
        if (fresh.length === 0) return
        for (const id of fresh) drag.hits.add(id)
        setErasing(new Set(drag.hits))
        return
      }
      if (drag.kind === 'draw-box') {
        setDraft(actions.draftAt(drag, clientPoint(event), point, event))
        return
      }
      if (drag.kind === 'connect' || drag.kind === 'end') {
        const drawn =
          drag.kind === 'connect'
            ? actions.connectDraft(drag, clientPoint(event), point, event)
            : actions.endDraft(drag, clientPoint(event), point, event)
        if (drag.kind === 'connect') setDraft(drawn?.connector ?? null)
        else setPreview(drawn ? [drawn.connector] : null)
        setAttachRect(drawn?.target ? objectRect(drawn.target) : null)
        // The node point the end would pin to is lit up (MOP-27).
        const end = drawn?.connector.data[drag.kind === 'connect' ? 'to' : drag.end]
        setHotNode(end?.node && end.objectId ? { objectId: end.objectId, node: end.node } : null)
        return
      }
      if (drag.kind === 'bend') {
        const bent = actions.bendDraft(drag, clientPoint(event), point, event)
        setPreview(bent ? [bent] : null)
        return
      }
      if (drag.kind === 'box') {
        setBox(normaliseRect(drag.start, point))
        return
      }
      const changed = dragChange(drag, point, event)
      setPreview(changed.length > 0 ? changed : null)
    }

    const endDrag = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const drag = dragRef.current
      dragRef.current = null
      setPreview(null)
      setBox(null)
      setPanning(false)
      setInkPoints(null)
      setErasing(new Set())
      setDraft(null)
      setAttachRect(null)
      setHotNode(null)
      setNodesShown(false)
      if (!drag || cancelled || drag.kind === 'pan') return
      const point = view.toBoard(clientPoint(event))
      if (drag.kind === 'ink') {
        const last = drag.points[drag.points.length - 1]
        if (last.x !== point.x || last.y !== point.y) drag.points.push(point)
        actions.finishInk(drag)
        return
      }
      if (drag.kind === 'erase') {
        for (const id of eraseHits(list, [drag.last, point], actions.eraserRadius())) {
          drag.hits.add(id)
        }
        actions.finishErase(drag.hits)
        return
      }
      if (drag.kind === 'draw-box') {
        const drawn = actions.draftAt(drag, clientPoint(event), point, event)
        actions.placeBox(
          drawn ?? actions.newBoxObject(drag.tool, event.altKey ? point : snapPoint(point))
        )
        return
      }
      if (drag.kind === 'connect') {
        // A press and release without moving makes nothing; the tool stays chosen.
        const drawn = actions.connectDraft(drag, clientPoint(event), point, event)
        if (drawn) actions.addConnector(drawn.connector)
        return
      }
      if (drag.kind === 'end') {
        const drawn = actions.endDraft(drag, clientPoint(event), point, event)
        if (!drawn) return
        actions.commit([drawn.connector])
        const after = new Map(present)
        after.set(drawn.connector.id, drawn.connector)
        actions.announce(
          t('library:whiteboard.announce.endMoved', {
            name: objectName(drawn.connector, after, actions.links, actions.pictureTitles)
          })
        )
        return
      }
      if (drag.kind === 'bend') {
        const bent = actions.bendDraft(drag, clientPoint(event), point, event)
        if (!bent) return
        actions.commit([bent])
        actions.announce(
          t(
            drag.insert
              ? 'library:whiteboard.announce.pointAdded'
              : 'library:whiteboard.announce.pointMoved'
          )
        )
        return
      }
      if (drag.kind === 'box') {
        const inside = objectsInRect(list, normaliseRect(drag.start, point)).map(
          (object) => object.id
        )
        const base = drag.additive ? [...selectionRef.current] : []
        select(expandToGroups(list, [...base, ...inside]))
        return
      }
      const changed = dragChange(drag, point, event)
      if (changed.length === 0) return
      actions.commit(changed)
      actions.announce(
        t(
          drag.kind === 'move'
            ? 'library:whiteboard.announce.moved'
            : 'library:whiteboard.announce.resized'
        )
      )
    }

    const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
      const bend =
        event.target instanceof Element
          ? event.target.closest('[data-via]')?.getAttribute('data-via')
          : null
      if (bend !== null && bend !== undefined && single?.kind === 'connector' && !readOnly) {
        event.preventDefault()
        actions.removeBendPoint(single, Number(bend))
        return
      }
      if (
        actions.isEditing() ||
        isInkTool(tool) ||
        tool === 'eraser' ||
        isBoxTool(tool) ||
        isLineTool(tool)
      ) {
        return
      }
      const point = view.toBoard(clientPoint(event))
      const hit = hitTest(list, point, HIT_TOLERANCE / zoom, whiteboardPreciseHit(present))
      // A card has no words to edit: it opens. A badge's two clicks have opened its link already.
      if (hit?.kind === 'card') {
        if (actions.openLink(hit)) event.preventDefault()
        return
      }
      if (actions.opensLinks && actions.onBadge(hit, point)) {
        event.preventDefault()
        return
      }
      if (readOnly || !hit || !isTextEditable(hit)) return
      event.preventDefault()
      select(new Set([hit.id]), { announce: false })
      actions.startEditing(hit.id, false)
    }

    return {
      onPointerDown,
      onPointerMove,
      onPointerUp: (event) => endDrag(event, false),
      onPointerCancel: (event) => endDrag(event, true),
      onDoubleClick
    }
  }

  return {
    preview,
    box,
    panning,
    onBorder,
    inkPoints,
    erasing,
    draft,
    attachRect,
    hotNode,
    nodesShown,
    dragging: () => dragRef.current !== null,
    handlers
  }
}
