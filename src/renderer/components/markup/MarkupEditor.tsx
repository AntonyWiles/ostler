import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react'
import {
  amend,
  commit,
  markBounds,
  markEnd,
  markName,
  MARK_COLOURS,
  MARK_SIZES,
  MIN_BLUR_SIZE,
  MIN_MARK_SIZE,
  moveMark,
  pixelScale,
  rectBetween,
  redo,
  resizeMark,
  startHistory,
  undo,
  type Mark,
  type MarkColour,
  type MarkGeometry,
  type MarkKind,
  type MarkSize,
  type MarkTool,
  type PictureBytes,
  type PictureSize
} from '@shared/markup'
import { MARKUP_SHORTCUTS, markupShortcutLabelKey } from '@shared/shortcuts'
import {
  Button,
  Dialog,
  IconButton,
  InlineAlert,
  SegmentedControl,
  Select,
  Spinner,
  TextField,
  useConfirm
} from '../../ui'
import {
  Grid3x3,
  Highlighter,
  MousePointer2,
  MoveUpRight,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  type LucideIcon
} from '../../ui/icons'
import { isTypingTarget } from '../../utils/dom'
import { annotationColours, appFontFamily, drawMarkup, flattenToPng, loadPicture } from './draw'
import { MarkupPlacementForm } from './MarkupPlacementForm'
import './MarkupEditor.css'
import { t } from '@shared/i18n'

const TOOL_ICONS: Record<MarkTool, LucideIcon> = {
  select: MousePointer2,
  arrow: MoveUpRight,
  box: Square,
  highlight: Highlighter,
  text: Type,
  blur: Grid3x3
}
const TOOLS = Object.keys(TOOL_ICONS) as MarkTool[]

const keysOf = (id: string) => MARKUP_SHORTCUTS.find((entry) => entry.id === id)?.keys ?? ''

/** The tool a bare key picks, from the shortcut table. */
function toolForKey(key: string): MarkTool | null {
  const lower = key.toLowerCase()
  return TOOLS.find((tool) => keysOf(tool).toLowerCase() === lower) ?? null
}

export interface MarkupEditorProps {
  open: boolean
  title: string
  /** The primary button: "Use this picture", "Save copy". */
  saveLabel: string
  /** The picture to mark up, at its own pixels. */
  load: () => Promise<PictureBytes>
  /** The flattened PNG. Resolves with an error to show, or null when it was used. */
  onSave: (png: Uint8Array) => Promise<string | null>
  /** Cancel: nothing is kept. */
  onClose: () => void
}

/**
 * Mark up a picture (N4.2b, N32): arrows, boxes, highlights, text and blur
 * on one canvas at the picture's own pixels. Marks stay editable until the
 * picture is saved; saving flattens them into a new PNG (`flattenToPng`),
 * and a blur is pixelated into its pixels. Every tool has a button and a
 * key, every mark is a focusable element with a name, and a mark can be
 * added by typing its position.
 */
export function MarkupEditor(props: MarkupEditorProps) {
  if (!props.open) return null
  return <MarkupEditorDialog {...props} />
}

interface Loaded {
  image: HTMLImageElement
  size: PictureSize
}

type Drag =
  | { kind: 'draw'; tool: MarkKind; start: { x: number; y: number } }
  | { kind: 'move'; id: string; last: { x: number; y: number }; moved: boolean }
  | { kind: 'resize'; id: string; moved: boolean }

function MarkupEditorDialog({ title, saveLabel, load, onSave, onClose }: MarkupEditorProps) {
  const confirm = useConfirm()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [history, setHistory] = useState(startHistory)
  const [tool, setTool] = useState<MarkTool>('arrow')
  const [colour, setColour] = useState<MarkColour>('red')
  const [size, setSize] = useState<MarkSize>('medium')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Mark | null>(null)
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const textFieldRef = useRef<HTMLInputElement | null>(null)
  const nextId = useRef(1)
  const dragRef = useRef<Drag | null>(null)
  /** The text mark whose typing is already one undo step. */
  const textStep = useRef<string | null>(null)
  const [focusText, setFocusText] = useState(false)
  const [focusMark, setFocusMark] = useState<string | null>(null)

  const scale = pixelScale(window.devicePixelRatio)
  const marks = history.present
  const selected = marks.find((mark) => mark.id === selectedId) ?? null
  const options = useMemo(
    () => ({ scale, colours: annotationColours(), fontFamily: appFontFamily() }),
    [scale]
  )

  useEffect(() => {
    let release: (() => void) | null = null
    let cancelled = false
    load()
      .then((picture) => loadPicture(picture.bytes, picture.mimeType))
      .then((opened) => {
        if (cancelled) return opened.release()
        release = opened.release
        const { naturalWidth: width, naturalHeight: height } = opened.image
        setLoaded({ image: opened.image, size: { width, height } })
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setLoadError(
            t('library:markup.couldntOpen', {
              error: reason instanceof Error ? reason.message : String(reason)
            })
          )
      })
    return () => {
      cancelled = true
      release?.()
    }
  }, [])

  // What the person sees is drawn by the same function the PNG is saved with.
  useEffect(() => {
    const context = loaded ? canvasRef.current?.getContext('2d') : null
    if (!loaded || !context) return
    drawMarkup(context, loaded.image, loaded.size, draft ? [...marks, draft] : marks, options)
  }, [loaded, marks, draft, options])

  useEffect(() => {
    textStep.current = null
  }, [selectedId])

  useEffect(() => {
    if (focusText) {
      textFieldRef.current?.focus()
      textFieldRef.current?.select()
      setFocusText(false)
    }
  }, [focusText])

  useEffect(() => {
    if (!focusMark) return
    svgRef.current?.querySelector<SVGElement>(`[data-mark-id="${focusMark}"]`)?.focus()
    setFocusMark(null)
  }, [focusMark])

  const newMark = (geometry: MarkGeometry): Mark =>
    ({ ...geometry, id: `mark-${nextId.current++}`, colour, size }) as Mark

  const addMark = (mark: Mark) => {
    setHistory((current) => commit(current, [...current.present, mark]))
    setSelectedId(mark.id)
  }

  const changeMark = (id: string, change: (mark: Mark) => Mark, step: 'commit' | 'amend') => {
    setHistory((current) =>
      (step === 'commit' ? commit : amend)(
        current,
        current.present.map((mark) => (mark.id === id ? change(mark) : mark))
      )
    )
  }

  const removeSelected = () => {
    if (!selected) return
    const index = marks.indexOf(selected)
    const rest = marks.filter((mark) => mark.id !== selected.id)
    setHistory((current) => commit(current, rest))
    const next = rest[Math.min(index, rest.length - 1)] ?? null
    setSelectedId(next?.id ?? null)
    if (next) setFocusMark(next.id)
    else stageRef.current?.focus()
  }

  const step = (direction: 'undo' | 'redo') => {
    setHistory((current) => (direction === 'undo' ? undo(current) : redo(current)))
    textStep.current = null
  }

  // --- The mouse --------------------------------------------------------

  const toPoint = (event: { clientX: number; clientY: number }) => {
    const svg = svgRef.current
    if (!svg || !loaded) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const sx = rect.width > 0 ? loaded.size.width / rect.width : 1
    const sy = rect.height > 0 ? loaded.size.height / rect.height : 1
    return {
      x: Math.round(Math.min(Math.max((event.clientX - rect.left) * sx, 0), loaded.size.width)),
      y: Math.round(Math.min(Math.max((event.clientY - rect.top) * sy, 0), loaded.size.height))
    }
  }

  const drafted = (drag: Extract<Drag, { kind: 'draw' }>, end: { x: number; y: number }) => {
    const geometry =
      drag.tool === 'arrow'
        ? { kind: 'arrow' as const, x1: drag.start.x, y1: drag.start.y, x2: end.x, y2: end.y }
        : { kind: drag.tool, ...rectBetween(drag.start.x, drag.start.y, end.x, end.y) }
    return { ...geometry, id: 'draft', colour, size } as Mark
  }

  const beginDrag = (drag: Drag) => {
    dragRef.current = drag
    const onMove = (event: MouseEvent) => {
      const current = dragRef.current
      if (!current || !loaded) return
      const point = toPoint(event)
      if (current.kind === 'draw') setDraft(drafted(current, point))
      else if (current.kind === 'move') {
        const dx = point.x - current.last.x
        const dy = point.y - current.last.y
        if (dx === 0 && dy === 0) return
        const first = !current.moved
        current.moved = true
        current.last = point
        changeMark(
          current.id,
          (mark) => moveMark(mark, dx, dy, loaded.size, scale),
          first ? 'commit' : 'amend'
        )
      } else {
        const first = !current.moved
        current.moved = true
        changeMark(
          current.id,
          (mark) => resizeMark(mark, point.x, point.y, loaded.size),
          first ? 'commit' : 'amend'
        )
      }
    }
    const onUp = (event: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const current = dragRef.current
      dragRef.current = null
      setDraft(null)
      if (current?.kind !== 'draw') return
      const mark = drafted(current, toPoint(event))
      const bounds = markBounds(mark, scale)
      const big =
        mark.kind === 'arrow'
          ? Math.hypot(bounds.width, bounds.height) >= MIN_MARK_SIZE
          : mark.kind === 'blur'
            ? bounds.width >= MIN_BLUR_SIZE && bounds.height >= MIN_BLUR_SIZE
            : bounds.width >= MIN_MARK_SIZE && bounds.height >= MIN_MARK_SIZE
      if (big) addMark({ ...mark, id: `mark-${nextId.current++}` })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const onStageMouseDown = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !loaded || busy) return
    event.preventDefault()
    const point = toPoint(event)
    if (tool === 'select') {
      setSelectedId(null)
      return
    }
    if (tool === 'text') {
      addMark(
        newMark({ kind: 'text', x: point.x, y: point.y, text: t('library:markup.defaultText') })
      )
      setFocusText(true)
      return
    }
    beginDrag({ kind: 'draw', tool, start: point })
  }

  // With any tool a mark moves when pressed on: with Select anywhere on it, with a drawing tool on
  // its border (MOP-34), the only part of it that takes the pointer then (MarkupEditor.css).
  const onMarkMouseDown = (event: ReactMouseEvent<SVGElement>, mark: Mark) => {
    if (event.button !== 0 || busy) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedId(mark.id)
    beginDrag({ kind: 'move', id: mark.id, last: toPoint(event), moved: false })
  }

  const onHandleMouseDown = (event: ReactMouseEvent<SVGElement>, mark: Mark) => {
    if (event.button !== 0 || busy) return
    event.preventDefault()
    event.stopPropagation()
    beginDrag({ kind: 'resize', id: mark.id, moved: false })
  }

  // --- The keyboard -----------------------------------------------------

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (busy || !loaded || isTypingTarget(event.target)) return
    const ctrl = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (ctrl && !event.altKey && key === 'z') {
      event.preventDefault()
      step(event.shiftKey ? 'redo' : 'undo')
      return
    }
    if (ctrl && !event.altKey && key === 'y') {
      event.preventDefault()
      step('redo')
      return
    }
    if (ctrl || event.altKey ? false : toolForKey(event.key)) {
      event.preventDefault()
      setTool(toolForKey(event.key)!)
      return
    }
    // Moving and deleting act on the mark that has focus.
    const target = event.target instanceof Element ? event.target : null
    const markId = target?.getAttribute('data-mark-id')
    const mark = markId ? marks.find((entry) => entry.id === markId) : null
    if (!mark) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      removeSelected()
      return
    }
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    }
    const direction = arrows[event.key]
    if (!direction || ctrl) return
    event.preventDefault()
    const distance = (event.shiftKey ? 10 : 1) * Math.ceil(scale)
    const [dx, dy] = [direction[0] * distance, direction[1] * distance]
    if (event.altKey) {
      const end = markEnd(mark, scale)
      changeMark(
        mark.id,
        (current) => resizeMark(current, end.x + dx, end.y + dy, loaded.size),
        'commit'
      )
    } else {
      changeMark(mark.id, (current) => moveMark(current, dx, dy, loaded.size, scale), 'commit')
    }
  }

  // --- Colour, width, text ----------------------------------------------

  const pickColour = (next: MarkColour) => {
    setColour(next)
    if (selected && selected.colour !== next)
      changeMark(selected.id, (mark) => ({ ...mark, colour: next }), 'commit')
  }
  const pickSize = (next: MarkSize) => {
    setSize(next)
    if (selected && selected.size !== next)
      changeMark(selected.id, (mark) => ({ ...mark, size: next }), 'commit')
  }
  const editText = (text: string) => {
    if (!selected || selected.kind !== 'text') return
    const first = textStep.current !== selected.id
    textStep.current = selected.id
    changeMark(selected.id, (mark) => ({ ...mark, text }) as Mark, first ? 'commit' : 'amend')
  }

  // --- Save and cancel --------------------------------------------------

  const save = async () => {
    if (!loaded || busy) return
    setBusy(true)
    setError(null)
    try {
      const kept = marks.filter((mark) => mark.kind !== 'text' || mark.text.trim() !== '')
      const png = await flattenToPng(loaded.image, loaded.size, kept, options)
      const failed = await onSave(png)
      if (failed) setError(failed)
    } catch (reason) {
      setError(
        t('library:markup.couldntSave', {
          error: reason instanceof Error ? reason.message : String(reason)
        })
      )
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (busy) return
    if (history.past.length > 0) {
      const ok = await confirm({
        title: t('library:markup.discardTitle'),
        body: t('library:markup.discardBody'),
        confirmLabel: t('library:markup.discard'),
        tone: 'danger'
      })
      if (!ok) return
    }
    onClose()
  }

  const picture = loaded?.size
  const handleRadius = picture
    ? Math.max(6, Math.round(Math.max(picture.width, picture.height) / 120))
    : 6
  const hitWidth = Math.max(12, Math.round(12 * scale))

  return (
    <Dialog
      open
      onClose={() => void cancel()}
      title={title}
      description={t('library:markup.description')}
      size="full"
      closeOnBackdrop={false}
      canDismiss={!busy}
      className="markup-editor"
      footer={
        <>
          <Button onClick={() => void cancel()} disabled={busy}>
            {t('library:markup.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            loading={busy}
            disabled={!loaded || busy}
          >
            {saveLabel}
          </Button>
        </>
      }
    >
      {loadError ? (
        <InlineAlert tone="danger">{loadError}</InlineAlert>
      ) : !loaded || !picture ? (
        <div className="markup-editor__loading">
          <Spinner size="sm" /> {t('library:markup.opening')}
        </div>
      ) : (
        <div className="markup-editor__layout" onKeyDown={onKeyDown}>
          <div
            className="markup-editor__toolbar"
            role="toolbar"
            aria-label={t('library:markup.tools')}
          >
            <div className="markup-editor__group">
              {TOOLS.map((id) => (
                <IconButton
                  key={id}
                  icon={TOOL_ICONS[id]}
                  label={t(markupShortcutLabelKey(id))}
                  shortcut={keysOf(id)}
                  pressed={tool === id}
                  onClick={() => setTool(id)}
                />
              ))}
            </div>
            <div
              className="markup-editor__group"
              role="group"
              aria-label={t('library:markup.colour')}
            >
              {MARK_COLOURS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`markup-editor__swatch markup-editor__swatch--${id}`}
                  aria-label={t(`library:markup.colours.${id}`)}
                  title={t(`library:markup.colours.${id}`)}
                  aria-pressed={colour === id}
                  onClick={() => pickColour(id)}
                />
              ))}
            </div>
            <Select
              label={t('library:markup.lineWidth')}
              hideLabel
              size="sm"
              className="markup-editor__size"
              value={size}
              onChange={(event) => pickSize(event.target.value as MarkSize)}
              options={MARK_SIZES.map((id) => ({
                value: id,
                label: t(`library:markup.sizes.${id}`)
              }))}
            />
            <div className="markup-editor__group">
              <IconButton
                icon={Undo2}
                label={t('library:markup.undo')}
                shortcut={keysOf('undo')}
                disabled={history.past.length === 0}
                onClick={() => step('undo')}
              />
              <IconButton
                icon={Redo2}
                label={t('library:markup.redo')}
                shortcut={keysOf('redo')}
                disabled={history.future.length === 0}
                onClick={() => step('redo')}
              />
              <IconButton
                icon={Trash2}
                label={t('library:markup.deleteMark')}
                shortcut={keysOf('delete')}
                disabled={!selected}
                onClick={removeSelected}
              />
            </div>
            <SegmentedControl
              label={t('library:markup.zoom')}
              size="sm"
              value={zoom}
              onChange={setZoom}
              options={[
                { value: 'fit', label: t('library:markup.zoomFit') },
                { value: 'actual', label: t('library:markup.zoomActual') }
              ]}
            />
          </div>

          <div className="markup-editor__main">
            <div
              ref={stageRef}
              className={`markup-editor__stage markup-editor__stage--${zoom}`}
              tabIndex={-1}
            >
              <div
                className="markup-editor__frame"
                style={
                  zoom === 'actual'
                    ? { width: picture.width / scale, height: picture.height / scale }
                    : undefined
                }
              >
                <canvas
                  ref={canvasRef}
                  className="markup-editor__canvas"
                  width={picture.width}
                  height={picture.height}
                  aria-hidden="true"
                />
                <svg
                  ref={svgRef}
                  className={`markup-editor__marks markup-editor__marks--${tool}`}
                  viewBox={`0 0 ${picture.width} ${picture.height}`}
                  preserveAspectRatio="none"
                  role="group"
                  aria-label={t('library:markup.stage', {
                    width: picture.width,
                    height: picture.height
                  })}
                  onMouseDown={onStageMouseDown}
                >
                  {marks.map((mark) => {
                    const name = markName(mark, picture, scale)
                    const common = {
                      'data-mark-id': mark.id,
                      tabIndex: 0,
                      role: 'button',
                      'aria-label': name,
                      'aria-pressed': mark.id === selectedId,
                      className: 'markup-editor__mark',
                      onFocus: () => setSelectedId(mark.id),
                      onMouseDown: (event: ReactMouseEvent<SVGElement>) =>
                        onMarkMouseDown(event, mark)
                    }
                    if (mark.kind === 'arrow')
                      return (
                        <line
                          key={mark.id}
                          {...common}
                          x1={mark.x1}
                          y1={mark.y1}
                          x2={mark.x2}
                          y2={mark.y2}
                          strokeWidth={hitWidth}
                        />
                      )
                    const bounds = markBounds(mark, scale)
                    return <rect key={mark.id} {...common} {...bounds} strokeWidth={hitWidth} />
                  })}
                  {selected && (
                    <>
                      <rect
                        className="markup-editor__selection"
                        {...markBounds(selected, scale)}
                        aria-hidden="true"
                      />
                      {selected.kind !== 'text' && (
                        <circle
                          className="markup-editor__handle"
                          {...(() => {
                            const end = markEnd(selected, scale)
                            return { cx: end.x, cy: end.y }
                          })()}
                          r={handleRadius}
                          aria-hidden="true"
                          onMouseDown={(event) => onHandleMouseDown(event, selected)}
                        />
                      )}
                    </>
                  )}
                </svg>
              </div>
            </div>

            <div className="markup-editor__side">
              {selected?.kind === 'text' && (
                <TextField
                  ref={textFieldRef}
                  label={t('library:markup.markText')}
                  value={selected.text}
                  onChange={(event) => editText(event.target.value)}
                />
              )}
              <p className="markup-editor__count" aria-live="polite">
                {marks.length === 0
                  ? t('library:markup.noMarks')
                  : t('library:markup.markCount', { count: marks.length })}
              </p>
              <MarkupPlacementForm
                picture={picture}
                onAdd={(geometry) => {
                  const mark = newMark(geometry)
                  addMark(mark)
                  setFocusMark(mark.id)
                }}
              />
            </div>
          </div>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
      )}
    </Dialog>
  )
}
