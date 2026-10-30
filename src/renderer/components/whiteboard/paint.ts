import type { WhiteboardObjectInput } from '@shared/whiteboard/model'

/**
 * A `--whiteboard-*` token by its name after the prefix: `paper`, `ink`, a
 * colour (`yellow`), its light fill (`yellow-light`) or the text on its solid
 * fill (`on-yellow`). Every colour on the board is one of these (D9).
 */
export type WhiteboardPaint = string

/** The colours an object's words are drawn with: what is under them, and the text. */
export interface TextPaint {
  /** The fill behind the words; null where the paper shows through. */
  fill: WhiteboardPaint | null
  text: WhiteboardPaint
}

/**
 * The one rule for the colours of an object's words. The scene draws them
 * with it (scene-parts.tsx) and the text box that edits them takes the same
 * colours (TextEditor.tsx), so editing looks like the object in every theme.
 */
export function textPaint(object: WhiteboardObjectInput): TextPaint {
  switch (object.kind) {
    case 'note':
      return { fill: `${object.colour}-light`, text: 'ink' }
    case 'mindmap':
      // The central idea is solid in its colour; every other idea is light.
      if (object.data.parentId === null) return { fill: object.colour, text: `on-${object.colour}` }
      return { fill: `${object.colour}-light`, text: 'ink' }
    case 'shape':
      if (object.data.fill === 'solid') return { fill: object.colour, text: `on-${object.colour}` }
      return { fill: object.data.fill === 'light' ? `${object.colour}-light` : null, text: 'ink' }
    case 'text':
    case 'frame':
      return { fill: null, text: object.colour }
    case 'connector':
      return { fill: 'paper', text: 'ink' }
    default:
      return { fill: null, text: 'ink' }
  }
}

/** The WhiteboardScene.css class that fills an SVG shape with `paint`. */
export function fillClass(paint: WhiteboardPaint): string {
  if (paint === 'paper') return 'wb-paper'
  if (paint.endsWith('-light')) return `wb-fill-light-${paint.slice(0, -'-light'.length)}`
  return `wb-fill-${paint}`
}

/** The WhiteboardScene.css class that draws SVG text in `paint`. */
export function textClass(paint: WhiteboardPaint): string {
  return paint === 'ink' ? 'wb-ink' : `wb-text-${paint}`
}

/** `paint` as a CSS value, for HTML laid over the board. */
export function paintValue(paint: WhiteboardPaint): string {
  return `var(--whiteboard-${paint})`
}
