import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SVGProps
} from 'react'
import { BRAND } from '@shared/brand'
import { t } from '@shared/i18n'
import { itemLinkUrl } from '@shared/item-links'
import type { ItemLinkInfo, PlanningMilestone } from '@shared/ostler-api'
import {
  ATTACH_TOLERANCE,
  connectorBox,
  connectorControlPoints,
  connectorGeometry,
  connectorLabelPoint,
  detachMissing,
  nearestStretch,
  withBendPoints,
  hasNodes,
  nearestAttachTarget,
  nearestNode,
  nodePoint,
  refreshConnectors,
  whiteboardPreciseHit
} from '@shared/whiteboard/connectors'
import {
  align,
  clampZoom,
  distribute,
  expandToGroups,
  fitRect,
  hitTest,
  linkBadgeRect,
  MIN_OBJECT_SIZE,
  nextZ,
  nextZoomStep,
  normaliseRect,
  objectRect,
  pointInRect,
  rectCentre,
  resizeBy,
  resizeObject,
  snapPoint,
  unionRect,
  type AlignEdge,
  type DistributeAxis,
  type Point,
  type Rect
} from '@shared/whiteboard/geometry'
import type { ObjectMap } from '@shared/whiteboard/history'
import {
  addMindMapChild,
  addMindMapSibling,
  isMindmap,
  mindMapNeighbour,
  mindMapRoot,
  newMindMapRoot,
  recolourMindMap,
  relayoutMindMaps,
  removeMindMapBranch,
  unfreeMindMapNode,
  type MindMapDirection
} from '@shared/whiteboard/mind-map'
import {
  WHITEBOARD_DEFAULT_SIZES,
  WHITEBOARD_LIMITS,
  WHITEBOARD_NODES,
  WHITEBOARD_SHAPES,
  defaultObject,
  isLinkable,
  type ConnectorEnd,
  type ConnectorObject,
  type MindmapObject,
  type WhiteboardColour,
  type WhiteboardObjectInput,
  type WhiteboardShape
} from '@shared/whiteboard/model'
import { readingOrder } from '@shared/whiteboard/outline'
import { ERASER_RADIUS, penFromPoints } from '@shared/whiteboard/strokes'
import { isTaskableObject, type MakeWhiteboardTasksResult } from '@shared/whiteboard/tasks'
import {
  Button,
  IconButton,
  Menu,
  MenuList,
  VisuallyHidden,
  useAnnounce,
  useToast,
  type MenuEntry,
  type MenuItem
} from '../../ui'
import { useMenuEntries } from '../../ui/Menu'
import {
  ChevronDown,
  ClipboardPaste,
  Copy,
  ExternalLink,
  GitBranch,
  Group,
  Image as ImageIcon,
  Link2,
  ListChecks,
  Network,
  Pencil,
  Plus,
  Redo2,
  Scan,
  Scissors,
  Spline,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Waypoints,
  ZoomIn,
  ZoomOut
} from '../../ui/icons'
import { canvasMeasure } from './measure'
import { ConnectToDialog } from './ConnectToDialog'
import { LinkDialog } from './LinkDialog'
import { MakeWhiteboardTasksDialog } from './MakeWhiteboardTasksDialog'
import { objectName } from './object-names'
import { PictureLibraryDialog } from './PictureLibraryDialog'
import { type PictureRef, type WhiteboardPictureSource } from './picture-source'
import { ConnectorPart, FramePart, PenPart, ShapePart } from './scene-parts'
import { SelectionOverlay, hasRoomForHandles } from './SelectionOverlay'
import { PropertyAction, PropertyBar } from './PropertyBar'
import { SHAPE_ICONS, fitTextHeight, type StyleControl } from './style-controls'
import { TextEditor, isTextEditable } from './TextEditor'
import { useViewport } from './useViewport'
import {
  HIT_TOLERANCE,
  clientPoint,
  useWhiteboardPointer,
  type Drag,
  type Modifiers
} from './useWhiteboardPointer'
import { useWhiteboardKeys } from './useWhiteboardKeys'
import { useWhiteboardPaste } from './useWhiteboardPaste'
import { useWhiteboardHistory } from './useWhiteboardHistory'
import { copiedWhiteboardObjects } from './whiteboard-clipboard'
import {
  ALIGN_ITEMS,
  COPY_OFFSET,
  DISTRIBUTE_ITEMS,
  RESTACK,
  copiesOf,
  isConnectable,
  moveSelection,
  newId,
  sameSet,
  withConnectors,
  type RestackAction
} from './selection-ops'
import {
  CONNECTOR_TOOL_CONTROLS,
  DEFAULT_CONNECTOR_STYLE,
  DEFAULT_INKS,
  DEFAULT_TOOL_COLOURS,
  TOOLS,
  connectorStyleOf,
  inkPreview,
  isColourTool,
  isInkTool,
  isLineTool,
  keysOf,
  label,
  makeConnector,
  toolConnector,
  toolShape,
  type BoxTool,
  type ColourTool,
  type ConnectorStyle,
  type Ink,
  type InkTool,
  type PlacingTool,
  type WhiteboardToolId
} from './tools'
import { WhiteboardScene } from './WhiteboardScene'
import './WhiteboardEditor.css'

/** Where focus goes back to when a dialog closes. */
interface FocusBack {
  objectId: string | null
  control: HTMLElement | null
}

export interface WhiteboardEditorProps {
  /** The whiteboard's title: names the board for screen readers. */
  title: string
  /** The objects to start from. A new `version` replaces them and clears undo (D13). */
  objects: readonly WhiteboardObjectInput[]
  version: number
  /** Every new state: after a commit, an undo or a redo. Prompt 07 saves from it. */
  onChange(present: ObjectMap): void
  readOnly?: boolean
  imageUrl(imageItemId: string): string | null
  links?: ReadonlyMap<string, ItemLinkInfo>
  /** The host's own controls at the end of the top bar (save status, Back to the plan). */
  barEnd?: ReactNode
  /**
   * The whiteboard's project: objects copied in another project paste
   * without their pictures, which belong to that project's Library (D16).
   */
  projectId?: string | null
  /**
   * Where pictures come from (prompt 11): the host's Library. Without it the
   * Picture tool is not shown and pictures dropped or pasted are ignored.
   */
  pictures?: WhiteboardPictureSource
  /** The Library titles of the board's pictures, by image item id: a picture's spoken name. */
  pictureTitles?: ReadonlyMap<string, string>
  /**
   * Opens an object's link (prompt 12): `O`, a click on a link badge, a
   * double-click or Enter on a card. The host navigates to the item or opens
   * the web address. Without it links show but do not open.
   */
  onOpenLink?(url: string): void
  /**
   * Make tasks (prompt 13, D17): the board's id, the project's milestones and
   * the host's save, which runs before the tasks are made and after the
   * objects are linked to them. Without `whiteboardId`, `projectId` and
   * `flush`, Make tasks is not offered.
   */
  whiteboardId?: string
  milestones?: readonly PlanningMilestone[]
  flush?(): Promise<void>
}

/** A press that moves less than this many screen pixels is a click, not a drag. */
const CLICK_SLOP = 4

const NO_MILESTONES: readonly PlanningMilestone[] = []

/** An editing session: one object's words in the text box, one undo step. */
interface EditSession {
  id: string
  /** Placed by this session: an empty new text is removed when editing ends. */
  isNew: boolean
  /** The session's undo step exists; every later change amends it. */
  committed: boolean
}

/** A line end comes to a node point this many screen pixels away (MOP-27). */
const NODE_REACH = 12
/** The grid's dots are drawn from this zoom up. */
const GRID_MIN_ZOOM = 0.75

/** D18: with a mind-map node selected the arrows move along its tree, saying so at an end. */
const MIND_MAP_ARROWS: Record<string, { direction: MindMapDirection; end: string }> = {
  ArrowLeft: { direction: 'parent', end: 'library:whiteboard.announce.mapEndParent' },
  ArrowRight: { direction: 'firstChild', end: 'library:whiteboard.announce.mapEndChild' },
  ArrowUp: { direction: 'previous', end: 'library:whiteboard.announce.mapEndPrevious' },
  ArrowDown: { direction: 'next', end: 'library:whiteboard.announce.mapEndNext' }
}

/**
 * The whiteboard editor (plan `docs/plans/whiteboards/`, prompt 05): a board
 * that pans, zooms, selects, moves, resizes, deletes, undoes and redoes, by
 * mouse, pen and keyboard. It holds the board in memory and reports every new
 * state through `onChange`; it never loads or saves (prompt 07). Built like
 * the mark-up editor: every tool has a button and a key from the shortcut
 * table, every object is a focusable element with a spoken name, and changes
 * are announced (D14).
 */
export function WhiteboardEditor({
  title,
  objects,
  version,
  onChange,
  readOnly = false,
  imageUrl,
  links,
  barEnd,
  projectId = null,
  pictures,
  pictureTitles,
  onOpenLink,
  whiteboardId,
  milestones = NO_MILESTONES,
  flush
}: WhiteboardEditorProps) {
  const announce = useAnnounce()
  const { toastUndo } = useToast()
  const history = useWhiteboardHistory(objects, version, onChange)
  const { present, list } = history
  /** The board now, for work that finishes after an await (a picture import). */
  const listRef = useRef(list)
  listRef.current = list
  const rootRef = useRef<HTMLDivElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const afterRef = useRef<HTMLSpanElement | null>(null)
  const view = useViewport(boardRef)
  const { viewport } = view
  const helpId = useId()
  const measure = useMemo(() => canvasMeasure(), [])

  const tools = useMemo(() => TOOLS.filter((tool) => !readOnly || !tool.edits), [readOnly])
  const [tool, setTool] = useState<WhiteboardToolId>('select')
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set())
  /** Read by handlers between a change and its render. */
  const selectionRef = useRef(selection)
  const pointer = useWhiteboardPointer(view, boardRef, version)
  const {
    preview,
    box,
    panning,
    onBorder,
    inkPoints,
    erasing,
    draft,
    attachRect,
    hotNode,
    nodesShown
  } = pointer
  const fitted = useRef(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  /** The object whose words are in the text box, if any; the ref is read by handlers. */
  const [editingId, setEditingId] = useState<string | null>(null)
  const editRef = useRef<EditSession | null>(null)
  /** What the pen and the marker draw with next; kept for the session. */
  const [inks, setInks] = useState<Record<InkTool, Ink>>(DEFAULT_INKS)
  /** The shape the Shape tool places next. */
  const [shapeKind, setShapeKind] = useState<WhiteboardShape>('rectangle')
  /** The colour each placing tool makes its next object in; kept for the session. */
  const [toolColours, setToolColours] =
    useState<Record<ColourTool, WhiteboardColour>>(DEFAULT_TOOL_COLOURS)
  /** What the Connector tool draws next (prompt 10). */
  const [connectorStyle, setConnectorStyle] = useState<ConnectorStyle>(DEFAULT_CONNECTOR_STYLE)
  /** The right-click menu: where it opens, in screen pixels, while it is open. */
  const [menuAt, setMenuAt] = useState<{
    x: number
    y: number
    board: Point
    via: number | null
  } | null>(null)
  /** The object Connect to… joins from, while its dialog is open. */
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  /** The Picture tool's menu and its From the Library… dialog (prompt 11). */
  const [pictureMenuOpen, setPictureMenuOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const pictureButtonRef = useRef<HTMLButtonElement | null>(null)
  /** The Link dialog (prompt 12): for one object, or to place a new card. */
  const [linking, setLinking] = useState<{ id: string } | { card: true } | null>(null)
  /** The Make tasks dialog (prompt 13) is open. */
  const [makingTasks, setMakingTasks] = useState(false)
  /** Where focus goes back to when Make tasks closes: the control that opened it, or the object. */
  const makeTasksFrom = useRef<FocusBack | null>(null)
  const [focusBack, setFocusBack] = useState<FocusBack | null>(null)

  // A new version is a new board: nothing selected, no drag, no text box.
  useEffect(() => {
    selectionRef.current = new Set()
    setSelection(selectionRef.current)
    setConnectFrom(null)
    setLinking(null)
    setMakingTasks(false)
    editRef.current = null
    setEditingId(null)
  }, [version])

  // An object that went (an undo, a reload) takes its text box with it.
  useEffect(() => {
    if (editingId !== null && !present.has(editingId)) {
      editRef.current = null
      setEditingId(null)
    }
  }, [editingId, present])

  /** The selection, without objects an undo took away. */
  const selected = useMemo(
    () => new Set([...selection].filter((id) => present.has(id))),
    [selection, present]
  )
  const shown = useMemo(() => {
    const changed = new Map((preview ?? []).map((object) => [object.id, object]))
    // A connector whose label is in the text box keeps its line; only the label is hidden.
    const editing = editingId === null ? undefined : present.get(editingId)
    if (editing?.kind === 'connector') changed.set(editing.id, { ...editing, text: '' })
    if (changed.size === 0) return list
    return list.map((object) => changed.get(object.id) ?? object)
  }, [list, preview, editingId, present])
  const shownById = useMemo(() => new Map(shown.map((object) => [object.id, object])), [shown])
  const order = useMemo(() => readingOrder(list), [list])
  const tabStop = order.find((object) => selected.has(object.id))?.id ?? order[0]?.id ?? null
  const single = selected.size === 1 ? (present.get([...selected][0]) ?? null) : null
  /** The selected objects, in draw order (back to front). */
  const selectedObjects = useMemo(
    () => list.filter((object) => selected.has(object.id)),
    [list, selected]
  )
  const hiddenIds = useMemo(
    () =>
      editingId === null || present.get(editingId)?.kind === 'connector'
        ? undefined
        : new Set([editingId]),
    [editingId, present]
  )

  const select = (ids: ReadonlySet<string>, options: { announce?: boolean } = {}) => {
    if (sameSet(selectionRef.current, ids)) return
    selectionRef.current = ids
    setSelection(ids)
    if (options.announce === false) return
    announce(
      ids.size === 0
        ? t('library:whiteboard.announce.nothingSelected')
        : t('library:whiteboard.announce.selected', { count: ids.size })
    )
  }

  // After the first layout the view fits the board's objects (100% for an empty board).
  useEffect(() => {
    if (fitted.current || view.size.width === 0 || view.size.height === 0) return
    fitted.current = true
    const bounds = unionRect(list.map(objectRect))
    if (bounds) view.fit(bounds)
  }, [view.size.width, view.size.height])

  useEffect(() => {
    if (!focusId) return
    // Object ids are letters, digits, `_` and `-` (model.ts), safe in a selector.
    if (focusId === '#board') boardRef.current?.focus()
    else boardRef.current?.querySelector<SVGElement>(`[data-object-id="${focusId}"]`)?.focus()
    setFocusId(null)
  }, [focusId])

  // --- Zoom -------------------------------------------------------------

  const sayZoom = (zoom: number) =>
    announce(t('library:whiteboard.announce.zoom', { percent: Math.round(zoom * 100) }))

  const zoomStep = (direction: 1 | -1) => {
    const next = clampZoom(nextZoomStep(viewport.zoom, direction))
    view.zoomTo(next)
    sayZoom(next)
  }
  const zoomReset = () => {
    view.zoomTo(1)
    sayZoom(1)
  }
  const zoomFit = () => {
    const bounds = unionRect(list.map(objectRect))
    if (!bounds) return zoomReset()
    view.fit(bounds)
    sayZoom(fitRect(bounds, view.size).zoom)
  }

  // --- Changes ----------------------------------------------------------

  /**
   * `changed` (with `deleted` gone) plus what follows from them: every mind
   * map they touch laid out again, each node sized to its words (D18, prompt
   * 14), and every connector that moves with them (prompt 03a).
   */
  const settle = (
    changed: readonly WhiteboardObjectInput[],
    deleted: readonly string[] = []
  ): WhiteboardObjectInput[] => {
    const after = new Map(present)
    for (const id of deleted) after.delete(id)
    for (const object of changed) after.set(object.id, object)
    const touched = changed.filter(isMindmap).map((node) => node.id)
    for (const id of deleted) {
      const gone = present.get(id)
      if (gone && isMindmap(gone) && gone.data.parentId !== null) touched.push(gone.data.parentId)
    }
    const merged = new Map(changed.map((object) => [object.id, object]))
    if (touched.length > 0) {
      for (const node of relayoutMindMaps([...after.values()], touched, measure)) {
        merged.set(node.id, node)
      }
    }
    return withConnectors(after, [...merged.values()])
  }

  const moveBy = (dx: number, dy: number) => {
    const changed = withConnectors(present, moveSelection(list, selected, dx, dy))
    if (changed.length === 0) return
    history.commit(changed)
    announce(t('library:whiteboard.announce.moved'))
  }

  const resizeSelectedBy = (dw: number, dh: number) => {
    if (!single || single.kind === 'connector') return
    const rect = resizeBy(objectRect(single), dw, dh)
    history.commit(withConnectors(present, [resizeObject(single, rect)]))
    announce(t('library:whiteboard.announce.resized'))
  }

  /** What deleting the selection takes away: the selection and every mind-map branch under it. */
  const removalOfSelection = (): Set<string> => {
    const gone = new Set<string>()
    for (const id of selected) {
      const object = present.get(id)
      if (!object) continue
      gone.add(id)
      if (isMindmap(object)) for (const branch of removeMindMapBranch(list, id)) gone.add(branch)
    }
    return gone
  }

  const deleteSelected = (announcement = 'library:whiteboard.announce.deleted') => {
    if (selected.size === 0) return
    const gone = removalOfSelection()
    const freed = detachMissing(list, gone)
    // Focus goes to the next object left in reading order, else the last one before.
    const firstGone = order.findIndex((object) => gone.has(object.id))
    const left = order.filter((object) => !gone.has(object.id))
    const next = order.slice(firstGone).find((object) => !gone.has(object.id))
    const fallback = left[left.length - 1]
    history.commit(settle(freed, [...gone]), [...gone])
    select(new Set(), { announce: false })
    announce(t(announcement, { count: gone.size }))
    // Deleting is the one step that takes work away, so the app's usual Undo toast follows it
    // (not a cut, which the paste after it undoes). It undoes the delete alone: once anything
    // else has changed the board since (another step, an undo, a reload), it does nothing.
    if (announcement === 'library:whiteboard.announce.deleted') {
      const afterDelete = history.now()
      toastUndo(t(announcement, { count: gone.size }), () => {
        if (history.now() === afterDelete) history.undo()
      })
    }
    setFocusId((next ?? fallback)?.id ?? '#board')
  }

  const step = (direction: 'undo' | 'redo') => {
    if (direction === 'undo' ? !history.canUndo : !history.canRedo) return
    if (direction === 'undo') history.undo()
    else history.redo()
    announce(t(`library:whiteboard.announce.${direction === 'undo' ? 'undone' : 'redone'}`))
  }

  // --- Notes, text and editing words --------------------------------------

  const startEditing = (id: string, isNew: boolean) => {
    editRef.current = { id, isNew, committed: isNew }
    setEditingId(id)
  }

  /** D29: a new note or text with its top-left at `at`, selected, its words open for editing. */
  const place = (kind: PlacingTool, at: Point) => {
    const object = {
      ...defaultObject(kind, { id: newId(), x: at.x, y: at.y, z: nextZ(list) }),
      colour: toolColours[kind]
    } as WhiteboardObjectInput
    history.commit([object])
    select(new Set([object.id]), { announce: false })
    setTool('select')
    announce(t(`library:whiteboard.announce.placed.${kind}`))
    startEditing(object.id, true)
  }

  /** The keyboard path (D14): the object in the middle of the view, snapped. */
  const placeInView = (kind: PlacingTool) => {
    const centre = rectCentre(view.viewBox)
    const size = WHITEBOARD_DEFAULT_SIZES[kind]
    place(kind, snapPoint({ x: centre.x - size.width / 2, y: centre.y - size.height / 2 }))
  }

  // --- Mind maps (prompt 14, D18, D27) -------------------------------------

  /** A new central idea with its top-left at `at`, selected, its words open for editing. */
  const placeMindMap = (at: Point) => {
    const root = {
      ...newMindMapRoot({ id: newId(), x: at.x, y: at.y, z: nextZ(list) }),
      colour: toolColours.mindmap
    }
    history.commit([root])
    select(new Set([root.id]), { announce: false })
    setTool('select')
    announce(t('library:whiteboard.announce.placed.mindmap'))
    startEditing(root.id, true)
  }

  /**
   * A new idea straight after `fromId` (`sibling`, or a child when `fromId` is
   * a central idea) or as its last child (`child`), with the map laid out
   * again: one undo step, which the words typed into it amend. Its text box
   * opens.
   */
  const addIdea = (fromId: string, how: 'child' | 'sibling') => {
    const at = { id: newId(), z: nextZ(list) }
    const sibling = how === 'sibling' ? addMindMapSibling(list, fromId, at) : null
    const node = sibling?.node ?? addMindMapChild(list, fromId, at)
    history.commit(settle([...(sibling?.renumbered ?? []), node]))
    select(new Set([node.id]), { announce: false })
    announce(t('library:whiteboard.announce.ideaAdded'))
    startEditing(node.id, true)
  }

  /** Enter or Tab while typing in a node: its editing ends and the next idea opens. */
  const branchFromEditing = (how: 'child' | 'sibling') => {
    const session = editRef.current
    const node = session ? present.get(session.id) : undefined
    if (!session || !node || !isMindmap(node)) return
    editRef.current = null
    addIdea(node.id, how)
  }

  /** An arrow key on a node: selection and focus move along the tree, or the end is said. */
  const goAlongMap = (id: string, arrowKey: string) => {
    const { direction, end } = MIND_MAP_ARROWS[arrowKey]
    const next = mindMapNeighbour(list, id, direction)
    const target = next === null ? undefined : present.get(next)
    if (!target) {
      announce(t(end))
      return
    }
    select(new Set([target.id]), { announce: false })
    setFocusId(target.id)
    announce(objectName(target, present, links, pictureTitles))
  }

  /** The one selected central idea, when its map has nodes in other colours. */
  const recolourRoot =
    !readOnly &&
    single !== null &&
    isMindmap(single) &&
    mindMapRoot(list, single.id)?.id === single.id &&
    recolourMindMap(list, single.id, single.colour).length > 0
      ? single
      : null

  /** Apply to the whole map: every node takes the central idea's colour, in one commit. */
  const applyColourToMap = () => {
    if (!recolourRoot) return
    commitAndSay(
      recolourMindMap(list, recolourRoot.id, recolourRoot.colour),
      t('library:whiteboard.announce.mapRecoloured')
    )
    // The button goes once the map is one colour: focus goes back to the central idea.
    setFocusId(recolourRoot.id)
  }

  // --- Shapes, frames, pen, marker and eraser (prompt 09) ------------------

  /** A new shape (the current one) or frame of the D29 size, its top-left at `at`. */
  const newBoxObject = (kind: BoxTool, at: Point): WhiteboardObjectInput => {
    const object = {
      ...defaultObject(kind, { id: newId(), x: at.x, y: at.y, z: nextZ(list) }),
      colour: toolColours[kind]
    } as WhiteboardObjectInput
    return object.kind === 'shape'
      ? { ...object, data: { ...object.data, shape: shapeKind } }
      : object
  }

  /** Puts a new shape or frame on the board; the tool goes back to Select with it selected. */
  const placeBox = (object: WhiteboardObjectInput) => {
    history.commit([object])
    select(new Set([object.id]), { announce: false })
    setTool('select')
    announce(
      object.kind === 'shape'
        ? t('library:whiteboard.announce.placed.shape', {
            shape: t(`library:whiteboard.shapes.${object.data.shape}`)
          })
        : t('library:whiteboard.announce.placed.frame')
    )
    setFocusId(object.id)
  }

  /** The keyboard path (D14): a shape or frame in the middle of the view, snapped. */
  const placeBoxInView = (kind: BoxTool) => {
    const centre = rectCentre(view.viewBox)
    const size = WHITEBOARD_DEFAULT_SIZES[kind]
    placeBox(
      newBoxObject(kind, snapPoint({ x: centre.x - size.width / 2, y: centre.y - size.height / 2 }))
    )
  }

  /**
   * The box a shape or frame drag draws: corners on the grid unless Alt is
   * held, a square (or circle) with Shift, never smaller than MIN_OBJECT_SIZE.
   */
  const draggedBox = (start: Point, point: Point, keys: Modifiers): Rect => {
    const from = keys.altKey ? start : snapPoint(start)
    let to = keys.altKey ? point : snapPoint(point)
    if (keys.shiftKey) {
      const side = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))
      to = {
        x: from.x + (to.x < from.x ? -side : side),
        y: from.y + (to.y < from.y ? -side : side)
      }
    }
    const rect = normaliseRect(from, to)
    return {
      ...rect,
      width: Math.max(rect.width, MIN_OBJECT_SIZE),
      height: Math.max(rect.height, MIN_OBJECT_SIZE)
    }
  }

  /** The shape or frame a box drag makes at `point`, or null while it is still a click. */
  const draftAt = (
    drag: Extract<Drag, { kind: 'draw-box' }>,
    client: Point,
    point: Point,
    keys: Modifiers
  ): WhiteboardObjectInput | null => {
    const moved = Math.hypot(client.x - drag.startClient.x, client.y - drag.startClient.y)
    if (moved < CLICK_SLOP) return null
    const rect = draggedBox(drag.start, point, keys)
    return { ...newBoxObject(drag.tool, rect), ...rect }
  }

  /** The Shape tool's next shape (S again, or the tool's button again). */
  const nextShape = () => {
    const next =
      WHITEBOARD_SHAPES[(WHITEBOARD_SHAPES.indexOf(shapeKind) + 1) % WHITEBOARD_SHAPES.length]
    setShapeKind(next)
    announce(
      t('library:whiteboard.announce.shapeChosen', {
        shape: t(`library:whiteboard.shapes.${next}`)
      })
    )
  }

  /**
   * Picks a tool; picking the Shape tool while it is chosen moves on to the
   * next shape. A drawing tool clears the selection, so the style controls
   * show what that tool makes next.
   */
  const chooseTool = (id: WhiteboardToolId) => {
    if (id === 'shape' && tool === 'shape') nextShape()
    else setTool(id)
    if (id !== 'select' && id !== 'hand') select(new Set(), { announce: false })
  }

  /** The eraser reaches this far round its path: the same on screen at any zoom. */
  const eraserRadius = () => ERASER_RADIUS / viewport.zoom

  /** Release of a pen or marker stroke: the one commit that makes it. */
  const finishInk = (drag: Extract<Drag, { kind: 'ink' }>) => {
    const ink = inks[drag.tool]
    const pen = penFromPoints(drag.points, {
      id: newId(),
      z: nextZ(list),
      colour: ink.colour,
      stroke: ink.stroke,
      marker: drag.tool === 'marker'
    })
    history.commit([pen])
    // The stroke just drawn stays selected, so the style controls change it.
    select(new Set([pen.id]), { announce: false })
    announce(t('library:whiteboard.announce.drawn'))
  }

  /** Release of the eraser: every touched stroke goes in one commit. */
  const finishErase = (hits: ReadonlySet<string>) => {
    if (hits.size === 0) return
    history.commit(detachMissing(list, hits), [...hits])
    const left = new Set([...selectionRef.current].filter((id) => !hits.has(id)))
    select(left, { announce: false })
    announce(t('library:whiteboard.announce.erased', { count: hits.size }))
  }

  /** Keeps a style for what the chosen drawing tool makes next; nothing for Select or Hand. */
  const rememberToolStyle = (control: StyleControl, value: string) => {
    if (isLineTool(tool)) {
      const next = control.write(toolConnector(connectorStyle), value, measure)
      if (next.kind === 'connector') setConnectorStyle(connectorStyleOf(next))
    } else if (isInkTool(tool)) {
      if (control.id !== 'colour' && control.id !== 'stroke') return
      const key = control.id
      setInks((current) => ({ ...current, [tool]: { ...current[tool], [key]: value } }))
    } else if (control.id === 'shape') {
      setShapeKind(value as WhiteboardShape)
    } else if (control.id === 'colour' && isColourTool(tool)) {
      const kind = tool
      setToolColours((current) => ({ ...current, [kind]: value as WhiteboardColour }))
    }
  }

  /** The style controls' settings for what a drawing tool makes next. */
  const pickToolStyle = (control: StyleControl, value: string) => {
    rememberToolStyle(control, value)
    announce(
      t('library:whiteboard.announce.styled', {
        control: t(control.labelKey),
        value: t(control.optionLabelKey(value))
      })
    )
  }

  // --- Lines and arrows (prompt 10) -----------------------------------------

  /** A dropped end sticks to objects this near: the same on screen at any zoom. */
  const attachTolerance = () => ATTACH_TOLERANCE / viewport.zoom

  /**
   * Where a connector end dropped at `point` goes: pinned to a node point
   * near it when `nodes` (MOP-27), stuck to the object there (not one in
   * `exclude`), or free at the point, snapped unless Alt is held.
   */
  const endAt = (
    point: Point,
    keys: Modifiers,
    exclude: ReadonlySet<string>,
    nodes = false
  ): { end: ConnectorEnd; target: WhiteboardObjectInput | null } => {
    const pinned = nodes ? nearestNode(list, point, NODE_REACH / viewport.zoom, exclude) : null
    if (pinned) {
      const at = nodePoint(pinned.object, pinned.node, 0)
      return {
        end: { objectId: pinned.object.id, x: at.x, y: at.y, node: pinned.node },
        target: pinned.object
      }
    }
    const target = nearestAttachTarget(list, point, attachTolerance(), exclude)
    const at = target || keys.altKey ? point : snapPoint(point)
    return { end: { objectId: target?.id ?? null, x: at.x, y: at.y }, target }
  }

  const movedFar = (startClient: Point, client: Point) =>
    Math.hypot(client.x - startClient.x, client.y - startClient.y) >= CLICK_SLOP

  /** The connector a Connector tool drag makes at `point`, or null while it is still a click. */
  const connectDraft = (
    drag: Extract<Drag, { kind: 'connect' }>,
    client: Point,
    point: Point,
    keys: Modifiers
  ): { connector: ConnectorObject; target: WhiteboardObjectInput | null } | null => {
    if (!movedFar(drag.startClient, client)) return null
    const exclude = new Set(drag.from.objectId === null ? [] : [drag.from.objectId])
    const { end, target } = endAt(point, keys, exclude, drag.nodes)
    const connector = makeConnector(
      list,
      { id: drag.id, z: nextZ(list), from: drag.from, to: end },
      connectorStyle
    )
    return { connector, target }
  }

  /** The selected connector with one end moved to `point`, or null while it is still a click. */
  const endDraft = (
    drag: Extract<Drag, { kind: 'end' }>,
    client: Point,
    point: Point,
    keys: Modifiers
  ): { connector: ConnectorObject; target: WhiteboardObjectInput | null } | null => {
    const connector = present.get(drag.id)
    if (connector?.kind !== 'connector' || !movedFar(drag.startClient, client)) return null
    const other = connector.data[drag.end === 'from' ? 'to' : 'from']
    const exclude = new Set(other.objectId === null ? [] : [other.objectId])
    // A dragged end pins to the node points, which show while it moves (MOP-27).
    const { end, target } = endAt(point, keys, exclude, true)
    const moved: ConnectorObject = { ...connector, data: { ...connector.data, [drag.end]: end } }
    const [fresh] = refreshConnectors([...list, moved], new Set([moved.id]))
    return { connector: fresh ?? moved, target }
  }

  /** A connector with `via` as its bend points, its box and drawn ends worked out again. */
  const bentConnector = (connector: ConnectorObject, via: readonly Point[]): ConnectorObject => {
    const bent = withBendPoints(connector, via)
    const [fresh] = refreshConnectors([...list, bent], new Set([bent.id]))
    return fresh ?? bent
  }

  /** The selected connector with a bend point moved or added at `point`, or null while it is still a click. */
  const bendDraft = (
    drag: Extract<Drag, { kind: 'bend' }>,
    client: Point,
    point: Point,
    keys: Modifiers
  ): ConnectorObject | null => {
    const connector = present.get(drag.id)
    if (connector?.kind !== 'connector' || !movedFar(drag.startClient, client)) return null
    const at = keys.altKey ? point : snapPoint(point)
    const via = [...(connector.data.via ?? [])]
    if (drag.insert) via.splice(drag.index, 0, at)
    else via[drag.index] = at
    return bentConnector(connector, via)
  }

  /** Adds a bend point to a connector at `point`, on the stretch nearest it: one undo step. */
  const addBendPoint = (connector: ConnectorObject, point: Point) => {
    const index = nearestStretch(connectorControlPoints(connector, present), point)
    const via = [...(connector.data.via ?? [])]
    via.splice(index, 0, snapPoint(point))
    history.commit([bentConnector(connector, via)])
    announce(t('library:whiteboard.announce.pointAdded'))
  }

  /** Takes one bend point off a connector, or every one with `index` null: one undo step. */
  const removeBendPoint = (connector: ConnectorObject, index: number | null) => {
    const via = connector.data.via ?? []
    if (via.length === 0) return
    history.commit([
      bentConnector(connector, index === null ? [] : via.filter((_, at) => at !== index))
    ])
    announce(
      t(
        index === null
          ? 'library:whiteboard.announce.straightened'
          : 'library:whiteboard.announce.pointRemoved'
      )
    )
  }

  /** Puts a new connector on the board in one commit and says what it joins. */
  const addConnector = (connector: ConnectorObject) => {
    history.commit([connector])
    // The line just drawn stays selected, so Elbow, the arrows and the rest change it.
    select(new Set([connector.id]), { announce: false })
    const after = new Map(present)
    after.set(connector.id, connector)
    announce(
      t('library:whiteboard.announce.connected', {
        name: objectName(connector, after, links, pictureTitles)
      })
    )
  }

  /** Connect to… (D14): a line from the selected object to `targetId`, in the tool's style. */
  const connectTo = (targetId: string) => {
    const fromId = connectFrom
    setConnectFrom(null)
    const from = fromId === null ? undefined : present.get(fromId)
    const target = present.get(targetId)
    if (!from || !target) return
    const centre = (object: WhiteboardObjectInput) => rectCentre(objectRect(object))
    addConnector(
      makeConnector(
        list,
        {
          id: newId(),
          z: nextZ(list),
          from: { objectId: from.id, ...centre(from) },
          to: { objectId: target.id, ...centre(target) }
        },
        connectorStyle
      )
    )
    setFocusId(from.id)
  }

  const closeConnectTo = () => {
    const fromId = connectFrom
    setConnectFrom(null)
    if (fromId !== null && present.has(fromId)) setFocusId(fromId)
  }

  /** The one selected object Connect to… would join from, or null. */
  const connectSource = single && isConnectable(single) && !readOnly ? single : null

  /** One editing session is one undo step: its first change commits, the rest amend. */
  const editText = (text: string) => {
    const session = editRef.current
    const object = session ? present.get(session.id) : undefined
    if (!session || !object) return
    const next = fitTextHeight(
      { ...object, text: text.slice(0, WHITEBOARD_LIMITS.textChars) },
      measure
    )
    history.commit(settle([next]), [], { amend: session.committed })
    session.committed = true
  }

  /** Ends editing; focus goes back to the object unless it left for somewhere else. */
  const finishEditing = (how: 'key' | 'blur' | 'pointer') => {
    const session = editRef.current
    if (!session) return
    editRef.current = null
    setEditingId(null)
    const object = present.get(session.id)
    if (
      session.isNew &&
      (object?.kind === 'text' || object?.kind === 'mindmap') &&
      object.text.trim() === ''
    ) {
      // A text or idea placed and left empty was never there: its whole step goes.
      history.revert()
      if (object.kind === 'mindmap') {
        announce(t('library:whiteboard.announce.ideaRemoved'))
        // Back to the idea it grew from, if there is one.
        const parentId = object.data.parentId
        if (parentId !== null && present.has(parentId)) {
          select(new Set([parentId]), { announce: false })
          if (how !== 'blur') setFocusId(parentId)
          return
        }
      }
      select(new Set(), { announce: false })
      if (how !== 'blur') setFocusId('#board')
      return
    }
    if (how !== 'blur') setFocusId(session.id)
  }

  // --- The style bar, Arrange, Duplicate --------------------------------

  /** Commits `changed` (and the connectors they move) and announces it; nothing when nothing changed. */
  const commitAndSay = (changed: readonly WhiteboardObjectInput[], announcement: string) => {
    const all = withConnectors(present, changed)
    if (all.length === 0) return
    history.commit(all)
    announce(announcement)
  }

  const pickStyle = (control: StyleControl, value: string) => {
    const changed = selectedObjects
      .filter((object) => control.applies(object))
      .map((object) => control.write(object, value, measure))
    history.commit(settle(changed))
    // With a drawing tool still chosen, what it draws next matches what was just changed.
    rememberToolStyle(control, value)
    announce(
      t('library:whiteboard.announce.styled', {
        control: t(control.labelKey),
        value: t(control.optionLabelKey(value))
      })
    )
  }

  const restack = (action: RestackAction) => {
    if (selected.size === 0) return
    commitAndSay(RESTACK[action].reorder(list, selected), t(RESTACK[action].announce))
  }

  const alignSelection = (edge: AlignEdge) =>
    commitAndSay(align(list, selected, edge), t('library:whiteboard.announce.aligned'))

  const distributeSelection = (axis: DistributeAxis) =>
    commitAndSay(distribute(list, selected, axis), t('library:whiteboard.announce.distributed'))

  const group = () => {
    if (selectedObjects.length < 2) return
    const groupId = newId()
    commitAndSay(
      selectedObjects.map((object) => ({ ...object, groupId })),
      t('library:whiteboard.announce.grouped', { count: selectedObjects.length })
    )
  }

  const ungroup = () =>
    commitAndSay(
      selectedObjects
        .filter((object) => object.groupId !== null)
        .map((object) => ({ ...object, groupId: null })),
      t('library:whiteboard.announce.ungrouped')
    )

  /** Puts copies on the board, selected, in one commit. */
  const addCopies = (copies: readonly WhiteboardObjectInput[], announcement: string) => {
    if (copies.length === 0) return
    history.commit(copies)
    select(new Set(copies.map((object) => object.id)), { announce: false })
    announce(announcement)
  }

  const duplicate = () => {
    if (selectedObjects.length === 0) return
    addCopies(
      copiesOf(list, selectedObjects, COPY_OFFSET, COPY_OFFSET),
      t('library:whiteboard.announce.duplicated', { count: selectedObjects.length })
    )
  }

  // --- Copy, cut and paste (D16), and pictures pasted or dropped -----------

  const { copyFromMenu, pasteCopies, expectLines, inViewMiddle, cardInView, addPictures, ...drop } =
    useWhiteboardPaste({
      readOnly,
      projectId,
      pictures,
      list,
      listRef,
      selected,
      viewBox: view.viewBox,
      toBoard: view.toBoard,
      rootRef,
      boardRef,
      announce,
      addCopies,
      removalOfSelection,
      deleteSelected,
      setFocusId
    })

  // --- Pictures (prompt 11, D11) --------------------------------------------

  const fromFile = () => {
    if (pictures) void addPictures(pictures.pickFiles(), rectCentre(view.viewBox), { focus: true })
  }

  const fromLibrary = (chosen: PictureRef[]) => {
    setLibraryOpen(false)
    void addPictures(Promise.resolve(chosen), rectCentre(view.viewBox), { focus: true })
  }

  const pictureEntries: MenuEntry[] = [
    { label: t('library:whiteboard.picture.fromFile'), onSelect: fromFile },
    { label: t('library:whiteboard.picture.fromLibrary'), onSelect: () => setLibraryOpen(true) }
  ]

  // --- Links and cards (prompt 12, D10, D27) --------------------------------

  /** Why the Link tool cannot work on the selection now, or null when it can. */
  const linkRefusal: string | null =
    selected.size > 1
      ? 'library:whiteboard.announce.linkOne'
      : single !== null && !isLinkable(single)
        ? 'library:whiteboard.announce.linkKind'
        : null

  /** The Link tool: links the one selected object, or with nothing selected places a card. */
  const openLinkTool = () => {
    if (readOnly) return
    if (linkRefusal !== null) {
      announce(t(linkRefusal))
      return
    }
    setLinking(single ? { id: single.id } : { card: true })
  }

  /** The Link dialog's answer: the object's new link (one undo step), or a new card. */
  const chooseLink = (url: string | null) => {
    const asked = linking
    setLinking(null)
    if (asked === null) return
    if ('card' in asked) {
      if (url === null) return
      const card = cardInView(url)
      addCopies([card], t('library:whiteboard.announce.pastedCard'))
      setFocusId(card.id)
      return
    }
    const object = present.get(asked.id)
    if (!object) return
    setFocusId(object.id)
    if (object.link === url) return
    history.commit([{ ...object, link: url }])
    announce(
      t(
        url === null ? 'library:whiteboard.announce.unlinked' : 'library:whiteboard.announce.linked'
      )
    )
  }

  /** Opens an object's link through the host; false when there is nothing to open. */
  const openLink = (object: WhiteboardObjectInput | null | undefined): boolean => {
    if (!onOpenLink || !object || object.link === null || !isLinkable(object)) return false
    onOpenLink(object.link)
    return true
  }

  /** True when `point` (board units) is on the link badge of `object`. */
  const onBadge = (object: WhiteboardObjectInput | null, point: Point) => {
    const badge = object ? linkBadgeRect(object) : null
    return badge !== null && pointInRect(point, badge)
  }

  const linkingObject = linking !== null && 'id' in linking ? present.get(linking.id) : undefined

  // --- Make tasks (prompt 13, D17, D27) -------------------------------------

  /** Make tasks is offered: the board can change and the host can make tasks. */
  const tasksHost =
    !readOnly && projectId !== null && whiteboardId !== undefined && flush !== undefined
      ? { projectId, whiteboardId, flush }
      : null
  const canMakeTasks = tasksHost !== null && selectedObjects.some(isTaskableObject)

  /** `K` and the style bar's button: the dialog, or why there is nothing to make. */
  const openMakeTasks = () => {
    if (tasksHost === null) return
    if (canMakeTasks) {
      // The object that had focus, or else the first one tasks are made from.
      const active = document.activeElement
      const id = active?.closest('[data-object-id]')?.getAttribute('data-object-id')
      makeTasksFrom.current = {
        objectId:
          id && selected.has(id) ? id : (selectedObjects.find(isTaskableObject)?.id ?? null),
        control: active instanceof HTMLElement && !id ? active : null
      }
      setMakingTasks(true)
      return
    }
    announce(
      t(
        selected.size === 0
          ? 'library:whiteboard.announce.tasksNothingSelected'
          : 'library:whiteboard.announce.tasksNone'
      )
    )
  }

  const closeMakeTasks = () => {
    setMakingTasks(false)
    setFocusBack(makeTasksFrom.current)
    makeTasksFrom.current = null
  }

  // Once the dialog has gone: the control, while it can still be used, or else the object.
  useEffect(() => {
    if (!focusBack) return
    setFocusBack(null)
    const { control, objectId } = focusBack
    const usable =
      control?.isConnected &&
      !control.matches(':disabled') &&
      control.getAttribute('aria-disabled') !== 'true'
    if (usable) control.focus()
    else if (objectId !== null) setFocusId(objectId)
  }, [focusBack])

  /** The tasks are made: each object links to its task, as one undo step, saved at once. */
  const linkToTasks = (made: MakeWhiteboardTasksResult['made']) => {
    if (tasksHost === null) return
    const now = new Map(listRef.current.map((object) => [object.id, object]))
    const linked: WhiteboardObjectInput[] = []
    for (const { objectId, taskId } of made) {
      const object = now.get(objectId)
      if (!object) continue
      const url = itemLinkUrl(
        { kind: 'task', projectId: tasksHost.projectId, id: taskId },
        BRAND.urlScheme
      )
      linked.push({ ...object, link: url })
    }
    if (linked.length === 0) return
    history.commit(linked)
    announce(t('library:whiteboard.announce.tasksLinked', { count: linked.length }))
    void tasksHost.flush()
  }

  // --- Drawing ----------------------------------------------------------

  const objectProps = (object: WhiteboardObjectInput): SVGProps<SVGGElement> => ({
    role: 'button',
    'aria-label': objectName(object, present, links, pictureTitles),
    'aria-pressed': selected.has(object.id),
    tabIndex: object.id === tabStop ? 0 : -1,
    className: erasing.has(object.id) ? 'wb-object wb-object--erasing' : 'wb-object',
    onFocus: () => {
      if (!selectionRef.current.has(object.id)) {
        select(expandToGroups(list, [object.id]), { announce: false })
      }
    }
  })

  // A line is outlined where it is drawn, whatever box an older or imported board stored for it.
  const selectedRects = [...selected]
    .map((id) => shownById.get(id))
    .filter((object): object is WhiteboardObjectInput => object !== undefined)
    .map((object) =>
      object.kind === 'connector'
        ? connectorBox(connectorGeometry(object, shownById).points)
        : objectRect(object)
    )
  /** Each group the selection holds whole: outlined with its tag, so grouping shows. */
  const groupOutlines = [...new Set(selectedObjects.map((object) => object.groupId))]
    .filter((groupId): groupId is string => groupId !== null)
    .flatMap((groupId) => {
      const members = shown.filter((object) => object.groupId === groupId)
      if (members.length < 2 || !members.every((object) => selected.has(object.id))) return []
      const rect = unionRect(members.map(objectRect))
      return rect ? [{ rect, count: members.length }] : []
    })
  const handleObject = single ? (shownById.get(single.id) ?? single) : null
  const handlesFor =
    handleObject &&
    handleObject.kind !== 'connector' &&
    !readOnly &&
    hasRoomForHandles(handleObject, viewport.zoom)
      ? objectRect(handleObject)
      : null
  /** A single selected connector shows a handle at each end instead (prompt 10). */
  const endsFor: [Point, Point] | null =
    handleObject?.kind === 'connector' && !readOnly
      ? (() => {
          const { start, end } = connectorGeometry(handleObject, shownById)
          return [start, end]
        })()
      : null
  /** A single selected connector's bend points, and halfway along each stretch to add one. */
  const lineControls =
    handleObject?.kind === 'connector' && !readOnly
      ? connectorControlPoints(handleObject, shownById)
      : null
  const bendsFor = lineControls ? lineControls.slice(1, -1) : []
  const splitsFor = lineControls
    ? lineControls.slice(0, -1).map((point, index) => ({
        x: (point.x + lineControls[index + 1].x) / 2,
        y: (point.y + lineControls[index + 1].y) / 2
      }))
    : []
  const percent = Math.round(viewport.zoom * 100)

  // Every object's node points, while the node tool is out or a line end is dragged (MOP-27).
  const nodeMarks = useMemo(() => {
    if (readOnly || (tool !== 'node' && !nodesShown)) return []
    return list.filter(hasNodes).flatMap((object) =>
      WHITEBOARD_NODES.map((node) => ({
        ...nodePoint(object, node, 0),
        hot: hotNode?.objectId === object.id && hotNode.node === node
      }))
    )
  }, [readOnly, tool, nodesShown, list, hotNode])
  const editingObject = editingId === null ? null : (present.get(editingId) ?? null)

  /** The stroke, shape or frame being drawn, not yet on the board; hidden from assistive technology. */
  const inkTool: InkTool = isInkTool(tool) ? tool : 'pen'
  const drawingPreview =
    inkPoints || draft ? (
      <g className="wb-editor__drawing" aria-hidden="true">
        {inkPoints && (
          <PenPart object={inkPreview(inkPoints, inks[inkTool], inkTool === 'marker')} />
        )}
        {draft?.kind === 'shape' && <ShapePart object={draft} measure={measure} />}
        {draft?.kind === 'frame' && <FramePart object={draft} measure={measure} />}
        {draft?.kind === 'connector' && (
          <ConnectorPart object={draft} context={{ measure, imageUrl, links, byId: shownById }} />
        )}
      </g>
    ) : null

  /** The colour a placing tool's next object takes, as a stand-in the style controls can read. */
  const colourToolObject = (kind: ColourTool): WhiteboardObjectInput => {
    const at = { id: `${kind}-tool`, x: 0, y: 0, z: 0 }
    const object =
      kind === 'mindmap'
        ? newMindMapRoot(at)
        : kind === 'shape'
          ? toolShape(shapeKind)
          : defaultObject(kind, at)
    return { ...object, colour: toolColours[kind] } as WhiteboardObjectInput
  }

  /** While a drawing tool is chosen and nothing is selected, the style controls set what it makes next. */
  const toolStyle: { object: WhiteboardObjectInput; only: readonly string[] } | null = readOnly
    ? null
    : isInkTool(tool)
      ? { object: inkPreview([], inks[tool], tool === 'marker'), only: ['colour', 'stroke'] }
      : tool === 'shape'
        ? { object: colourToolObject('shape'), only: ['colour', 'shape'] }
        : isLineTool(tool)
          ? { object: toolConnector(connectorStyle), only: CONNECTOR_TOOL_CONTROLS }
          : isColourTool(tool)
            ? { object: colourToolObject(tool), only: ['colour'] }
            : null

  /** What the style controls read and set: the selection first, else the chosen tool's next object. */
  const barTarget: { objects: readonly WhiteboardObjectInput[]; only?: readonly string[] } =
    readOnly
      ? { objects: [] }
      : selectedObjects.length > 0
        ? { objects: selectedObjects }
        : toolStyle
          ? { objects: [toolStyle.object], only: toolStyle.only }
          : { objects: [] }
  const onBarPick = selectedObjects.length > 0 ? pickStyle : pickToolStyle

  /** The colour dot on a drawing tool's button: what it makes next. */
  const toolDot = (id: WhiteboardToolId): { colour: WhiteboardColour; light: boolean } | null =>
    isInkTool(id)
      ? { colour: inks[id].colour, light: false }
      : isLineTool(id)
        ? { colour: connectorStyle.colour, light: false }
        : isColourTool(id)
          ? { colour: toolColours[id], light: id === 'note' }
          : null

  /** Why an action after the style controls cannot run now, or undefined when it can. */
  const groupReason = selectedObjects.length < 2 ? t('library:whiteboard.group.needTwo') : undefined
  const ungroupReason = selectedObjects.some((object) => object.groupId !== null)
    ? undefined
    : t('library:whiteboard.group.noneGrouped')
  const ideaNode = single !== null && isMindmap(single) ? single : null

  /** An idea dragged by hand goes back into its map's automatic layout. */
  const backIntoLayout = (node: MindmapObject) => {
    commitAndSay(settle([unfreeMindMapNode(node)]), t('library:whiteboard.announce.backInLayout'))
  }

  /**
   * The right-click menu (and Shift+F10 or the Menu key), built when it
   * opens: what can be done with the selection, or on empty board what can be
   * added there. `at` is where it opened, in board units; `via` the bend point
   * it opened on, if any.
   */
  const contextEntries = (at: Point, via: number | null): MenuEntry[] => {
    const zoomEntry: MenuItem = {
      label: label('zoom-fit'),
      icon: Scan,
      shortcut: keysOf('zoom-fit'),
      onSelect: zoomFit
    }
    const held = copiedWhiteboardObjects()
    const pasteEntry: MenuItem = {
      label: label('paste'),
      icon: ClipboardPaste,
      shortcut: keysOf('paste'),
      disabled: held === null,
      onSelect: () => {
        if (held) pasteCopies(held)
      }
    }
    if (readOnly) return [zoomEntry]
    const spot = snapPoint(at)
    if (selectedObjects.length === 0) {
      return [
        {
          label: t('library:whiteboard.menu.addNote'),
          icon: StickyNote,
          onSelect: () => place('note', spot)
        },
        {
          label: t('library:whiteboard.menu.addText'),
          icon: Type,
          onSelect: () => place('text', spot)
        },
        {
          label: t('library:whiteboard.menu.addMindMap'),
          icon: Network,
          onSelect: () => placeMindMap(spot)
        },
        { type: 'separator' },
        pasteEntry,
        {
          label: label('select-all'),
          shortcut: keysOf('select-all'),
          disabled: list.length === 0,
          onSelect: () => select(new Set(list.map((object) => object.id)))
        },
        { type: 'separator' },
        zoomEntry
      ]
    }
    const entries: MenuEntry[] = []
    const item = (entry: MenuItem) => entries.push(entry)
    if (single && isTextEditable(single)) {
      const id = single.id
      item({
        label: label('edit-text'),
        icon: Pencil,
        shortcut: keysOf('edit-text'),
        onSelect: () => startEditing(id, false)
      })
    }
    if (single && isMindmap(single)) {
      const node = single
      item({
        label: t('library:whiteboard.mindMap.addIdea'),
        icon: GitBranch,
        onSelect: () => addIdea(node.id, 'child')
      })
      if (node.data.parentId !== null) {
        item({
          label: t('library:whiteboard.mindMap.addSibling'),
          icon: Plus,
          onSelect: () => addIdea(node.id, 'sibling')
        })
      }
      if (node.data.free) {
        item({
          label: t('library:whiteboard.mindMap.backInLayout'),
          onSelect: () => backIntoLayout(node)
        })
      }
    }
    if (single?.kind === 'connector') {
      const line = single
      item({
        label: t('library:whiteboard.points.add'),
        icon: Spline,
        onSelect: () => addBendPoint(line, at)
      })
      if (via !== null) {
        item({
          label: t('library:whiteboard.points.remove'),
          onSelect: () => removeBendPoint(line, via)
        })
      }
      if ((line.data.via ?? []).length > 0) {
        item({
          label: t('library:whiteboard.points.straighten'),
          onSelect: () => removeBendPoint(line, null)
        })
      }
    }
    if (linkRefusal === null && single) {
      item({ label: label('link'), icon: Link2, shortcut: keysOf('link'), onSelect: openLinkTool })
    }
    if (onOpenLink && single?.link) {
      const linked = single
      item({
        label: label('open-link'),
        icon: ExternalLink,
        shortcut: keysOf('open-link'),
        onSelect: () => {
          openLink(linked)
        }
      })
    }
    if (connectSource) {
      const from = connectSource.id
      item({
        label: t('library:whiteboard.connectTo.button'),
        icon: Waypoints,
        shortcut: keysOf('connect-to'),
        onSelect: () => setConnectFrom(from)
      })
    }
    if (canMakeTasks) {
      item({
        label: t('library:whiteboard.tasks.button'),
        icon: ListChecks,
        shortcut: keysOf('make-tasks'),
        onSelect: openMakeTasks
      })
    }
    if (entries.length > 0) entries.push({ type: 'separator' })
    item({
      label: label('cut'),
      icon: Scissors,
      shortcut: keysOf('cut'),
      onSelect: () => copyFromMenu(true)
    })
    item({
      label: label('copy'),
      icon: Copy,
      shortcut: keysOf('copy'),
      onSelect: () => copyFromMenu(false)
    })
    item(pasteEntry)
    item({ label: label('duplicate'), shortcut: keysOf('duplicate'), onSelect: duplicate })
    entries.push({ type: 'separator' })
    for (const action of [
      'bring-to-front',
      'bring-forward',
      'send-backward',
      'send-to-back'
    ] as const) {
      item({ label: label(action), shortcut: keysOf(action), onSelect: () => restack(action) })
    }
    entries.push({ type: 'separator' })
    item({
      label: label('group'),
      icon: Group,
      shortcut: keysOf('group'),
      disabled: selectedObjects.length < 2,
      onSelect: group
    })
    item({
      label: label('ungroup'),
      icon: Ungroup,
      shortcut: keysOf('ungroup'),
      disabled: !selectedObjects.some((object) => object.groupId !== null),
      onSelect: ungroup
    })
    entries.push({ type: 'separator' })
    item({
      label: label('delete'),
      icon: Trash2,
      tone: 'danger',
      shortcut: keysOf('delete'),
      onSelect: () => deleteSelected()
    })
    return entries
  }

  const menuEntries = useMenuEntries(
    () => (menuAt ? contextEntries(menuAt.board, menuAt.via) : []),
    menuAt !== null
  )

  /** A right-click: the object under the pointer is selected (unless it already is), then the menu opens. */
  const onContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (editRef.current || pointer.dragging()) return
    const point = view.toBoard(clientPoint(event))
    const viaAttr =
      event.target instanceof Element
        ? event.target.closest('[data-via]')?.getAttribute('data-via')
        : null
    const onBend = viaAttr !== null && viaAttr !== undefined
    if (!onBend) {
      const hit = hitTest(list, point, HIT_TOLERANCE / viewport.zoom, whiteboardPreciseHit(present))
      if (hit && !selectionRef.current.has(hit.id)) {
        select(expandToGroups(list, [hit.id]), { announce: false })
      } else if (!hit) {
        select(new Set(), { announce: false })
      }
    }
    setMenuAt({
      x: event.clientX,
      y: event.clientY,
      board: point,
      via: onBend ? Number(viaAttr) : null
    })
  }

  /** The keyboard's right-click: at the focused object, or the middle of the view. */
  const openMenuFromKeys = (target: Element | null) => {
    const node = target?.closest('[data-object-id]')
    const rect = (node ?? boardRef.current)?.getBoundingClientRect()
    if (!rect) return
    const id = node?.getAttribute('data-object-id')
    const object = id ? present.get(id) : undefined
    setMenuAt({
      x: rect.left + Math.min(rect.width, 24),
      y: rect.top + Math.min(rect.height, 24),
      board: object ? rectCentre(objectRect(object)) : rectCentre(view.viewBox),
      via: null
    })
  }

  /** The Arrange menu, built when it opens. */
  const arrangeEntries = (): MenuEntry[] => {
    const boxes = selectedObjects.filter((object) => object.kind !== 'connector').length
    const keyed = (
      id: RestackAction | 'group' | 'ungroup',
      onSelect: () => void,
      disabled = false
    ): MenuItem => ({ label: label(id), shortcut: keysOf(id), disabled, onSelect })
    return [
      keyed('bring-to-front', () => restack('bring-to-front')),
      keyed('bring-forward', () => restack('bring-forward')),
      keyed('send-backward', () => restack('send-backward')),
      keyed('send-to-back', () => restack('send-to-back')),
      { type: 'separator' },
      ...ALIGN_ITEMS.map((item): MenuItem => ({
        label: t(item.label),
        disabled: boxes < 2,
        onSelect: () => alignSelection(item.edge)
      })),
      { type: 'separator' },
      ...DISTRIBUTE_ITEMS.map((item): MenuItem => ({
        label: t(item.label),
        disabled: boxes < 3,
        onSelect: () => distributeSelection(item.axis)
      })),
      { type: 'separator' },
      keyed('group', group, selectedObjects.length < 2),
      keyed('ungroup', ungroup, !selectedObjects.some((object) => object.groupId !== null))
    ]
  }

  // --- The keyboard and the pointer ----------------------------------------

  const { spaceHeld, onKeyDown, onKeyUp } = useWhiteboardKeys({
    tool,
    tools,
    readOnly,
    list,
    present,
    selected,
    single,
    order,
    rootRef,
    boardRef,
    hasPictures: pictures !== undefined,
    opensLinks: onOpenLink !== undefined,
    makesTasks: tasksHost !== null,
    connectSource,
    announce,
    select,
    setFocusId,
    setTool,
    chooseTool,
    step,
    duplicate,
    group,
    ungroup,
    restack,
    openMenuFromKeys,
    moveBy,
    resizeSelectedBy,
    deleteSelected: () => deleteSelected(),
    startEditing,
    placeInView,
    placeBoxInView,
    placeMindMap,
    inViewMiddle,
    addIdea,
    goAlongMap,
    openPictureMenu: () => setPictureMenuOpen(true),
    openLinkTool,
    openLink,
    openMakeTasks,
    openConnectTo: setConnectFrom,
    expectLines,
    zoomStep,
    zoomFit,
    zoomReset
  })

  const pointerHandlers = pointer.handlers({
    tool,
    readOnly,
    spaceHeld,
    list,
    present,
    single,
    selectionRef,
    links,
    pictureTitles,
    opensLinks: onOpenLink !== undefined,
    isEditing: () => editRef.current !== null,
    select,
    commit: (changed) => history.commit(changed),
    announce,
    finishEditing,
    startEditing,
    place,
    placeMindMap,
    eraserRadius,
    finishInk,
    finishErase,
    newBoxObject,
    placeBox,
    draftAt,
    endAt,
    connectDraft,
    endDraft,
    bendDraft,
    addConnector,
    removeBendPoint,
    onBadge,
    openLink
  })
  const activeTool = spaceHeld || panning ? 'hand' : tool

  return (
    <div
      ref={rootRef}
      className="wb-editor"
      // Tips wait while a board is open, so none covers its controls.
      data-tips-wait=""
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    >
      <div className="wb-editor__bar">
        <div
          className="wb-editor__bar-tools"
          role="toolbar"
          aria-label={t('library:whiteboard.viewBar')}
        >
          <IconButton
            icon={ZoomOut}
            label={label('zoom-out')}
            shortcut={keysOf('zoom-out')}
            onClick={() => zoomStep(-1)}
          />
          <Button
            variant="ghost"
            size="sm"
            className="wb-editor__zoom"
            aria-label={t('library:whiteboard.zoomLevelButton', { percent })}
            onClick={zoomReset}
          >
            {t('library:whiteboard.zoomLevel', { percent })}
          </Button>
          <IconButton
            icon={ZoomIn}
            label={label('zoom-in')}
            shortcut={keysOf('zoom-in')}
            onClick={() => zoomStep(1)}
          />
          <IconButton
            icon={Scan}
            label={label('zoom-fit')}
            shortcut={keysOf('zoom-fit')}
            onClick={zoomFit}
          />
          {!readOnly && (
            <>
              <span className="wb-editor__divider" aria-hidden="true" />
              <Menu
                label={t('library:whiteboard.arrange.menu')}
                items={arrangeEntries}
                renderTrigger={(trigger) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    iconEnd={ChevronDown}
                    disabled={selected.size === 0}
                    {...trigger}
                  >
                    {t('library:whiteboard.arrange.menu')}
                  </Button>
                )}
              />
              <span className="wb-editor__divider" aria-hidden="true" />
            </>
          )}
        </div>
        {!readOnly && (
          <PropertyBar
            objects={barTarget.objects}
            only={barTarget.only}
            onPick={onBarPick}
            colourExtra={
              recolourRoot ? (
                <Button variant="ghost" size="sm" onClick={applyColourToMap}>
                  {t('library:whiteboard.mindMap.applyToMap')}
                </Button>
              ) : undefined
            }
            actions={
              <>
                <PropertyAction
                  icon={Group}
                  label={label('group')}
                  shortcut={keysOf('group')}
                  iconOnly
                  disabledReason={groupReason}
                  onClick={group}
                />
                <PropertyAction
                  icon={Ungroup}
                  label={label('ungroup')}
                  shortcut={keysOf('ungroup')}
                  iconOnly
                  disabledReason={ungroupReason}
                  onClick={ungroup}
                />
                <PropertyAction
                  icon={Waypoints}
                  label={t('library:whiteboard.connectTo.button')}
                  shortcut={keysOf('connect-to')}
                  iconOnly
                  disabledReason={
                    connectSource ? undefined : t('library:whiteboard.connectTo.needOne')
                  }
                  onClick={() => connectSource && setConnectFrom(connectSource.id)}
                />
                <PropertyAction
                  icon={GitBranch}
                  label={t('library:whiteboard.mindMap.addIdea')}
                  shortcut={keysOf('mind-map-child')}
                  iconOnly
                  disabledReason={
                    ideaNode ? undefined : t('library:whiteboard.mindMap.addIdeaNeedsIdea')
                  }
                  onClick={() => ideaNode && addIdea(ideaNode.id, 'child')}
                />
                {tasksHost && (
                  <PropertyAction
                    icon={ListChecks}
                    label={t('library:whiteboard.tasks.button')}
                    shortcut={keysOf('make-tasks')}
                    iconOnly
                    disabledReason={
                      canMakeTasks
                        ? undefined
                        : t(
                            selected.size === 0
                              ? 'library:whiteboard.announce.tasksNothingSelected'
                              : 'library:whiteboard.announce.tasksNone'
                          )
                    }
                    onClick={openMakeTasks}
                  />
                )}
              </>
            }
          />
        )}
        {barEnd && <div className="wb-editor__bar-end">{barEnd}</div>}
      </div>

      <div
        className="wb-editor__tools"
        role="toolbar"
        aria-orientation="vertical"
        aria-label={t('library:whiteboard.tools')}
      >
        {tools.map((entry, index) => {
          const dot = toolDot(entry.id)
          return (
            <Fragment key={entry.id}>
              {index > 0 && tools[index - 1].group !== entry.group && (
                <span className="wb-editor__tool-divider" aria-hidden="true" />
              )}
              <span className="wb-editor__tool">
                <IconButton
                  icon={entry.id === 'shape' ? SHAPE_ICONS[shapeKind] : entry.icon}
                  label={label(entry.id)}
                  shortcut={keysOf(entry.id)}
                  pressed={tool === entry.id}
                  onClick={() => chooseTool(entry.id)}
                />
                {dot && (
                  <span
                    className={[
                      'wb-editor__tool-dot',
                      dot.light ? 'wb-swatch--light' : '',
                      `wb-swatch--${dot.colour}`
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-hidden="true"
                  />
                )}
              </span>
            </Fragment>
          )
        })}
        {pictures && !readOnly && (
          <>
            <span className="wb-editor__tool-divider" aria-hidden="true" />
            <IconButton
              ref={pictureButtonRef}
              icon={ImageIcon}
              label={label('picture')}
              shortcut={keysOf('picture')}
              aria-haspopup="menu"
              aria-expanded={pictureMenuOpen}
              onClick={() => setPictureMenuOpen((open) => !open)}
            />
            <MenuList
              label={label('picture')}
              entries={pictureMenuOpen ? pictureEntries : []}
              open={pictureMenuOpen}
              onClose={() => setPictureMenuOpen(false)}
              anchorRef={pictureButtonRef}
              placement="right-start"
            />
          </>
        )}
        {!readOnly && (
          <IconButton
            icon={Link2}
            label={label('link')}
            shortcut={keysOf('link')}
            disabled={linkRefusal !== null}
            onClick={openLinkTool}
          />
        )}
      </div>

      <div className="wb-editor__stage">
        <button type="button" className="wb-editor__skip" onClick={() => afterRef.current?.focus()}>
          {t('library:whiteboard.skip')}
        </button>
        <VisuallyHidden id={helpId}>
          {readOnly ? t('library:whiteboard.boardHelpReadOnly') : t('library:whiteboard.boardHelp')}
        </VisuallyHidden>
        <div
          ref={boardRef}
          role="group"
          aria-label={t('library:whiteboard.board', { title })}
          aria-describedby={helpId}
          tabIndex={list.length === 0 ? 0 : -1}
          className={[
            'wb-editor__board',
            `wb-editor__board--${activeTool}`,
            panning ? 'wb-editor__board--panning' : '',
            onBorder && !panning ? 'wb-editor__board--on-border' : '',
            readOnly ? 'wb-editor__board--read-only' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          {...pointerHandlers}
          onContextMenu={onContextMenu}
          onDragOver={drop.onDragOver}
          onDragLeave={drop.onDragLeave}
          onDrop={drop.onDrop}
        >
          <WhiteboardScene
            objects={shown}
            viewBox={view.viewBox}
            width="100%"
            height="100%"
            imageUrl={imageUrl}
            links={links}
            measure={measure}
            objectProps={objectProps}
            hiddenIds={hiddenIds}
            grid={viewport.zoom >= GRID_MIN_ZOOM}
            interactive
            overlay={
              <>
                {drawingPreview}
                <SelectionOverlay
                  selected={selectedRects}
                  box={box}
                  handlesFor={handlesFor}
                  ends={endsFor}
                  bends={bendsFor}
                  splits={splitsFor}
                  groups={groupOutlines}
                  groupTag={(count) => t('library:whiteboard.group.tag', { count })}
                  attachTo={attachRect}
                  nodes={nodeMarks}
                  zoom={viewport.zoom}
                />
              </>
            }
          />
        </div>
        {!readOnly && (
          // The board's own undo and redo float at its lower right (MOP-28).
          <div
            className="wb-editor__history"
            role="toolbar"
            aria-label={t('library:whiteboard.historyBar')}
          >
            <IconButton
              icon={Undo2}
              label={label('undo')}
              shortcut={keysOf('undo')}
              disabled={!history.canUndo}
              onClick={() => step('undo')}
            />
            <IconButton
              icon={Redo2}
              label={label('redo')}
              shortcut={keysOf('redo')}
              disabled={!history.canRedo}
              onClick={() => step('redo')}
            />
          </div>
        )}
        {drop.dropHint && (
          <p className="wb-editor__drop-hint">{t('library:whiteboard.picture.dropHint')}</p>
        )}
        {editingObject && (
          <TextEditor
            object={editingObject}
            viewport={viewport}
            labelAt={
              editingObject.kind === 'connector'
                ? connectorLabelPoint(connectorGeometry(editingObject, present).points)
                : undefined
            }
            onText={editText}
            onDone={finishEditing}
            onBranch={branchFromEditing}
          />
        )}
        <MenuList
          label={t('library:whiteboard.menu.label')}
          entries={menuEntries}
          open={menuAt !== null}
          point={menuAt}
          onClose={() => setMenuAt(null)}
          anchorRef={boardRef}
        />
        <span ref={afterRef} tabIndex={-1} className="wb-editor__after" data-skip-target="" />
      </div>
      {libraryOpen && pictures && (
        <PictureLibraryDialog
          load={pictures.listLibraryPictures}
          onInsert={fromLibrary}
          onClose={() => setLibraryOpen(false)}
        />
      )}
      {linking !== null && ('card' in linking || linkingObject) && (
        <LinkDialog
          mode={'card' in linking ? 'card' : 'link'}
          itemsOnly={linkingObject?.kind === 'card'}
          projectId={projectId}
          objectName={
            linkingObject ? objectName(linkingObject, present, links, pictureTitles) : undefined
          }
          canRemove={linkingObject !== undefined && linkingObject.link !== null}
          onChoose={chooseLink}
          onClose={() => setLinking(null)}
        />
      )}
      {makingTasks && tasksHost && (
        <MakeWhiteboardTasksDialog
          projectId={tasksHost.projectId}
          whiteboardId={tasksHost.whiteboardId}
          objects={selectedObjects}
          milestones={milestones}
          flush={tasksHost.flush}
          onMade={linkToTasks}
          onClose={closeMakeTasks}
        />
      )}
      {connectFrom !== null && present.has(connectFrom) && (
        <ConnectToDialog
          fromName={objectName(
            present.get(connectFrom) as WhiteboardObjectInput,
            present,
            links,
            pictureTitles
          )}
          candidates={order
            .filter((object) => object.id !== connectFrom && isConnectable(object))
            .map((object) => ({
              id: object.id,
              name: objectName(object, present, links, pictureTitles)
            }))}
          onConnect={connectTo}
          onClose={closeConnectTo}
        />
      )}
    </div>
  )
}
