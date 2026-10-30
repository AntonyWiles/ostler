import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { t } from '@shared/i18n'
import {
  FRAME_TITLE_BAND,
  boardToScreen,
  type Point,
  type Viewport
} from '@shared/whiteboard/geometry'
import { TEXT_SIZE_UNITS, type WhiteboardObjectInput } from '@shared/whiteboard/model'
import { LINE_HEIGHT_RATIO, NOTE_PADDING, SHAPE_PADDING } from '@shared/whiteboard/text-layout'
import { paintValue, textPaint } from './paint'

/** The kinds whose words are edited in place. */
const EDITABLE_KINDS = new Set(['note', 'text', 'shape', 'frame', 'mindmap', 'connector'])

/** A connector's label box, board units: this wide, centred on the label point (prompt 10). */
const LABEL_BOX_WIDTH = 200
const LABEL_BOX_PADDING = 4

/** True when the object's words can be edited in a text box over the board. */
export function isTextEditable(object: WhiteboardObjectInput): boolean {
  return EDITABLE_KINDS.has(object.kind)
}

/** Font size and inner padding in board units, as the scene draws the object's words. */
function textMetrics(object: WhiteboardObjectInput): { fontSize: number; padding: number } {
  switch (object.kind) {
    case 'note':
      return { fontSize: TEXT_SIZE_UNITS[object.data.textSize], padding: NOTE_PADDING }
    case 'shape':
    case 'mindmap':
      return { fontSize: TEXT_SIZE_UNITS[object.data.textSize], padding: SHAPE_PADDING }
    case 'text':
      return { fontSize: TEXT_SIZE_UNITS[object.data.textSize], padding: 0 }
    case 'connector':
      return { fontSize: TEXT_SIZE_UNITS.small, padding: LABEL_BOX_PADDING }
    default:
      return { fontSize: TEXT_SIZE_UNITS.small, padding: 8 }
  }
}

export interface TextEditorProps {
  object: WhiteboardObjectInput
  viewport: Viewport
  /** A connector's label point (`connectorLabelPoint`): its box is centred there. */
  labelAt?: Point
  onText(text: string): void
  /** Escape, Ctrl+Enter or leaving the box. */
  onDone(how: 'key' | 'blur'): void
  /**
   * A mind-map node's keys (prompt 14, D18): Tab adds a child, Enter the next
   * idea; Shift+Enter stays a new line. Without it, Enter is a new line.
   */
  onBranch?(how: 'child' | 'sibling'): void
}

/**
 * The text box laid over an object while its words are edited (plan
 * `docs/plans/whiteboards/`, prompt 06): exactly over the object in screen
 * coordinates, its font and padding scaled by the zoom. A frame's box covers
 * its title band; a connector's label box is centred on `labelAt` (prompt 10).
 * It takes the object's own fill and text colours (`textPaint`), the board's
 * paper where the object has no fill, in every theme.
 * Enter is a new line; Escape and Ctrl+Enter finish. In a mind-map node
 * Enter and Tab add the next node instead (`onBranch`).
 */
export function TextEditor({
  object,
  viewport,
  labelAt,
  onText,
  onDone,
  onBranch
}: TextEditorProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const done = useRef(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  }, [object.id])

  const { zoom } = viewport
  const { fontSize, padding } = textMetrics(object)
  const label = object.kind === 'connector'
  const lines = Math.max(1, object.text.split('\n').length)
  const width = label ? LABEL_BOX_WIDTH : object.width
  const height = label
    ? lines * fontSize * LINE_HEIGHT_RATIO + 2 * padding
    : object.kind === 'frame'
      ? FRAME_TITLE_BAND
      : object.height
  const centre = labelAt ?? { x: object.x + object.width / 2, y: object.y + object.height / 2 }
  const at = boardToScreen(
    viewport,
    label ? { x: centre.x - width / 2, y: centre.y - height / 2 } : { x: object.x, y: object.y }
  )
  // The object is hidden while its words are edited: the box is drawn in its colours.
  const paint = textPaint(object)
  const style: CSSProperties = {
    background: paintValue(paint.fill ?? 'paper'),
    color: paintValue(paint.text),
    left: at.x,
    top: at.y,
    width: width * zoom,
    height: height * zoom,
    padding: padding * zoom,
    fontSize: fontSize * zoom,
    lineHeight: LINE_HEIGHT_RATIO,
    textAlign:
      object.kind === 'text'
        ? object.data.align === 'middle'
          ? 'center'
          : object.data.align === 'end'
            ? 'right'
            : 'left'
        : object.kind === 'shape' || object.kind === 'mindmap' || label
          ? 'center'
          : 'left'
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const plain = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
    // A key that ends an input method's composition is the input method's, not ours.
    if (object.kind === 'mindmap' && onBranch && plain && !event.nativeEvent.isComposing) {
      if (event.key === 'Tab' || event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        onBranch(event.key === 'Tab' ? 'child' : 'sibling')
        return
      }
    }
    const finish =
      event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))
    if (!finish) return
    event.preventDefault()
    event.stopPropagation()
    done.current = true
    onDone('key')
  }

  return (
    <textarea
      ref={ref}
      className={`wb-text-editor wb-text-editor--${object.kind}`}
      style={style}
      aria-label={t(`library:whiteboard.textBox.${object.kind}`)}
      value={object.text}
      spellCheck
      onChange={(event) => onText(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        if (!done.current) onDone('blur')
      }}
    />
  )
}
