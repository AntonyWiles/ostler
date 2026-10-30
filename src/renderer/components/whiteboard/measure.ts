import { estimateTextWidth, type MeasureText } from '@shared/whiteboard/text-layout'
import { appFontFamily } from '../markup/draw'

/**
 * A `MeasureText` that measures with a 2D canvas in the app's font, so the
 * wrap rule (`wrapText`, `fitText`) breaks lines where the drawn text does.
 * Widths are cached by size and text. Where there is no canvas (jsdom, a
 * worker) it falls back to `estimateTextWidth`.
 */
export function canvasMeasure(fontFamily: string = appFontFamily()): MeasureText {
  let context: CanvasRenderingContext2D | null = null
  try {
    context = document.createElement('canvas').getContext('2d')
  } catch {
    context = null
  }
  if (!context) return estimateTextWidth
  const canvas = context
  const cache = new Map<number, Map<string, number>>()
  return (text, fontSize) => {
    let bySize = cache.get(fontSize)
    if (!bySize) {
      bySize = new Map()
      cache.set(fontSize, bySize)
    }
    const known = bySize.get(text)
    if (known !== undefined) return known
    canvas.font = `${fontSize}px ${fontFamily}`
    const width = canvas.measureText(text).width
    bySize.set(text, width)
    return width
  }
}
