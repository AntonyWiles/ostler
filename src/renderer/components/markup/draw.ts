import {
  blurBlockSize,
  clampRect,
  MARK_COLOURS,
  pixelate,
  strokeWidth,
  textSize,
  type Mark,
  type MarkColour,
  type PictureSize
} from '@shared/markup'

/**
 * Draws marks onto a picture (N4.2b). The editor shows the picture through
 * the same function it saves with, so what the person sees is what is
 * saved: the picture at its own pixels, then each mark in the order it was
 * made. A blur pixelates the pixels already drawn, so the saved PNG holds
 * only the flattened result, never the original under a filter.
 */

/** The parts of a 2D canvas context marking up uses (a fake one in tests). */
export interface MarkupContext {
  drawImage(image: CanvasImageSource, x: number, y: number): void
  getImageData(x: number, y: number, width: number, height: number): ImageData
  putImageData(data: ImageData, x: number, y: number): void
  save(): void
  restore(): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  stroke(): void
  fill(): void
  strokeRect(x: number, y: number, width: number, height: number): void
  fillRect(x: number, y: number, width: number, height: number): void
  fillText(text: string, x: number, y: number): void
  strokeText(text: string, x: number, y: number): void
  strokeStyle: string | CanvasGradient | CanvasPattern
  fillStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
  globalAlpha: number
  font: string
  textBaseline: CanvasTextBaseline
}

export interface DrawOptions {
  /** The picture's pixels per screen pixel (see `pixelScale`). */
  scale: number
  /** Each colour's value, from the annotation tokens. */
  colours: Record<MarkColour, string>
  /** The app's font, from `--font-sans`. */
  fontFamily: string
}

/** The highlight's marker: a translucent fill. */
const HIGHLIGHT_ALPHA = 0.35

/** The annotation tokens' current values (tokens.css), read where the editor runs. */
export function annotationColours(
  root: Element = document.documentElement
): Record<MarkColour, string> {
  const style = getComputedStyle(root)
  const entries = MARK_COLOURS.map((colour) => {
    const value = style.getPropertyValue(`--annotation-${colour}`).trim()
    return [colour, value || 'currentColor'] as const
  })
  return Object.fromEntries(entries) as Record<MarkColour, string>
}

/** The app's font family, from the type token. */
export function appFontFamily(root: Element = document.documentElement): string {
  return getComputedStyle(root).getPropertyValue('--font-sans').trim() || 'sans-serif'
}

/** Draws the picture and its marks; the context is the picture's size. */
export function drawMarkup(
  context: MarkupContext,
  image: CanvasImageSource,
  picture: PictureSize,
  marks: readonly Mark[],
  options: DrawOptions
): void {
  context.drawImage(image, 0, 0)
  for (const mark of marks) drawMark(context, mark, picture, options)
}

function drawMark(
  context: MarkupContext,
  mark: Mark,
  picture: PictureSize,
  options: DrawOptions
): void {
  const colour = options.colours[mark.colour]
  const width = strokeWidth(mark.size, options.scale)
  context.save()
  switch (mark.kind) {
    case 'blur': {
      const area = clampRect(mark, picture)
      if (area) {
        const pixels = context.getImageData(area.x, area.y, area.width, area.height)
        pixelate(
          pixels,
          { x: 0, y: 0, width: area.width, height: area.height },
          blurBlockSize(options.scale)
        )
        context.putImageData(pixels, area.x, area.y)
      }
      break
    }
    case 'box':
      context.strokeStyle = colour
      context.lineWidth = width
      context.lineJoin = 'round'
      context.strokeRect(mark.x, mark.y, mark.width, mark.height)
      break
    case 'highlight':
      context.globalAlpha = HIGHLIGHT_ALPHA
      context.fillStyle = colour
      context.fillRect(mark.x, mark.y, mark.width, mark.height)
      break
    case 'arrow':
      drawArrow(context, mark.x1, mark.y1, mark.x2, mark.y2, colour, width)
      break
    case 'text': {
      const size = textSize(mark.size, options.scale)
      context.font = `600 ${size}px ${options.fontFamily}`
      context.textBaseline = 'top'
      context.fillStyle = colour
      mark.text.split('\n').forEach((line, index) => {
        context.fillText(line, mark.x, mark.y + index * Math.round(size * 1.25))
      })
      break
    }
  }
  context.restore()
}

function drawArrow(
  context: MarkupContext,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colour: string,
  width: number
): void {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const head = Math.max(10, width * 4)
  context.strokeStyle = colour
  context.fillStyle = colour
  context.lineWidth = width
  context.lineCap = 'round'
  context.beginPath()
  // The line stops at the head's base, so a thick line does not poke through its tip.
  context.moveTo(x1, y1)
  context.lineTo(x2 - Math.cos(angle) * head * 0.8, y2 - Math.sin(angle) * head * 0.8)
  context.stroke()
  context.beginPath()
  context.moveTo(x2, y2)
  context.lineTo(
    x2 - head * Math.cos(angle - Math.PI / 7),
    y2 - head * Math.sin(angle - Math.PI / 7)
  )
  context.lineTo(
    x2 - head * Math.cos(angle + Math.PI / 7),
    y2 - head * Math.sin(angle + Math.PI / 7)
  )
  context.closePath()
  context.fill()
}

/** The parts of a canvas saving needs. */
export interface MarkupCanvas {
  width: number
  height: number
  getContext(kind: '2d'): MarkupContext | null
  toBlob(callback: (blob: Blob | null) => void, type: string): void
}

/**
 * The marked-up picture as PNG bytes, at the picture's own pixels: one new
 * canvas, the picture and every mark flattened into it.
 */
export async function flattenToPng(
  image: CanvasImageSource,
  picture: PictureSize,
  marks: readonly Mark[],
  options: DrawOptions,
  createCanvas: () => MarkupCanvas = () =>
    document.createElement('canvas') as unknown as MarkupCanvas
): Promise<Uint8Array> {
  const canvas = createCanvas()
  canvas.width = picture.width
  canvas.height = picture.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This picture could not be drawn')
  drawMarkup(context, image, picture, marks, options)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('This picture could not be saved')
  return new Uint8Array(await blob.arrayBuffer())
}

/** Opens a picture for the canvas from its bytes (a blob URL, so the canvas stays readable). */
export function loadPicture(
  bytes: Uint8Array,
  mimeType: string
): Promise<{ image: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }))
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ image, release: () => URL.revokeObjectURL(url) })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('This picture could not be opened'))
    }
    image.src = url
  })
}
