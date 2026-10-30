import { formatDate } from './format'
import { t } from './i18n'

/**
 * Snip to task (N4.2a, N32): the pure parts, shared by main and the overlay.
 * Main captures every display, shows an overlay over each on the snip route
 * (`/snip/<displayId>`), and crops the capture by the rectangle the person
 * dragged. One builder and one parser for the route, and one mapping from a
 * dragged rectangle to the capture's pixels, so mixed-DPI setups crop the
 * same picture the person saw.
 */

export interface SnipRect {
  x: number
  y: number
  width: number
  height: number
}

/** A display as main sees it: bounds in device-independent pixels (DIP), and its scale. */
export interface SnipDisplay {
  id: number
  bounds: SnipRect
  scaleFactor: number
}

/** What the overlay draws: the frozen picture of its display. */
export interface SnipOverlayPicture {
  dataUrl: string
  width: number
  height: number
}

/** What quick add shows of a snip waiting to be added: a small preview and its size. */
export interface SnipPreview {
  snipId: string
  thumbnail: string
  width: number
  height: number
}

/** The overlay's answer: a rectangle in its display's DIP, or the whole display under the pointer. */
export type SnipSelection = { displayId: number; rect: SnipRect } | { whole: true }

/** A drag smaller than this (DIP) on either side is a click, not a snip. */
export const MIN_SNIP_SIZE = 3

export function snipHashPath(displayId: number): string {
  return `/snip/${Math.trunc(displayId)}`
}

/** Reads a hash path (without the `#`); null when it is not the snip route. */
export function parseSnipHash(hash: string): { displayId: number } | null {
  const match = /^\/snip\/(-?\d{1,15})$/.exec(hash)
  return match ? { displayId: Number(match[1]) } : null
}

/** The rectangle between two points, whichever way the drag went. */
export function rectBetween(a: { x: number; y: number }, b: { x: number; y: number }): SnipRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

/**
 * Maps a rectangle dragged on a display's overlay (in that display's DIP,
 * its top-left at 0,0) to pixels of that display's capture. Each display has
 * its own scale, and the capture's own size decides the ratio, so a 150%
 * display's capture is cropped at 1.5 pixels per DIP. A rectangle that runs
 * past the display's edge is cut at it; null when nothing is left.
 */
export function cropToCapturePixels(
  rect: SnipRect,
  display: Pick<SnipDisplay, 'bounds'>,
  capture: { width: number; height: number }
): SnipRect | null {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return null
  const { width: displayWidth, height: displayHeight } = display.bounds
  if (displayWidth <= 0 || displayHeight <= 0 || capture.width <= 0 || capture.height <= 0)
    return null
  const left = Math.max(0, Math.min(rect.x, rect.x + rect.width))
  const top = Math.max(0, Math.min(rect.y, rect.y + rect.height))
  const right = Math.min(displayWidth, Math.max(rect.x, rect.x + rect.width))
  const bottom = Math.min(displayHeight, Math.max(rect.y, rect.y + rect.height))
  if (right - left <= 0 || bottom - top <= 0) return null
  const scaleX = capture.width / displayWidth
  const scaleY = capture.height / displayHeight
  const x0 = Math.max(0, Math.floor(left * scaleX))
  const y0 = Math.max(0, Math.floor(top * scaleY))
  const x1 = Math.min(capture.width, Math.ceil(right * scaleX))
  const y1 = Math.min(capture.height, Math.ceil(bottom * scaleY))
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** The display a point (global DIP) is on, or the nearest one. */
export function displayAt<T extends Pick<SnipDisplay, 'bounds'>>(
  displays: readonly T[],
  point: { x: number; y: number }
): T | null {
  let best: T | null = null
  let bestDistance = Infinity
  for (const display of displays) {
    const { x, y, width, height } = display.bounds
    const dx = Math.max(x - point.x, 0, point.x - (x + width))
    const dy = Math.max(y - point.y, 0, point.y - (y + height))
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      best = display
      bestDistance = distance
    }
  }
  return best
}

/** The Library file name of a snip taken at `at`: "Screenshot 14 March 2026 09.41.png". */
export function snipFileName(at: Date): string {
  const date = formatDate(at, { day: 'numeric', month: 'long', year: 'numeric' })
  const time = `${String(at.getHours()).padStart(2, '0')}.${String(at.getMinutes()).padStart(2, '0')}`
  return `${t('desktop:snip.fileName', { date, time })}.png`
}
