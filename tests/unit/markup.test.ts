import { describe, expect, it } from 'vitest'
import {
  blurBlockSize,
  commit,
  amend,
  markedUpFileName,
  markName,
  moveMark,
  parsePlacement,
  pixelate,
  redo,
  resizeMark,
  startHistory,
  undo,
  type Mark,
  type Pixels
} from '../../src/shared/markup'

/**
 * Mark up (N4.2b): the pure rules (names, moving, undo, the typed form),
 * the blur that replaces pixels, and flattening marks into a PNG.
 */

const PICTURE = { width: 300, height: 300 }

/** A picture whose every pixel is different, so a surviving pixel can be found. */
function gradient(width: number, height: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      data[at] = (x * 7) % 256
      data[at + 1] = (y * 11) % 256
      data[at + 2] = (x * 3 + y * 5) % 256
      data[at + 3] = 255
    }
  }
  return { data, width, height }
}

function pixelAt(pixels: Pixels, x: number, y: number): number[] {
  const at = (y * pixels.width + x) * 4
  return Array.from(pixels.data.slice(at, at + 4))
}

const box = (id: string, x = 10, y = 10): Mark => ({
  id,
  kind: 'box',
  colour: 'red',
  size: 'medium',
  x,
  y,
  width: 50,
  height: 40
})

describe('blur', () => {
  it('replaces every pixel of the area with its block’s flat colour', () => {
    const original = gradient(64, 48)
    const pixels = { ...original, data: original.data.slice() }
    const area = { x: 5, y: 3, width: 37, height: 29 }
    pixelate(pixels, area, 16)
    let survivors = 0
    const colours = new Set<string>()
    for (let y = area.y; y < area.y + area.height; y++) {
      for (let x = area.x; x < area.x + area.width; x++) {
        const before = pixelAt(original, x, y)
        const after = pixelAt(pixels, x, y)
        if (before.join() === after.join()) survivors++
        colours.add(after.join())
      }
    }
    // The original's pixels are gone from the area: a handful of flat blocks is all that is left.
    expect(survivors).toBeLessThan(3)
    expect(colours.size).toBeLessThanOrEqual(4)
    // Outside the area nothing changes.
    expect(pixelAt(pixels, 0, 0)).toEqual(pixelAt(original, 0, 0))
    expect(pixelAt(pixels, 63, 47)).toEqual(pixelAt(original, 63, 47))
  })

  it('never leaves a thin strip of real pixels at the area’s edge', () => {
    const original = gradient(40, 40)
    const pixels = { ...original, data: original.data.slice() }
    // 17 wide with blocks of 16: the last pixel column joins the block before it.
    pixelate(pixels, { x: 0, y: 0, width: 17, height: 17 }, 16)
    const first = pixelAt(pixels, 0, 0).join()
    for (let y = 0; y < 17; y++)
      for (let x = 0; x < 17; x++) expect(pixelAt(pixels, x, y).join()).toBe(first)
  })

  it('uses blocks larger than the app’s text at the picture’s scale', () => {
    expect(blurBlockSize(1)).toBeGreaterThanOrEqual(16)
    expect(blurBlockSize(1.5)).toBe(30)
  })
})

describe('marks', () => {
  it('names each mark by where it is', () => {
    const arrow: Mark = {
      id: 'a',
      kind: 'arrow',
      colour: 'red',
      size: 'medium',
      x1: 10,
      y1: 10,
      x2: 150,
      y2: 150
    }
    expect(markName(arrow, PICTURE, 1)).toBe('Arrow, from top left to centre')
    expect(markName(box('b', 240, 250), PICTURE, 1)).toBe('Box, at bottom right')
    expect(
      markName(
        { id: 't', kind: 'text', colour: 'red', size: 'thin', x: 120, y: 10, text: 'Wrong total' },
        PICTURE,
        1
      )
    ).toBe('Text “Wrong total”, at top')
  })

  it('moves a mark and keeps it on the picture', () => {
    expect(moveMark(box('b'), 5, -3, PICTURE, 1)).toMatchObject({ x: 15, y: 7 })
    expect(moveMark(box('b'), 1000, 1000, PICTURE, 1)).toMatchObject({ x: 250, y: 260 })
    expect(moveMark(box('b'), -100, 0, PICTURE, 1)).toMatchObject({ x: 0 })
  })

  it('resizes an area from its bottom right corner', () => {
    expect(resizeMark(box('b'), 100, 80, PICTURE)).toMatchObject({ width: 90, height: 70 })
    expect(resizeMark(box('b'), 900, 900, PICTURE)).toMatchObject({ width: 290, height: 290 })
  })
})

describe('undo and redo', () => {
  it('steps back and forward through what was done', () => {
    let history = startHistory()
    history = commit(history, [box('1')])
    history = commit(history, [box('1'), box('2')])
    // A drag in progress changes the same step.
    history = amend(history, [box('1'), box('2', 30, 30)])
    history = undo(history)
    expect(history.present.map((mark) => mark.id)).toEqual(['1'])
    history = undo(history)
    expect(history.present).toEqual([])
    expect(undo(history)).toBe(history)
    history = redo(history)
    history = redo(history)
    expect(history.present[1]).toMatchObject({ id: '2', x: 30 })
    expect(redo(history)).toBe(history)
  })

  it('a new step after undo drops what could have been redone', () => {
    let history = commit(startHistory(), [box('1')])
    history = undo(history)
    history = commit(history, [box('3')])
    expect(history.future).toEqual([])
    expect(redo(history)).toBe(history)
  })
})

describe('the typed position form', () => {
  const input = { kind: 'box' as const, x: '20', y: '30', width: '100', height: '50' }

  it('makes a mark from a position and a size in the picture’s pixels', () => {
    expect(parsePlacement(input, PICTURE)).toEqual({
      ok: true,
      mark: { kind: 'box', x: 20, y: 30, width: 100, height: 50 }
    })
    expect(parsePlacement({ ...input, kind: 'arrow' }, PICTURE)).toEqual({
      ok: true,
      mark: { kind: 'arrow', x1: 20, y1: 30, x2: 120, y2: 80 }
    })
    expect(parsePlacement({ ...input, kind: 'text', text: ' Here ' }, PICTURE)).toEqual({
      ok: true,
      mark: { kind: 'text', x: 20, y: 30, text: 'Here' }
    })
  })

  it('says what is wrong', () => {
    expect(parsePlacement({ ...input, x: 'ten' }, PICTURE)).toMatchObject({ ok: false })
    expect(parsePlacement({ ...input, width: '0' }, PICTURE)).toMatchObject({ ok: false })
    expect(parsePlacement({ ...input, x: '250' }, PICTURE)).toEqual({
      ok: false,
      error: 'That goes past the picture’s edge. The picture is 300 × 300.'
    })
    expect(parsePlacement({ ...input, kind: 'blur', width: '4' }, PICTURE)).toMatchObject({
      ok: false
    })
    expect(parsePlacement({ ...input, kind: 'text', text: '  ' }, PICTURE)).toMatchObject({
      ok: false
    })
  })
})

describe('saving', () => {
  it('names the copy after the original', () => {
    expect(markedUpFileName('Login page.jpg')).toBe('Login page (marked up).png')
    expect(markedUpFileName('Screenshot 14 March 2026 09.41.png')).toBe(
      'Screenshot 14 March 2026 09.41 (marked up).png'
    )
  })
})
