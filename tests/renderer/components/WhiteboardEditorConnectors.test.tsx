// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WHITEBOARD_SHORTCUTS } from '@shared/shortcuts'
import type { ObjectMap } from '@shared/whiteboard/history'
import {
  cleanWhiteboardObject,
  type ConnectorObject,
  type WhiteboardObjectInput
} from '@shared/whiteboard/model'
import {
  WhiteboardEditor,
  type WhiteboardEditorProps
} from '@renderer/components/whiteboard/WhiteboardEditor'
import { AnnouncerProvider } from '@renderer/ui'
import { pickStyle, styleBar } from './whiteboard-style-helpers'

/**
 * The whiteboard editor's lines and arrows (docs/plans/whiteboards, prompt
 * 10). As in WhiteboardEditor.test.tsx: jsdom has no layout, so the view
 * stays at 100% with the board's origin top-left and a client point is a
 * board point.
 */

function object(fields: Record<string, unknown>): WhiteboardObjectInput {
  return cleanWhiteboardObject({ x: 0, y: 0, width: 160, height: 120, z: 1, ...fields })
}

/** Three shapes: Start at the top left, End to its right, Third below Start. */
const start = object({ id: 'a', kind: 'shape', text: 'Start' })
const end = object({ id: 'b', kind: 'shape', text: 'End', x: 400, z: 2 })
const third = object({ id: 'c', kind: 'shape', text: 'Third', y: 400, z: 3 })
/** A line from Start to End; its stored points are refreshed from the shapes. */
const line = object({
  id: 'k',
  kind: 'connector',
  x: 164,
  y: 60,
  width: 232,
  height: 0,
  z: 4,
  data: { from: { objectId: 'a', x: 164, y: 60 }, to: { objectId: 'b', x: 396, y: 60 } }
})

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

const root$ = () => document.querySelector('.wb-editor')!
const key = (init: KeyboardEventInit & { key: string }) => fireEvent.keyDown(root$(), init)
const latest = () => changes[changes.length - 1]
const connectors = () =>
  [...latest().values()].filter((entry): entry is ConnectorObject => entry.kind === 'connector')
const announced = () => document.querySelector('[data-announcer]')?.textContent?.trim() ?? ''
const toolButton = (name: string) =>
  within(screen.getByRole('toolbar', { name: 'Tools' })).getByRole('button', { name })
const objectElement = (id: string) =>
  document.querySelector<SVGGElement>(`[data-object-id="${id}"]`)!

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  changes = []
  onChange.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the connector tool', () => {
  it('lists the new keys in the shortcut table', () => {
    const keys = Object.fromEntries(WHITEBOARD_SHORTCUTS.map((entry) => [entry.id, entry.keys]))
    expect(keys).toMatchObject({ connector: 'A', 'connect-to': 'C' })
  })

  it('draws an arrow stuck to both shapes with one change, previewing it on the way', () => {
    const board = renderEditor({ objects: [start, end] })
    key({ key: 'a' })
    expect(toolButton('Line or arrow').getAttribute('aria-pressed')).toBe('true')
    pointer('pointerdown', board, [80, 60], { button: 0 })
    pointer('pointermove', board, [300, 60])
    pointer('pointermove', board, [480, 60])
    // A live line, and End outlined as what the end will stick to; nothing committed yet.
    expect(document.querySelector('.wb-editor__drawing path')).not.toBeNull()
    expect(document.querySelector('[data-attach-target]')).not.toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    pointer('pointerup', board, [480, 60])
    expect(onChange).toHaveBeenCalledTimes(1)
    const [arrow] = connectors()
    expect(arrow).toMatchObject({
      colour: 'black',
      data: {
        from: { objectId: 'a' },
        to: { objectId: 'b' },
        route: 'straight',
        startHead: 'none',
        endHead: 'arrow',
        stroke: 'medium',
        dashed: false
      }
    })
    // Its box runs from Start's right side to End's left side.
    expect(arrow.x).toBeGreaterThanOrEqual(160)
    expect(arrow.x + arrow.width).toBeLessThanOrEqual(400)
    expect(announced()).toBe('Arrow from Start to End added')
    expect(document.querySelector('.wb-editor__drawing')).toBeNull()
    expect(toolButton('Line or arrow').getAttribute('aria-pressed')).toBe('true')
  })

  it('leaves the end free, snapped, when the drag ends on empty board', () => {
    const board = renderEditor({ objects: [start, end] })
    key({ key: 'a' })
    drag(board, [
      [80, 60],
      [300, 303]
    ])
    expect(connectors()[0].data).toMatchObject({
      from: { objectId: 'a' },
      to: { objectId: null, x: 300, y: 300 }
    })
  })

  it('makes nothing from a click without movement', () => {
    const board = renderEditor({ objects: [start, end] })
    key({ key: 'a' })
    drag(board, [[80, 60]])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('draws with the style picked in the style controls while the tool is chosen', () => {
    const board = renderEditor({ objects: [start, end] })
    key({ key: 'a' })
    pickStyle('Line', 'Elbow')
    fireEvent.click(within(styleBar()).getByRole('button', { name: 'Dashed' }))
    expect(onChange).not.toHaveBeenCalled()
    drag(board, [
      [80, 60],
      [480, 60]
    ])
    expect(connectors()[0].data).toMatchObject({ route: 'elbow', dashed: true })
  })

  it('moves a stuck end with its shape in the same change', () => {
    const board = renderEditor({ objects: [start, end, line] })
    drag(board, [
      [480, 60],
      [480, 260]
    ])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(latest().get('b')).toMatchObject({ y: 200 })
    const moved = latest().get('k') as ConnectorObject
    expect(moved.data.to.objectId).toBe('b')
    expect(moved.data.to.y).toBeGreaterThan(150)
  })

  it('does not move a connector with a stuck end on its own, but moves a free one', () => {
    const free = object({
      id: 'f',
      kind: 'connector',
      x: 0,
      y: 700,
      width: 200,
      height: 0,
      data: { from: { objectId: null, x: 0, y: 700 }, to: { objectId: null, x: 200, y: 700 } }
    })
    const board = renderEditor({ objects: [start, end, line, free] })
    drag(board, [
      [280, 60],
      [280, 200]
    ])
    expect(onChange).not.toHaveBeenCalled()
    expect(objectElement('k').getAttribute('aria-pressed')).toBe('true')
    drag(board, [
      [100, 700],
      [100, 750]
    ])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect((latest().get('f') as ConnectorObject).data.from).toMatchObject({ x: 0, y: 750 })
  })

  it('sticks an end to a third shape when its handle is dragged there', () => {
    const board = renderEditor({ objects: [start, end, third, line] })
    drag(board, [[280, 60]])
    // A selected connector has a handle at each end and no resize handles.
    expect(document.querySelectorAll('[data-end]')).toHaveLength(2)
    expect(document.querySelector('[data-handle]')).toBeNull()
    const handle = document.querySelector('[data-end="to"]')!
    pointer('pointerdown', handle, [396, 60], { button: 0 })
    pointer('pointermove', board, [200, 300])
    pointer('pointermove', board, [80, 460])
    expect(document.querySelector('[data-attach-target]')).not.toBeNull()
    pointer('pointerup', board, [80, 460])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect((latest().get('k') as ConnectorObject).data).toMatchObject({
      from: { objectId: 'a' },
      to: { objectId: 'c' }
    })
  })

  it('changes the line, the arrow heads and the dashes from the style controls, one change each', () => {
    const board = renderEditor({ objects: [start, end, line] })
    drag(board, [[280, 60]])
    pickStyle('Line', 'Elbow')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(latest().get('k')).toMatchObject({ data: { route: 'elbow' } })
    pickStyle('Arrow heads', 'Both')
    expect(latest().get('k')).toMatchObject({ data: { startHead: 'arrow', endHead: 'arrow' } })
    pickStyle('Arrow heads', 'At the start')
    expect(latest().get('k')).toMatchObject({ data: { startHead: 'arrow', endHead: 'none' } })
    pickStyle('Arrow heads', 'None')
    expect(latest().get('k')).toMatchObject({ data: { startHead: 'none', endHead: 'none' } })
    const dashed = within(styleBar()).getByRole('button', { name: 'Dashed' })
    expect(dashed.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(dashed)
    expect(latest().get('k')).toMatchObject({ data: { dashed: true } })
    pickStyle('Line width', 'Thick')
    expect(latest().get('k')).toMatchObject({ data: { stroke: 'thick' } })
    expect(onChange).toHaveBeenCalledTimes(6)
  })

  it('edits the label on a double-click, and with Enter', () => {
    const board = renderEditor({ objects: [start, end, line] })
    fireEvent.doubleClick(board, { clientX: 280, clientY: 60 })
    const box = screen.getByRole('textbox', { name: 'Line label' })
    // The line stays drawn while its label is edited.
    expect(objectElement('k')).not.toBeNull()
    fireEvent.change(box, { target: { value: 'Next' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(latest().get('k')).toMatchObject({ text: 'Next' })
    const element = objectElement('k')
    act(() => element.focus())
    fireEvent.keyDown(element, { key: 'Enter' })
    const again = screen.getByRole('textbox', { name: 'Line label' })
    fireEvent.change(again, { target: { value: 'Then' } })
    fireEvent.keyDown(again, { key: 'Escape' })
    expect(latest().get('k')).toMatchObject({ text: 'Then' })
  })

  it('connects a note to a shape with C and Connect to…, then returns focus to the note', () => {
    const note = object({ id: 'n', kind: 'note', text: 'Idea', y: 200, width: 200, height: 200 })
    renderEditor({ objects: [note, end, third] })
    const noteElement = objectElement('n')
    act(() => noteElement.focus())
    fireEvent.keyDown(noteElement, { key: 'c' })
    const dialog = screen.getByRole('dialog', { name: 'Connect to another object' })
    // The other objects, by their spoken names; the filter narrows them.
    expect(within(dialog).getAllByRole('radio')).toHaveLength(2)
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Filter' }), {
      target: { value: 'end' }
    })
    expect(within(dialog).getAllByRole('radio')).toHaveLength(1)
    const connect = within(dialog).getByRole('button', { name: 'Connect' })
    expect((connect as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Rectangle: End' }))
    fireEvent.click(connect)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(connectors()[0].data).toMatchObject({
      from: { objectId: 'n' },
      to: { objectId: 'b' },
      endHead: 'arrow'
    })
    expect(announced()).toBe('Arrow from Idea to End added')
    expect(document.activeElement).toBe(objectElement('n'))
  })

  it('keeps the line just drawn selected, so Elbow changes it', () => {
    const board = renderEditor({ objects: [start, end] })
    key({ key: 'a' })
    drag(board, [
      [80, 60],
      [480, 60]
    ])
    const [drawn] = connectors()
    expect(objectElement(drawn.id).getAttribute('aria-pressed')).toBe('true')
    pickStyle('Line', 'Elbow')
    expect(latest().get(drawn.id)).toMatchObject({ data: { route: 'elbow' } })
  })

  it('adds a bend point by dragging the handle halfway along, and removes it with a double-click', () => {
    const board = renderEditor({ objects: [start, end, line] })
    drag(board, [[280, 60]])
    // A straight line has one stretch, so one handle halfway along it and no bend points.
    expect(document.querySelectorAll('[data-split]')).toHaveLength(1)
    expect(document.querySelectorAll('[data-via]')).toHaveLength(0)
    const split = document.querySelector('[data-split="0"]')!
    pointer('pointerdown', split, [280, 60], { button: 0 })
    pointer('pointermove', board, [280, 160])
    pointer('pointerup', board, [280, 160])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect((latest().get('k') as ConnectorObject).data.via).toEqual([{ x: 280, y: 160 }])
    expect(announced()).toBe('Bend point added.')
    // Now two stretches, and the bend point between them.
    expect(document.querySelectorAll('[data-split]')).toHaveLength(2)
    const bend = document.querySelector('[data-via="0"]')!
    fireEvent.doubleClick(bend, { clientX: 280, clientY: 160 })
    expect((latest().get('k') as ConnectorObject).data.via).toBeUndefined()
    expect(announced()).toBe('Bend point removed.')
  })

  it('adds a bend point and straightens the line from the right-click menu', () => {
    const board = renderEditor({ objects: [start, end, line] })
    fireEvent.contextMenu(board, { clientX: 280, clientY: 62 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add a bend point here' }))
    expect((latest().get('k') as ConnectorObject).data.via).toEqual([{ x: 280, y: 60 }])
    fireEvent.contextMenu(board, { clientX: 280, clientY: 62 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Straighten the line' }))
    expect((latest().get('k') as ConnectorObject).data.via).toBeUndefined()
  })

  it('opens Connect to… from the style controls too, and Cancel makes nothing', () => {
    const board = renderEditor({ objects: [start, end] })
    drag(board, [[80, 60]])
    fireEvent.click(within(styleBar()).getByRole('button', { name: 'Connect to…' }))
    const dialog = screen.getByRole('dialog', { name: 'Connect to another object' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('frees the end when its shape is deleted', () => {
    renderEditor({ objects: [start, end, line] })
    const shape = objectElement('b')
    act(() => shape.focus())
    fireEvent.keyDown(shape, { key: 'Delete' })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(latest().has('b')).toBe(false)
    expect((latest().get('k') as ConnectorObject).data).toMatchObject({
      from: { objectId: 'a' },
      to: { objectId: null }
    })
  })
})

describe('the node tool (MOP-27)', () => {
  it('shows every object’s node points and pins both ends of a line to them', () => {
    const board = renderEditor({ objects: [start, end] })
    expect(document.querySelectorAll('.wb-node')).toHaveLength(0)
    key({ key: 'j' })
    expect(
      toolButton('Node: join objects at the middle of their sides').getAttribute('aria-pressed')
    ).toBe('true')
    expect(document.querySelectorAll('.wb-node')).toHaveLength(8)
    // From Start's bottom node to End's top node, the target node lit on the way.
    pointer('pointerdown', board, [80, 121], { button: 0 })
    pointer('pointermove', board, [300, 30])
    pointer('pointermove', board, [481, 2])
    expect(document.querySelectorAll('.wb-node--hot')).toHaveLength(1)
    pointer('pointerup', board, [481, 2])
    const [made] = connectors()
    expect(made.data.from).toMatchObject({ objectId: 'a', node: 'bottom' })
    expect(made.data.to).toMatchObject({ objectId: 'b', node: 'top' })
    expect(document.querySelectorAll('.wb-node--hot')).toHaveLength(0)
  })

  it('pins a dragged end of a line to a node point', () => {
    const board = renderEditor({ objects: [start, end, line] })
    key({ key: 'v' })
    pointer('pointerdown', objectElement('k'), [280, 60], { button: 0 })
    pointer('pointerup', board, [280, 60])
    const handle = document.querySelector('[data-end="to"]')!
    pointer('pointerdown', handle, [396, 60], { button: 0 })
    pointer('pointermove', board, [440, 20])
    // The node points show while the end moves.
    expect(document.querySelectorAll('.wb-node').length).toBeGreaterThan(0)
    pointer('pointermove', board, [480, 1])
    pointer('pointerup', board, [480, 1])
    const [moved] = connectors()
    expect(moved.data.to).toMatchObject({ objectId: 'b', node: 'top' })
  })
})
