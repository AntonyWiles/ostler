import { createElement } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { ItemLinkInfo } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { expandRect, objectRect, unionRect, type Rect } from '@shared/whiteboard/geometry'
import type { WhiteboardObjectInput } from '@shared/whiteboard/model'
import { WhiteboardScene } from './WhiteboardScene'

/** Room left around the objects in an export, in board units. */
export const EXPORT_MARGIN = 32
/** An empty board exports as this much paper. */
const EMPTY_BOARD = { width: 800, height: 600 }
/** A PNG is drawn at twice the board's size... */
const PNG_SCALE = 2
/** ...but no side larger than this, which every canvas can hold. */
export const PNG_MAX_SIDE = 8192

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Styles each drawn element takes from its classes, written onto it so the file needs no CSS. */
const INLINED = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor'
] as const

export interface WhiteboardSvgOptions {
  projectId: string
  /** Live titles and statuses of linked items, as the board shows them. */
  links?: ReadonlyMap<string, ItemLinkInfo>
}

/** The area an export covers: every object, plus the margin (an empty board: 800×600). */
export function exportViewBox(objects: readonly WhiteboardObjectInput[]): Rect {
  const bounds = unionRect(objects.map(objectRect))
  if (!bounds) return { x: 0, y: 0, ...EMPTY_BOARD }
  return expandRect(bounds, EXPORT_MARGIN)
}

/** Base64 of bytes, a piece at a time so a large picture does not overflow the call stack. */
function base64Of(bytes: Uint8Array): string {
  let binary = ''
  const piece = 0x8000
  for (let start = 0; start < bytes.length; start += piece) {
    binary += String.fromCharCode(...bytes.subarray(start, start + piece))
  }
  return btoa(binary)
}

/** Each picture on the board as a `data:` URL; one that cannot be read is left out (drawn as missing). */
async function pictureDataUrls(
  projectId: string,
  objects: readonly WhiteboardObjectInput[]
): Promise<Map<string, string>> {
  const ids = new Set<string>()
  for (const object of objects) {
    if (object.kind === 'image' && object.data.imageItemId !== null)
      ids.add(object.data.imageItemId)
  }
  const urls = new Map<string, string>()
  await Promise.all(
    [...ids].map(async (id) => {
      try {
        const result = await window.ostlerAPI.getLibraryImage(projectId, id)
        if (result.ok) {
          urls.set(id, `data:${result.value.mimeType};base64,${base64Of(result.value.bytes)}`)
        }
      } catch {
        // Drawn as a missing picture.
      }
    })
  )
  return urls
}

/** Writes each element's computed drawing styles onto it as attributes and drops its classes. */
function inlineStyles(root: SVGSVGElement): void {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))]
  const styles = elements.map((element) => {
    const computed = getComputedStyle(element)
    return INLINED.map((name) => [name, computed.getPropertyValue(name).trim()] as const)
  })
  elements.forEach((element, index) => {
    for (const [name, value] of styles[index]) {
      if (value) element.setAttribute(name, value)
    }
    element.removeAttribute('class')
    element.removeAttribute('aria-hidden')
  })
}

/**
 * The board as an SVG file (plan `docs/plans/whiteboards/`, prompt 16, D15):
 * drawn by the one `WhiteboardScene` into a hidden container on the page, with
 * its colours and fonts written onto each element, so the file looks the same
 * in a browser as on the board, and every picture embedded as a `data:` URL.
 */
export async function whiteboardSvg(
  objects: readonly WhiteboardObjectInput[],
  { projectId, links }: WhiteboardSvgOptions
): Promise<string> {
  const pictures = await pictureDataUrls(projectId, objects)
  const viewBox = exportViewBox(objects)

  const container = document.createElement('div')
  container.setAttribute('aria-hidden', 'true')
  Object.assign(container.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${viewBox.width}px`,
    height: `${viewBox.height}px`,
    overflow: 'hidden',
    pointerEvents: 'none'
  })
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    flushSync(() =>
      root.render(
        createElement(WhiteboardScene, {
          objects,
          viewBox,
          width: viewBox.width,
          height: viewBox.height,
          imageUrl: (id: string) => pictures.get(id) ?? null,
          links
        })
      )
    )
    const svg = container.querySelector('svg')
    if (!svg) throw new Error('The whiteboard was not drawn')
    inlineStyles(svg)
    svg.setAttribute('width', String(viewBox.width))
    svg.setAttribute('height', String(viewBox.height))
    // The serializer writes the namespace itself; an xmlns attribute too would be written twice.
    svg.removeAttribute('xmlns')
    const text = new XMLSerializer().serializeToString(svg)
    return /^<svg[^>]*\sxmlns="/.test(text) ? text : text.replace(/^<svg/, `<svg xmlns="${SVG_NS}"`)
  } finally {
    root.unmount()
    container.remove()
  }
}

/** The size a PNG of a `width` × `height` board is drawn at: 2×, no side over 8,192 px. */
export function pngSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(PNG_SCALE, PNG_MAX_SIDE / width, PNG_MAX_SIDE / height)
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale))
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(t('library:whiteboard.export.pngFailed')))
    image.src = url
  })
}

/** UTF-8 base64 of text, for a `data:` URL (the page's CSP allows data:, not blob:). */
function textBase64(text: string): string {
  return base64Of(new TextEncoder().encode(text))
}

/**
 * The board as a PNG: the SVG from `whiteboardSvg` drawn on a canvas at 2×
 * (smaller when a side would pass 8,192 px). A canvas that refuses to give its
 * picture up is a translated "couldn't make a PNG".
 */
export async function whiteboardPng(
  svg: string,
  width: number,
  height: number
): Promise<Uint8Array> {
  const image = await loadImage(`data:image/svg+xml;base64,${textBase64(svg)}`)
  const size = pngSize(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error(t('library:whiteboard.export.pngFailed'))
  context.drawImage(image, 0, 0, size.width, size.height)
  let blob: Blob | null
  try {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') {
      throw new Error(t('library:whiteboard.export.pngFailed'))
    }
    throw error
  }
  if (!blob) throw new Error(t('library:whiteboard.export.pngFailed'))
  return new Uint8Array(await blob.arrayBuffer())
}
