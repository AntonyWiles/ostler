// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Mark, Pixels } from '@shared/markup'
import {
  flattenToPng,
  type DrawOptions,
  type MarkupCanvas,
  type MarkupContext
} from '@renderer/components/markup/draw'

/**
 * Mark up (N4.2b): flattening marks into a PNG at the picture's own pixels,
 * with a blur that replaces the pixels under it. The canvas is a fake over
 * real pixels, as jsdom has none.
 */

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

describe('saving a marked-up picture', () => {
  /** A canvas over real pixels: drawImage copies the picture in, and each mark is recorded. */
  function fakeCanvas(source: Pixels) {
    const calls: string[] = []
    let pixels: Pixels | null = null
    let encoded: { type: string; width: number; height: number } | null = null
    const context = {
      drawImage: () => {
        pixels = { ...source, data: source.data.slice() }
        calls.push('picture')
      },
      getImageData: (x: number, y: number, width: number, height: number) => {
        const data = new Uint8ClampedArray(width * height * 4)
        for (let row = 0; row < height; row++)
          for (let column = 0; column < width; column++)
            data.set(
              pixels!.data.slice(
                ((y + row) * pixels!.width + x + column) * 4,
                ((y + row) * pixels!.width + x + column) * 4 + 4
              ),
              (row * width + column) * 4
            )
        return { data, width, height } as unknown as ImageData
      },
      putImageData: (image: ImageData, x: number, y: number) => {
        calls.push('blur')
        for (let row = 0; row < image.height; row++)
          for (let column = 0; column < image.width; column++)
            pixels!.data.set(
              image.data.slice(
                (row * image.width + column) * 4,
                (row * image.width + column) * 4 + 4
              ),
              ((y + row) * pixels!.width + x + column) * 4
            )
      },
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => calls.push('arrow line'),
      fill: () => calls.push('arrow head'),
      strokeRect: () => calls.push('box'),
      fillRect: () => calls.push('highlight'),
      fillText: (text: string) => calls.push(`text ${text}`),
      strokeText: () => {},
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      globalAlpha: 1,
      font: '',
      textBaseline: 'alphabetic'
    } as MarkupContext
    const canvas: MarkupCanvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob(callback, type) {
        encoded = { type, width: canvas.width, height: canvas.height }
        callback({
          arrayBuffer: async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer
        } as Blob)
      }
    }
    return { canvas, calls, pixels: () => pixels!, encoded: () => encoded }
  }

  const options: DrawOptions = {
    scale: 1,
    fontFamily: 'Segoe UI',
    colours: { red: '#f00', yellow: '#ff0', blue: '#00f', green: '#0f0', black: '#000' }
  }

  it('flattens the picture and every mark, in order, into a PNG at the picture’s own size', async () => {
    const source = gradient(3840, 40)
    const fake = fakeCanvas(source)
    const marks: Mark[] = [
      { id: '1', kind: 'arrow', colour: 'red', size: 'thick', x1: 0, y1: 0, x2: 30, y2: 30 },
      box('2'),
      {
        id: '3',
        kind: 'highlight',
        colour: 'yellow',
        size: 'thin',
        x: 0,
        y: 0,
        width: 9,
        height: 9
      },
      { id: '4', kind: 'text', colour: 'blue', size: 'medium', x: 2, y: 2, text: 'Here\nThere' },
      { id: '5', kind: 'blur', colour: 'red', size: 'thin', x: 3000, y: 0, width: 200, height: 40 }
    ]
    const png = await flattenToPng(
      {} as CanvasImageSource,
      { width: 3840, height: 40 },
      marks,
      options,
      () => fake.canvas
    )
    expect(Array.from(png)).toEqual([0x89, 0x50, 0x4e, 0x47])
    // A 4K snip is saved at its full resolution, not the screen's.
    expect(fake.encoded()).toEqual({ type: 'image/png', width: 3840, height: 40 })
    expect(fake.calls).toEqual([
      'picture',
      'arrow line',
      'arrow head',
      'box',
      'highlight',
      'text Here',
      'text There',
      'blur'
    ])
    // The blurred area holds none of the original's pixels.
    const out = fake.pixels()
    let survivors = 0
    for (let y = 0; y < 40; y++)
      for (let x = 3000; x < 3200; x++)
        if (pixelAt(out, x, y).join() === pixelAt(source, x, y).join()) survivors++
    expect(survivors).toBeLessThan(10)
    expect(pixelAt(out, 2999, 0)).toEqual(pixelAt(source, 2999, 0))
  })
})
