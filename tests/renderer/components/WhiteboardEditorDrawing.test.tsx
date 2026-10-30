// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WHITEBOARD_SHORTCUTS } from '@shared/shortcuts'
import type { ObjectMap } from '@shared/whiteboard/history'
import { cleanWhiteboardObject, type WhiteboardObjectInput } from '@shared/whiteboard/model'
import {
  WhiteboardEditor,
  type WhiteboardEditorProps
} from '@renderer/components/whiteboard/WhiteboardEditor'
import { AnnouncerProvider } from '@renderer/ui'
import { pickColour, pickStyle } from './whiteboard-style-helpers'

/**
 * The whiteboard editor's pen, marker, eraser, shapes and frames
 * (docs/plans/whiteboards, prompt 09). As in WhiteboardEditor.test.tsx: jsdom
 * has no layout, so the view stays at 100% with the board's origin top-left
 * and a client point is a board point.
 */

function object(fields: Record<string, unknown>): WhiteboardObjectInput {
  return cleanWhiteboardObject({ x: 0, y: 0, width: 200, height: 200, z: 1, ...fields })
}

let changes: ObjectMap[] = []
const onChange = vi.fn((present: ObjectMap) => changes.push(present))

function renderEditor(props: Partial<WhiteboardEditorProps> = {}) {
  render(
    <AnnouncerProvider>
      <WhiteboardEditor
        title="Launch"
        objects={[]}
        version={1}
        onChange={onChange}
        imageUrl={() => null}
        {...props}
      />
    </AnnouncerProvider>
  )
  return screen.getByRole('group', { name: 'Whiteboard: Launch' })
}

function pointer(
  type: string,
  target: Element,
  [x, y]: [number, number],
  init: MouseEventInit = {}
) {
  fireEvent(
    target,
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, ...init })
  )
}

function drag(board: Element, points: readonly [number, number][], init: MouseEventInit = {}) {
  pointer('pointerdown', board, points[0], { button: 0, ...init })
  for (const point of points.slice(1)) pointer('pointermove', board, point, init)
  pointer('pointerup', board, points[points.length - 1], init)
}

function click(board: Element, at: [number, number]) {
  drag(board, [at])
}

const root$ = () => document.querySelector('.wb-editor')!
const key = (init: KeyboardEventInit & { key: string }) => fireEvent.keyDown(root$(), init)
const latest = () => changes[changes.length - 1]
const all = () => [...latest().values()]
const announced = () => document.querySelector('[data-announcer]')?.textContent?.trim() ?? ''
const toolButton = (name: string) =>
  within(screen.getByRole('toolbar', { name: 'Tools' })).getByRole('button', { name })

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  changes = []
  onChange.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the drawing tools', () => {
  it('lists the new keys in the shortcut table', () => {
    const keys = Object.fromEntries(WHITEBOARD_SHORTCUTS.map((entry) => [entry.id, entry.keys]))
    expect(keys).toMatchObject({
      pen: 'P',
      marker: 'M',
      eraser: 'E',
      shape: 'S',
      frame: 'F',
      'draw-square': 'Shift+drag'
    })
  })

  it('makes one pen object of at most 2,000 points from a drag, in one change', () => {
    const board = renderEditor()
    key({ key: 'p' })
    expect(toolButton('Pen').getAttribute('aria-pressed')).toBe('true')
    // A wave of 2,100 points: more than a stroke may keep.
    const points: [number, number][] = Array.from({ length: 2100 }, (_, index) => [
      100 + index * 0.5,
      200 + Math.round(80 * Math.sin(index / 15))
    ])
    pointer('pointerdown', board, points[0], { button: 0 })
    for (const point of points.slice(1, 50)) pointer('pointermove', board, point)
    // Drawn live in the overlay, and nothing is committed until release.
    expect(document.querySelector('.wb-editor__drawing path')).not.toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    for (const point of points.slice(50)) pointer('pointermove', board, point)
    pointer('pointerup', board, points[points.length - 1])
    expect(onChange).toHaveBeenCalledTimes(1)
    const [pen] = all()
    expect(pen).toMatchObject({ kind: 'pen', colour: 'black' })
    if (pen.kind !== 'pen') throw new Error('not a pen')
    expect(pen.data).toMatchObject({ stroke: 'medium', marker: false })
    expect(pen.data.points.length / 2).toBeLessThanOrEqual(2000)
    expect(pen.data.points.length / 2).toBeGreaterThan(2)
    expect(announced()).toBe('Drawing added')
    expect(document.querySelector('.wb-editor__drawing')).toBeNull()
    // The tool stays chosen.
    expect(toolButton('Pen').getAttribute('aria-pressed')).toBe('true')
  })

  it('makes a dot of the stroke’s width from a click, which a drag then moves', () => {
    const board = renderEditor()
    key({ key: 'p' })
    click(board, [100, 100])
    const [dot] = all()
    if (dot.kind !== 'pen') throw new Error('not a pen')
    expect(dot).toMatchObject({ x: 100, y: 100, width: 0, height: 0 })
    // Two equal points: a round-capped line of no length, drawn as a dot the stroke's width.
    const path = document.querySelector('[data-object-id] path')!
    expect(path.getAttribute('d')).toBe('M 100 100 L 100 100')
    expect(path.getAttribute('stroke-linecap')).toBe('round')
    expect(path.getAttribute('stroke-width')).toBe('4')

    // Selected, it shows no handles to cover it, and a drag on it moves it.
    key({ key: 'v' })
    click(board, [100, 100])
    expect(screen.getByRole('button', { name: 'Drawing' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    expect(document.querySelector('[data-handle]')).toBeNull()
    drag(board, [
      [100, 100],
      [140, 130],
      [160, 150]
    ])
    expect(latest().get(dot.id)).toMatchObject({ x: 160, y: 150 })
    expect(announced()).toBe('Moved')
  })

  it('keeps resize handles on a drawing big enough for them', () => {
    const board = renderEditor({
      objects: [
        object({
          id: 'line',
          kind: 'pen',
          x: 100,
          y: 100,
          width: 100,
          height: 0,
          data: { points: [0, 0, 100, 0], stroke: 'medium', marker: false }
        })
      ]
    })
    click(board, [150, 100])
    expect(document.querySelectorAll('[data-handle]')).toHaveLength(8)
  })

  it('draws a marker stroke with marker set, yellow and thick', () => {
    const board = renderEditor()
    key({ key: 'm' })
    drag(board, [
      [10, 10],
      [60, 40],
      [120, 20]
    ])
    const [stroke] = all()
    expect(stroke).toMatchObject({ kind: 'pen', colour: 'yellow' })
    expect(stroke.data).toMatchObject({ marker: true, stroke: 'thick' })
  })

  it('remembers the colour and stroke picked in the style controls for the next stroke', () => {
    const board = renderEditor()
    key({ key: 'p' })
    pickColour('Red')
    pickStyle('Line width', 'Thin')
    expect(onChange).not.toHaveBeenCalled()
    drag(board, [
      [10, 10],
      [80, 80]
    ])
    expect(all()[0]).toMatchObject({ colour: 'red', data: { stroke: 'thin' } })
  })

  it('keeps the stroke just drawn selected, so the style controls change it and the next one', () => {
    const board = renderEditor()
    key({ key: 'p' })
    drag(board, [
      [10, 10],
      [80, 80]
    ])
    const [drawn] = all()
    pickColour('Blue')
    expect(latest().get(drawn.id)).toMatchObject({ colour: 'blue' })
    drag(board, [
      [200, 10],
      [280, 80]
    ])
    const next = all().find((object) => object.id !== drawn.id)
    expect(next).toMatchObject({ kind: 'pen', colour: 'blue' })
  })

  it('erases a stroke the eraser crosses in one change, and leaves a note under the path', () => {
    const stroke = object({
      id: 's',
      kind: 'pen',
      x: 0,
      y: 500,
      width: 400,
      height: 0,
      data: { points: [0, 0, 400, 0] }
    })
    const note = object({ id: 'n', kind: 'note', text: 'Keep me', x: 100, y: 520, z: 2 })
    const board = renderEditor({ objects: [stroke, note] })
    key({ key: 'e' })
    pointer('pointerdown', board, [200, 400], { button: 0 })
    pointer('pointermove', board, [200, 560])
    // The touched stroke fades during the drag.
    expect(
      document.querySelector('[data-object-id="s"]')?.classList.contains('wb-object--erasing')
    ).toBe(true)
    pointer('pointermove', board, [200, 700])
    pointer('pointerup', board, [200, 700])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(latest().has('s')).toBe(false)
    expect(latest().get('n')).toMatchObject({ text: 'Keep me' })
    expect(announced()).toBe('1 drawing erased')
  })

  it('places a 160 by 120 rectangle with S and a click, then goes back to Select', () => {
    const board = renderEditor()
    key({ key: 's' })
    click(board, [203, 98])
    const [shape] = all()
    expect(shape).toMatchObject({
      kind: 'shape',
      x: 200,
      y: 100,
      width: 160,
      height: 120,
      data: { shape: 'rectangle' }
    })
    expect(announced()).toBe('Rectangle added')
    expect(toolButton('Select').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Rectangle' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('picks the rounded rectangle when S is pressed twice', () => {
    const board = renderEditor()
    key({ key: 's' })
    key({ key: 's' })
    expect(announced()).toBe('Shape: Rounded rectangle')
    click(board, [100, 100])
    expect(all()[0]).toMatchObject({ kind: 'shape', data: { shape: 'rounded' } })
  })

  it('picks a shape in the style controls while the Shape tool is chosen', () => {
    const board = renderEditor()
    key({ key: 's' })
    pickStyle('Shape', 'Diamond')
    click(board, [100, 100])
    expect(all()[0]).toMatchObject({ data: { shape: 'diamond' } })
  })

  it('draws a shape of the dragged size, snapped, and a square with Shift', () => {
    const board = renderEditor()
    key({ key: 's' })
    drag(board, [
      [100, 100],
      [200, 150],
      [305, 207]
    ])
    expect(all()[0]).toMatchObject({ x: 100, y: 100, width: 210, height: 110 })
    key({ key: 's' })
    drag(
      board,
      [
        [500, 100],
        [700, 180]
      ],
      { shiftKey: true }
    )
    const square = all().find((entry) => entry.x === 500)
    expect(square).toMatchObject({ y: 100, width: 200, height: 200 })
  })

  it('places a shape in the middle of the view with S and Enter', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    const board = renderEditor()
    act(() => board.focus())
    fireEvent.keyDown(board, { key: 's' })
    fireEvent.keyDown(board, { key: 'Enter' })
    // The view is 1000 × 600 at 100%: the middle is 500, 300; a shape is 160 × 120.
    expect(all()[0]).toMatchObject({ kind: 'shape', x: 420, y: 240, width: 160, height: 120 })
  })

  it('draws a frame with F and a drag, and places one with a click', () => {
    const board = renderEditor()
    key({ key: 'f' })
    drag(board, [
      [0, 0],
      [400, 300]
    ])
    expect(all()[0]).toMatchObject({ kind: 'frame', x: 0, y: 0, width: 400, height: 300 })
    expect(announced()).toBe('Frame added')
    key({ key: 'f' })
    click(board, [1000, 1000])
    expect(all().find((entry) => entry.x === 1000)).toMatchObject({
      kind: 'frame',
      width: 640,
      height: 400
    })
  })

  it('moves what a frame holds with it, by drag and by key, and nothing outside', () => {
    const frame = object({ id: 'f', kind: 'frame', text: 'Ideas', width: 640, height: 400 })
    const inside = object({ id: 'in', kind: 'note', text: 'Inside', x: 100, y: 100, z: 2 })
    const outside = object({ id: 'out', kind: 'note', text: 'Outside', x: 800, z: 3 })
    const board = renderEditor({ objects: [frame, inside, outside] })
    // The frame is picked by its title band.
    drag(board, [
      [300, 10],
      [350, 60]
    ])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(latest().get('f')).toMatchObject({ x: 50, y: 50 })
    expect(latest().get('in')).toMatchObject({ x: 150, y: 150 })
    expect(latest().get('out')).toMatchObject({ x: 800, y: 0 })
    const frameButton = screen.getByRole('button', { name: 'Frame: Ideas' })
    act(() => frameButton.focus())
    fireEvent.keyDown(frameButton, { key: 'ArrowRight' })
    expect(latest().get('f')).toMatchObject({ x: 51 })
    expect(latest().get('in')).toMatchObject({ x: 151 })
    expect(latest().get('out')).toMatchObject({ x: 800 })
  })

  it('changes a shape’s fill and stroke from the style controls, one change each', () => {
    const shape = object({ id: 'sh', kind: 'shape', width: 160, height: 120 })
    const board = renderEditor({ objects: [shape] })
    click(board, [80, 60])
    pickStyle('Fill', 'Solid')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(latest().get('sh')).toMatchObject({ data: { fill: 'solid' } })
    pickStyle('Line width', 'Thick')
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(latest().get('sh')).toMatchObject({ data: { fill: 'solid', stroke: 'thick' } })
  })

  it('edits a shape’s text on a double-click', () => {
    const shape = object({ id: 'sh', kind: 'shape', width: 160, height: 120 })
    const board = renderEditor({ objects: [shape] })
    fireEvent.doubleClick(board, { clientX: 80, clientY: 60 })
    const box = screen.getByRole('textbox', { name: 'Shape text' }) as HTMLTextAreaElement
    expect(box.style.textAlign).toBe('center')
    fireEvent.change(box, { target: { value: 'Start' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(latest().get('sh')).toMatchObject({ text: 'Start' })
  })
})

describe('moving by the border with a drawing tool (MOP-34)', () => {
  const shape = () =>
    object({ id: 's1', kind: 'shape', x: 100, y: 100, width: 200, height: 100, data: {} })

  it('moves a shape pressed on its edge, with the pen still chosen', () => {
    const board = renderEditor({ objects: [shape()] })
    key({ key: 'p' })
    pointer('pointermove', board, [100, 150])
    expect(board.classList.contains('wb-editor__board--on-border')).toBe(true)
    drag(board, [
      [100, 150],
      [140, 170]
    ])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(all()).toHaveLength(1)
    expect(latest().get('s1')).toMatchObject({ kind: 'shape' })
    expect(latest().get('s1')!.x).not.toBe(100)
    expect(toolButton('Pen').getAttribute('aria-pressed')).toBe('true')
  })

  it('draws as before inside the shape and on empty board', () => {
    const board = renderEditor({ objects: [shape()] })
    key({ key: 'p' })
    pointer('pointermove', board, [200, 150])
    expect(board.classList.contains('wb-editor__board--on-border')).toBe(false)
    drag(board, [
      [200, 150],
      [240, 170]
    ])
    expect(
      all()
        .map((each) => each.kind)
        .sort()
    ).toEqual(['pen', 'shape'])
  })
})
