import { t } from '@shared/i18n'

/**
 * Mark up a picture (N4.2b, N32): the marks a person draws on a snip or on a
 * copy of a Library image, and the pure rules behind the editor. Every
 * coordinate is in the picture's own pixels, never the screen's, so a 4K
 * snip taken on a 150% display is marked up and saved at its full size.
 * Drawing them is `src/renderer/components/markup/draw.ts`; this file has
 * no canvas, so it is testable as it is.
 */

export const MARK_TOOLS = ['select', 'arrow', 'box', 'highlight', 'text', 'blur'] as const
export type MarkTool = (typeof MARK_TOOLS)[number]
export type MarkKind = Exclude<MarkTool, 'select'>
export const MARK_KINDS: readonly MarkKind[] = ['arrow', 'box', 'highlight', 'text', 'blur']

/** Each is a token, `--annotation-<colour>` in tokens.css, with its own high-contrast value. */
export const MARK_COLOURS = ['red', 'yellow', 'blue', 'green', 'black'] as const
export type MarkColour = (typeof MARK_COLOURS)[number]

export const MARK_SIZES = ['thin', 'medium', 'thick'] as const
export type MarkSize = (typeof MARK_SIZES)[number]

interface MarkBase {
  id: string
  colour: MarkColour
  size: MarkSize
}

export interface ArrowMark extends MarkBase {
  kind: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface AreaMark extends MarkBase {
  kind: 'box' | 'highlight' | 'blur'
  x: number
  y: number
  width: number
  height: number
}

export interface TextMark extends MarkBase {
  kind: 'text'
  /** The top left of the text. */
  x: number
  y: number
  text: string
}

export type Mark = ArrowMark | AreaMark | TextMark

/** A mark's shape and place, before it has an id, a colour and a size. */
export type MarkGeometry = Mark extends infer M
  ? M extends Mark
    ? Omit<M, 'id' | 'colour' | 'size'>
    : never
  : never

export interface PictureSize {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The smallest drag that makes a mark; anything less is a click. */
export const MIN_MARK_SIZE = 4

/**
 * The picture's pixels per screen pixel the marks are sized for: the
 * display's scale for a snip (a 150% display gives 1.5), so a line or a
 * letter reads at the same size as the app's at 100%.
 */
export function pixelScale(devicePixelRatio: number): number {
  return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
}

const STROKE: Record<MarkSize, number> = { thin: 2, medium: 4, thick: 8 }
const TEXT_FACTOR: Record<MarkSize, number> = { thin: 1, medium: 1.5, thick: 2 }

/** A line's width in the picture's pixels. */
export function strokeWidth(size: MarkSize, scale: number): number {
  return Math.max(1, Math.round(STROKE[size] * scale))
}

/** A text mark's font size in the picture's pixels: the app's body size, scaled. */
export function textSize(size: MarkSize, scale: number, bodyPx = 14): number {
  return Math.max(8, Math.round(bodyPx * TEXT_FACTOR[size] * scale))
}

/**
 * The side of a blur block, in the picture's pixels: larger than a line of
 * the app's text at the picture's scale, so no letter survives inside one.
 */
export function blurBlockSize(scale: number): number {
  return Math.max(16, Math.round(20 * scale))
}

/** A blur smaller than this is refused: a block of one pixel would be the pixel itself. */
export const MIN_BLUR_SIZE = 8

/** A text mark's box, estimated from its length (the editor has no font metrics). */
export function textBounds(mark: TextMark, scale: number): Rect {
  const px = textSize(mark.size, scale)
  const longest = Math.max(1, ...mark.text.split('\n').map((line) => line.length))
  const lines = Math.max(1, mark.text.split('\n').length)
  return {
    x: mark.x,
    y: mark.y,
    width: Math.round(longest * px * 0.6),
    height: Math.round(lines * px * 1.25)
  }
}

/** The rectangle a mark covers, for selecting and naming it. */
export function markBounds(mark: Mark, scale: number): Rect {
  switch (mark.kind) {
    case 'arrow':
      return rectBetween(mark.x1, mark.y1, mark.x2, mark.y2)
    case 'text':
      return textBounds(mark, scale)
    default:
      return { x: mark.x, y: mark.y, width: mark.width, height: mark.height }
  }
}

/** The rectangle two corners span, in either order. */
export function rectBetween(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  }
}

/** A rectangle cut at the picture's edges, in whole pixels; null when nothing is left. */
export function clampRect(rect: Rect, picture: PictureSize): Rect | null {
  const x0 = Math.max(0, Math.round(rect.x))
  const y0 = Math.max(0, Math.round(rect.y))
  const x1 = Math.min(picture.width, Math.round(rect.x + rect.width))
  const y1 = Math.min(picture.height, Math.round(rect.y + rect.height))
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

/** A mark moved by dx, dy, kept on the picture. */
export function moveMark(
  mark: Mark,
  dx: number,
  dy: number,
  picture: PictureSize,
  scale: number
): Mark {
  const bounds = markBounds(mark, scale)
  const moveX = clamp(bounds.x + dx, 0, picture.width - bounds.width) - bounds.x
  const moveY = clamp(bounds.y + dy, 0, picture.height - bounds.height) - bounds.y
  if (mark.kind === 'arrow')
    return {
      ...mark,
      x1: mark.x1 + moveX,
      y1: mark.y1 + moveY,
      x2: mark.x2 + moveX,
      y2: mark.y2 + moveY
    }
  return { ...mark, x: mark.x + moveX, y: mark.y + moveY }
}

/**
 * A mark with its end (an arrow's head, an area's bottom right corner) at a
 * new point on the picture. A text mark's size follows its words instead.
 */
export function resizeMark(mark: Mark, x: number, y: number, picture: PictureSize): Mark {
  const px = clamp(Math.round(x), 0, picture.width)
  const py = clamp(Math.round(y), 0, picture.height)
  if (mark.kind === 'arrow') return { ...mark, x2: px, y2: py }
  if (mark.kind === 'text') return mark
  return { ...mark, width: Math.max(1, px - mark.x), height: Math.max(1, py - mark.y) }
}

/** A mark's end point, where its resize handle sits. */
export function markEnd(mark: Mark, scale: number): { x: number; y: number } {
  if (mark.kind === 'arrow') return { x: mark.x2, y: mark.y2 }
  const bounds = markBounds(mark, scale)
  return { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
}

// --- Names --------------------------------------------------------------

const PLACES = [
  ['topLeft', 'top', 'topRight'],
  ['left', 'centre', 'right'],
  ['bottomLeft', 'bottom', 'bottomRight']
] as const

/** Where a point is on the picture, in words: "top left", "centre". */
export function placeName(x: number, y: number, picture: PictureSize): string {
  const column = clamp(Math.floor((x / Math.max(1, picture.width)) * 3), 0, 2)
  const row = clamp(Math.floor((y / Math.max(1, picture.height)) * 3), 0, 2)
  return t(`library:markup.place.${PLACES[row][column]}`)
}

/** A mark's accessible name: "Arrow, from top left to centre", "Blur, at bottom right". */
export function markName(mark: Mark, picture: PictureSize, scale: number): string {
  if (mark.kind === 'arrow') {
    return t('library:markup.name.arrow', {
      from: placeName(mark.x1, mark.y1, picture),
      to: placeName(mark.x2, mark.y2, picture)
    })
  }
  const bounds = markBounds(mark, scale)
  const at = placeName(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, picture)
  if (mark.kind === 'text') return t('library:markup.name.text', { text: mark.text, at })
  return t(`library:markup.name.${mark.kind}`, { at })
}

// --- Undo and redo --------------------------------------------------------

export interface MarkHistory {
  past: Mark[][]
  present: Mark[]
  future: Mark[][]
}

/** How many steps undo keeps. */
export const HISTORY_LIMIT = 100

export function startHistory(marks: Mark[] = []): MarkHistory {
  return { past: [], present: marks, future: [] }
}

/** A new step: undo goes back to what was there before it. */
export function commit(history: MarkHistory, marks: Mark[]): MarkHistory {
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: marks,
    future: []
  }
}

/** The same step, changed again: a drag in progress, a word typed into a text mark. */
export function amend(history: MarkHistory, marks: Mark[]): MarkHistory {
  return { ...history, present: marks }
}

export function undo(history: MarkHistory): MarkHistory {
  if (history.past.length === 0) return history
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future]
  }
}

export function redo(history: MarkHistory): MarkHistory {
  if (history.future.length === 0) return history
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1)
  }
}

// --- Adding a mark by typing its place --------------------------------------

export interface PlacementInput {
  kind: MarkKind
  x: string
  y: string
  width: string
  height: string
  text?: string
}

export type Placement =
  | { ok: true; mark: Omit<ArrowMark, 'id' | 'colour' | 'size'> }
  | { ok: true; mark: Omit<AreaMark, 'id' | 'colour' | 'size'> }
  | { ok: true; mark: Omit<TextMark, 'id' | 'colour' | 'size'> }
  | { ok: false; error: string }

function wholeNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return Number(trimmed)
}

/**
 * The typed form for a person who cannot draw: a position (left, top) and a
 * size in the picture's pixels. An arrow runs from the position to the far
 * corner; a text mark uses only the position.
 */
export function parsePlacement(input: PlacementInput, picture: PictureSize): Placement {
  const x = wholeNumber(input.x)
  const y = wholeNumber(input.y)
  if (x === null || y === null) return { ok: false, error: t('library:markup.form.wholeNumbers') }
  if (x >= picture.width || y >= picture.height) {
    return {
      ok: false,
      error: t('library:markup.form.outside', { width: picture.width, height: picture.height })
    }
  }
  if (input.kind === 'text') {
    const text = (input.text ?? '').trim()
    if (!text) return { ok: false, error: t('library:markup.form.typeText') }
    return { ok: true, mark: { kind: 'text', x, y, text } }
  }
  const width = wholeNumber(input.width)
  const height = wholeNumber(input.height)
  if (width === null || height === null || width < 1 || height < 1) {
    return { ok: false, error: t('library:markup.form.wholeNumbers') }
  }
  if (x + width > picture.width || y + height > picture.height) {
    return {
      ok: false,
      error: t('library:markup.form.outside', { width: picture.width, height: picture.height })
    }
  }
  if (input.kind === 'blur' && (width < MIN_BLUR_SIZE || height < MIN_BLUR_SIZE)) {
    return { ok: false, error: t('library:markup.form.blurTooSmall', { size: MIN_BLUR_SIZE }) }
  }
  if (input.kind === 'arrow') {
    return { ok: true, mark: { kind: 'arrow', x1: x, y1: y, x2: x + width, y2: y + height } }
  }
  return { ok: true, mark: { kind: input.kind, x, y, width, height } }
}

// --- Blur ---------------------------------------------------------------------

/** Pixels as a canvas's `ImageData` holds them: RGBA, row by row. */
export interface Pixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

/** Splits a length into runs of at least `block` (the last run takes what is left over). */
function runs(length: number, block: number): [number, number][] {
  const count = Math.max(1, Math.floor(length / block))
  const edges = Array.from({ length: count + 1 }, (_, index) =>
    Math.round((index * length) / count)
  )
  return edges.slice(0, -1).map((start, index) => [start, edges[index + 1]])
}

/**
 * Blur: every block of the area becomes one flat colour, the average of its
 * pixels, written into the pixels themselves. Nothing of the original is
 * left in the area to undo; a block is never smaller than `block` on a side
 * unless the whole area is, so no single pixel keeps its own colour.
 */
export function pixelate(pixels: Pixels, area: Rect, block: number): void {
  const rect = clampRect(area, pixels)
  if (!rect) return
  const { data, width } = pixels
  for (const [top, bottom] of runs(rect.height, block)) {
    for (const [left, right] of runs(rect.width, block)) {
      const sum = [0, 0, 0, 0]
      let count = 0
      for (let y = rect.y + top; y < rect.y + bottom; y++) {
        for (let x = rect.x + left; x < rect.x + right; x++) {
          const at = (y * width + x) * 4
          for (let channel = 0; channel < 4; channel++) sum[channel] += data[at + channel]
          count++
        }
      }
      if (count === 0) continue
      const average = sum.map((value) => Math.round(value / count))
      for (let y = rect.y + top; y < rect.y + bottom; y++) {
        for (let x = rect.x + left; x < rect.x + right; x++) {
          const at = (y * width + x) * 4
          for (let channel = 0; channel < 4; channel++) data[at + channel] = average[channel]
        }
      }
    }
  }
}

// --- Saving -----------------------------------------------------------------

/** The Library name of a marked-up copy: "Login page (marked up).png". */
export function markedUpFileName(fileName: string): string {
  const base = fileName.replace(/\.[^./\\]+$/, '').trim() || t('library:markup.picture')
  return `${t('library:markup.copyName', { name: base })}.png`
}

/** Whether bytes start with PNG's signature. */
export function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  return bytes.length > signature.length && signature.every((byte, index) => bytes[index] === byte)
}

/** A picture's stored bytes, as the editor opens them. */
export interface PictureBytes {
  bytes: Uint8Array
  mimeType: string
}

/** Raster images a canvas can open: what Mark up a copy is offered on. */
export const MARKABLE_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp'
]

export function isMarkableImage(item: {
  kind: string
  file: { mimeType: string } | null
}): boolean {
  return item.kind === 'image' && !!item.file && MARKABLE_IMAGE_TYPES.includes(item.file.mimeType)
}
