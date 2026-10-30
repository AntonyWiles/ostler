// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanWhiteboardObject, type WhiteboardObjectInput } from '@shared/whiteboard/model'
import {
  EXPORT_MARGIN,
  PNG_MAX_SIDE,
  exportViewBox,
  pngSize,
  whiteboardSvg
} from '@renderer/components/whiteboard/export'
import { installOstlerApi } from '../fixtures/ostler-api'

/**
 * Export as SVG (plan `docs/plans/whiteboards/`, prompt 16, D15): the board drawn by the one
 * scene, with its colours written onto each element instead of classes, and its pictures
 * embedded as `data:` URLs. jsdom cannot draw on a canvas, so the PNG itself is checked by the
 * end-to-end test; here only its size rule is.
 */

const PROJECT = '11111111-1111-4111-8111-111111111111'
const PICTURE = '22222222-2222-4222-8222-222222222222'
const GONE = '33333333-3333-4333-8333-333333333333'
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function object(fields: Record<string, unknown>): WhiteboardObjectInput {
  return cleanWhiteboardObject({ x: 0, y: 0, width: 200, height: 200, z: 0, ...fields })
}

const note = object({ id: 'note', kind: 'note', text: 'Buy milk', x: -40, y: 10 })
const picture = object({
  id: 'picture',
  kind: 'image',
  x: 300,
  y: 100,
  width: 120,
  height: 80,
  z: 1,
  data: { imageItemId: PICTURE }
})

beforeEach(() => {
  // jsdom has no canvas; text is measured by estimate.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  // jsdom computes no SVG paint from CSS (and the scene's CSS is not loaded under Vitest), so the
  // note's colour token is stood in for here.
  const real = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const computed = real(element, pseudo)
    const light = element.getAttribute('class')?.includes('wb-fill-light-') ?? false
    return Object.assign(Object.create(computed), {
      getPropertyValue: (name: string) =>
        name === 'fill' && light ? 'rgb(255, 240, 150)' : computed.getPropertyValue(name)
    })
  })
  installOstlerApi({
    getLibraryImage: async (_projectId, itemId) =>
      itemId === PICTURE
        ? { ok: true, value: { bytes: PNG, mimeType: 'image/png' } }
        : { ok: false, error: 'missing' }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function parse(svg: string): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml')
  return parsed.documentElement as unknown as SVGSVGElement
}

describe('whiteboardSvg', () => {
  it('writes styles onto the drawing and keeps no classes', async () => {
    const root = parse(await whiteboardSvg([note, picture], { projectId: PROJECT }))
    expect(root.querySelectorAll('[class]')).toHaveLength(0)
    expect(root.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg')
    const noteShape = root.querySelector('[data-object-id="note"] [data-note-body]')
    expect(noteShape?.getAttribute('fill')).toBe('rgb(255, 240, 150)')
  })

  it('embeds the picture as a data: URL', async () => {
    const root = parse(await whiteboardSvg([note, picture], { projectId: PROJECT }))
    const image = root.querySelector('[data-object-id="picture"] image')
    const expected = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`
    expect(image?.getAttribute('href')).toBe(expected)
  })

  it('draws a picture it cannot read as a missing picture', async () => {
    const gone = object({ ...picture, id: 'gone', data: { imageItemId: GONE } })
    const root = parse(await whiteboardSvg([gone], { projectId: PROJECT }))
    expect(root.querySelector('image')).toBeNull()
    expect(root.querySelector('[data-missing-picture]')).not.toBeNull()
  })

  it('covers the objects plus 32 units, at that size', async () => {
    const root = parse(await whiteboardSvg([note, picture], { projectId: PROJECT }))
    // Objects span x -40..420 and y 10..210.
    const left = -40 - EXPORT_MARGIN
    const top = 10 - EXPORT_MARGIN
    const width = 460 + 2 * EXPORT_MARGIN
    const height = 200 + 2 * EXPORT_MARGIN
    expect(root.getAttribute('viewBox')).toBe(`${left} ${top} ${width} ${height}`)
    expect(root.getAttribute('width')).toBe(String(width))
    expect(root.getAttribute('height')).toBe(String(height))
  })

  it('leaves nothing on the page', async () => {
    await whiteboardSvg([note], { projectId: PROJECT })
    expect(document.body.querySelector('svg')).toBeNull()
  })
})

describe('export sizes', () => {
  it('makes an empty board 800 by 600', () => {
    expect(exportViewBox([])).toEqual({ x: 0, y: 0, width: 800, height: 600 })
  })

  it('draws a PNG at twice the size, no side over 8,192 px', () => {
    expect(pngSize(400, 300)).toEqual({ width: 800, height: 600 })
    const wide = pngSize(10000, 1000)
    expect(wide.width).toBe(PNG_MAX_SIDE)
    expect(wide.height).toBe(Math.floor(1000 * (PNG_MAX_SIDE / 10000)))
  })
})
