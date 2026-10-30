// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WHITEBOARD_SHORTCUTS } from '@shared/shortcuts'
import { refreshConnectors } from '@shared/whiteboard/connectors'
import type { ObjectMap } from '@shared/whiteboard/history'
import { cleanWhiteboardObject, type WhiteboardObjectInput } from '@shared/whiteboard/model'
import {
  WhiteboardEditor,
  type WhiteboardEditorProps
} from '@renderer/components/whiteboard/WhiteboardEditor'
import { AnnouncerProvider } from '@renderer/ui'

/**
 * The whiteboard editor (docs/plans/whiteboards, prompt 05). jsdom has no
 * layout: the board's rect is at 0, 0 with no size, so the view stays at
 * 100% with the board's origin at the top-left, and a client point is a
 * board point. jsdom's pointer events drop clientX and clientY, so the
 * tests dispatch `new MouseEvent('pointerdown', …)`, which React handles as
 * a pointer event.
 */

function object(fields: Record<string, unknown>): WhiteboardObjectInput {
  return cleanWhiteboardObject({ x: 0, y: 0, width: 200, height: 200, z: 1, ...fields })
}

const noteA = object({ id: 'a', kind: 'note', text: 'Buy milk', z: 1 })
const noteB = object({ id: 'b', kind: 'note', text: 'Call Sam', x: 300, z: 2 })
const shape = object({
  id: 's',
  kind: 'shape',
  text: 'Start',
  x: 600,
  width: 160,
  height: 120,
  z: 3,
  data: { shape: 'diamond' }
})
const line = object({
  id: 'c',
  kind: 'connector',
  x: 200,
  y: 100,
  width: 100,
  height: 0,
  z: 4,
  data: {
    from: { objectId: 'a', x: 200, y: 100 },
    to: { objectId: 'b', x: 300, y: 100 },
    endHead: 'arrow'
  }
})
const groupOne = object({ id: 'g1', kind: 'note', text: 'One', y: 400, z: 5, groupId: 'grp' })
const groupTwo = object({
  id: 'g2',
  kind: 'note',
  text: 'Two',
  x: 300,
  y: 400,
  z: 6,
  groupId: 'grp'
})
const root = object({
  id: 'root',
  kind: 'mindmap',
  text: 'Plan',
  y: 800,
  height: 64,
  z: 7,
  data: { parentId: null }
})
const child = object({
  id: 'kid',
  kind: 'mindmap',
  text: 'Budget',
  x: 300,
  y: 800,
  width: 160,
  height: 48,
  z: 8,
  data: { parentId: 'root', order: 0 }
})

const BOARD = [noteA, noteB, shape, line, groupOne, groupTwo, root, child]

let changes: ObjectMap[] = []
const onChange = vi.fn((present: ObjectMap) => changes.push(present))
const outerKeys = vi.fn()

function editor(props: Partial<WhiteboardEditorProps> = {}) {
  return (
    <AnnouncerProvider>
      <div onKeyDown={outerKeys}>
        <WhiteboardEditor
          title="Launch"
          objects={BOARD}
          version={1}
          onChange={onChange}
          imageUrl={() => null}
          {...props}
        />
      </div>
    </AnnouncerProvider>
  )
}

function renderEditor(props: Partial<WhiteboardEditorProps> = {}) {
  const view = render(editor(props))
  return { ...view, board: screen.getByRole('group', { name: 'Whiteboard: Launch' }) }
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

function drag(
  board: Element,
  from: [number, number],
  to: [number, number],
  init: MouseEventInit = {},
  start: Element = board
) {
  pointer('pointerdown', start, from, { button: 0, ...init })
  pointer('pointermove', board, to, init)
  pointer('pointerup', board, to, init)
}

function click(board: Element, at: [number, number], init: MouseEventInit = {}) {
  drag(board, at, at, init)
}

/** Focus, as Tab or a click would give it: the object is selected on focus. */
function focus(element: HTMLElement | SVGElement) {
  act(() => element.focus())
}

const objectButton = (name: string) => screen.getByRole('button', { name })
const pressed = (name: string) => objectButton(name).getAttribute('aria-pressed') === 'true'
const latest = () => changes[changes.length - 1]
const root$ = () => document.querySelector('.wb-editor')!
const announced = () => document.querySelector('[data-announcer]')?.textContent?.trim() ?? ''
const zoomLabel = () =>
  within(screen.getByRole('toolbar', { name: 'Zoom' })).getByRole('button', {
    name: /zoom to 100%$/
  }).textContent

beforeEach(() => {
  // jsdom has no canvas: text is measured by estimate.
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  changes = []
  onChange.mockClear()
  outerKeys.mockClear()
})

describe('the whiteboard editor', () => {
  it('names the Select and Hand tools, with their keys from the table', () => {
    renderEditor()
    const tools = screen.getByRole('toolbar', { name: 'Tools' })
    expect(within(tools).getByRole('button', { name: 'Select' })).toBeTruthy()
    expect(
      within(tools).getByRole('button', { name: 'Hand: move around the whiteboard' })
    ).toBeTruthy()
    const keys = Object.fromEntries(WHITEBOARD_SHORTCUTS.map((entry) => [entry.id, entry.keys]))
    expect(keys.select).toBe('V')
    expect(keys.hand).toBe('H')
  })

  it('switches tools with V and H, and keeps the keys from the app', () => {
    renderEditor()
    const hand = screen.getByRole('button', { name: 'Hand: move around the whiteboard' })
    const select = screen.getByRole('button', { name: 'Select' })
    expect(select.getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(root$(), { key: 'h' })
    expect(hand.getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(root$(), { key: 'v' })
    expect(select.getAttribute('aria-pressed')).toBe('true')
    expect(outerKeys).not.toHaveBeenCalled()
    // A key the editor does not handle reaches the app.
    fireEvent.keyDown(root$(), { key: 'q' })
    expect(outerKeys).toHaveBeenCalledTimes(1)
  })

  it('selects with a click, adds with Shift+click and clears with a click on empty board', () => {
    const { board } = renderEditor()
    click(board, [50, 50])
    expect(pressed('Note: Buy milk')).toBe(true)
    expect(announced()).toBe('1 object selected')
    click(board, [350, 50], { shiftKey: true })
    expect(pressed('Note: Buy milk')).toBe(true)
    expect(pressed('Note: Call Sam')).toBe(true)
    expect(announced()).toBe('2 objects selected')
    click(board, [1500, 1500])
    expect(pressed('Note: Buy milk')).toBe(false)
    expect(pressed('Note: Call Sam')).toBe(false)
    expect(announced()).toBe('Nothing selected')
  })

  it('selects what lies inside a box dragged on empty board', () => {
    const { board } = renderEditor()
    drag(board, [-10, -10], [520, 220])
    expect(pressed('Note: Buy milk')).toBe(true)
    expect(pressed('Note: Call Sam')).toBe(true)
    expect(pressed('Arrow from Buy milk to Call Sam')).toBe(true)
    expect(pressed('Diamond: Start')).toBe(false)
  })

  it('moves a dragged note by a snapped amount, committing once, and its arrow follows', () => {
    const { board } = renderEditor()
    drag(board, [50, 50], [73, 58])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(latest().get('a')).toMatchObject({ x: 20, y: 10 })
    // The connector stuck to it moved in the same commit.
    expect(latest().get('c')).not.toEqual(line)
    expect(refreshConnectors([...latest().values()])).toEqual([])
    expect(announced()).toBe('Moved')
  })

  it('outlines a selected group with its tag, and Ctrl+click picks and moves one of it', () => {
    const { board } = renderEditor()
    click(board, [50, 450])
    expect(document.querySelectorAll('.wb-group-outline')).toHaveLength(1)
    expect(document.querySelector('.wb-group-tag-text')?.textContent).toBe(
      'Group · Ctrl+click picks one object'
    )
    click(board, [50, 450], { ctrlKey: true })
    expect(pressed('Note: One, in a group')).toBe(true)
    expect(pressed('Note: Two, in a group')).toBe(false)
    expect(document.querySelector('.wb-group-outline')).toBeNull()
    drag(board, [50, 450], [80, 450], { ctrlKey: true })
    expect(latest().get('g1')).toMatchObject({ x: 30, y: 400 })
    expect(latest().get('g2')).toMatchObject({ x: 300, y: 400 })
  })

  it('moves freely with Alt held', () => {
    const { board } = renderEditor()
    drag(board, [50, 50], [73, 58], { altKey: true })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(latest().get('a')).toMatchObject({ x: 23, y: 8 })
  })

  it('moves a group together', () => {
    const { board } = renderEditor()
    drag(board, [50, 450], [80, 450])
    expect(latest().get('g1')).toMatchObject({ x: 30, y: 400 })
    expect(latest().get('g2')).toMatchObject({ x: 330, y: 400 })
    expect(pressed('Note: Two, in a group')).toBe(true)
  })

  it('moves the selection with the arrow keys, 1 at a time or 10 with Shift', () => {
    renderEditor()
    const note = objectButton('Note: Buy milk')
    focus(note)
    expect(pressed('Note: Buy milk')).toBe(true)
    fireEvent.keyDown(note, { key: 'ArrowRight' })
    expect(latest().get('a')).toMatchObject({ x: 1, y: 0 })
    fireEvent.keyDown(note, { key: 'ArrowDown', shiftKey: true })
    expect(latest().get('a')).toMatchObject({ x: 1, y: 10 })
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(outerKeys).not.toHaveBeenCalled()
  })

  it('resizes the selected object with Alt and the arrow keys', () => {
    renderEditor()
    const note = objectButton('Note: Buy milk')
    focus(note)
    fireEvent.keyDown(note, { key: 'ArrowRight', altKey: true })
    expect(latest().get('a')).toMatchObject({ x: 0, y: 0, width: 201, height: 200 })
    fireEvent.keyDown(note, { key: 'ArrowDown', altKey: true, shiftKey: true })
    expect(latest().get('a')).toMatchObject({ width: 201, height: 210 })
    expect(announced()).toBe('Resized')
    // Alt+Left is the app's Back key elsewhere: here it resized, and the app never saw it.
    expect(outerKeys).not.toHaveBeenCalled()
  })

  it('resizes with a handle, keeping the shape with Shift', () => {
    const { board } = renderEditor()
    click(board, [50, 50])
    const corner = document.querySelector('[data-handle="se"]')!
    expect(corner.closest('[aria-hidden="true"]')).toBeTruthy()
    drag(board, [200, 200], [300, 250], { shiftKey: true }, corner)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(latest().get('a')).toMatchObject({ x: 0, y: 0, width: 300, height: 300 })
  })

  it('deletes the selection and frees a connector stuck to it', () => {
    renderEditor()
    const note = objectButton('Note: Buy milk')
    focus(note)
    fireEvent.keyDown(note, { key: 'Delete' })
    expect(latest().has('a')).toBe(false)
    const connector = latest().get('c')!
    expect(connector.kind === 'connector' && connector.data.from.objectId).toBe(null)
    expect(screen.queryByRole('button', { name: 'Note: Buy milk' })).toBeNull()
    expect(announced()).toBe('Deleted 1 object')
  })

  it('deletes a mind-map node with its branch', () => {
    renderEditor()
    const idea = objectButton('Central idea: Plan, 1 branch')
    focus(idea)
    fireEvent.keyDown(idea, { key: 'Backspace' })
    expect(latest().has('root')).toBe(false)
    expect(latest().has('kid')).toBe(false)
    expect(announced()).toBe('Deleted 2 objects')
  })

  it('undoes with Ctrl+Z and redoes with Ctrl+Y', () => {
    const { board } = renderEditor()
    drag(board, [50, 50], [80, 50])
    expect(latest().get('a')).toMatchObject({ x: 30 })
    fireEvent.keyDown(root$(), { key: 'z', ctrlKey: true })
    expect(latest().get('a')).toMatchObject({ x: 0 })
    expect(announced()).toBe('Undone')
    fireEvent.keyDown(root$(), { key: 'y', ctrlKey: true })
    expect(latest().get('a')).toMatchObject({ x: 30 })
    expect(announced()).toBe('Redone')
    fireEvent.keyDown(root$(), { key: 'Z', ctrlKey: true, shiftKey: true })
    expect(onChange).toHaveBeenCalledTimes(3)
    expect(outerKeys).not.toHaveBeenCalled()
  })

  it("moves a mind map's children with its central idea, and an idea on its own with its branch", () => {
    const { board } = renderEditor()
    drag(board, [50, 820], [90, 820])
    expect(latest().get('root')).toMatchObject({ x: 40, y: 800 })
    expect(latest().get('kid')).toMatchObject({ x: 340, y: 800 })
    onChange.mockClear()
    drag(board, [380, 820], [480, 820])
    expect(onChange).toHaveBeenCalledTimes(1)
    // The idea keeps the place it was dragged to; the central idea stays put.
    expect(latest().get('kid')).toMatchObject({ x: 440, y: 800, data: { free: true } })
    expect(latest().get('root')).toMatchObject({ x: 40, y: 800 })
    expect(pressed('Idea: Budget, level 1, 1 of 1')).toBe(true)
  })

  it('moves focus through the objects in reading order with Tab, and leaves after the last', () => {
    renderEditor()
    const first = objectButton('Note: Buy milk')
    expect(first.getAttribute('tabindex')).toBe('0')
    expect(objectButton('Note: Call Sam').getAttribute('tabindex')).toBe('-1')
    focus(first)
    const names: string[] = []
    for (let step = 0; step < 7; step += 1) {
      const allowed = fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
      expect(allowed).toBe(false)
      names.push(document.activeElement!.getAttribute('aria-label')!)
    }
    expect(names).toEqual([
      'Note: Call Sam',
      'Diamond: Start',
      'Arrow from Buy milk to Call Sam',
      'Note: One, in a group',
      'Note: Two, in a group',
      'Central idea: Plan, 1 branch',
      'Idea: Budget, level 1, 1 of 1'
    ])
    // From the last object Tab is left to the browser, which moves focus past the board.
    expect(fireEvent.keyDown(document.activeElement!, { key: 'Tab' })).toBe(true)
    // Shift+Tab goes back.
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement!.getAttribute('aria-label')).toBe('Central idea: Plan, 1 branch')
  })

  it('skips past the whiteboard with the skip link', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Skip past the whiteboard' }))
    expect(document.activeElement).toBe(document.querySelector('[data-skip-target]'))
  })

  it('zooms with + and -, resets with Shift+0, and leaves Ctrl+= to the app', () => {
    renderEditor()
    expect(zoomLabel()).toBe('100%')
    fireEvent.keyDown(root$(), { key: '+' })
    expect(zoomLabel()).toBe('125%')
    expect(announced()).toBe('Zoom 125%')
    fireEvent.keyDown(root$(), { key: '-' })
    fireEvent.keyDown(root$(), { key: '-' })
    expect(zoomLabel()).toBe('75%')
    fireEvent.keyDown(root$(), { key: ')', code: 'Digit0', shiftKey: true })
    expect(zoomLabel()).toBe('100%')
    outerKeys.mockClear()
    for (const key of ['=', '-', '0']) {
      expect(fireEvent.keyDown(root$(), { key, ctrlKey: true })).toBe(true)
    }
    expect(zoomLabel()).toBe('100%')
    expect(outerKeys).toHaveBeenCalledTimes(3)
  })

  it('fits the objects on the first load and with Shift+1', () => {
    // Give the board a size: 1000 × 800 screen pixels.
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
    try {
      renderEditor()
      // The objects span 760 × 864 units; 48 pixels of padding leave 904 × 704.
      expect(zoomLabel()).toBe('81%')
      fireEvent.keyDown(root$(), { key: '+' })
      expect(zoomLabel()).toBe('100%')
      fireEvent.keyDown(root$(), { key: '!', code: 'Digit1', shiftKey: true })
      expect(zoomLabel()).toBe('81%')
      expect(announced()).toBe('Zoom 81%')
    } finally {
      width.mockRestore()
      height.mockRestore()
    }
  })

  it('pans with the Hand tool', () => {
    const { board } = renderEditor()
    fireEvent.keyDown(root$(), { key: 'h' })
    drag(board, [100, 100], [150, 120])
    expect(onChange).not.toHaveBeenCalled()
    // The board moved with the pointer: the view's top-left is now at -50, -20.
    const svg = board.querySelector('svg')!
    expect(svg.getAttribute('viewBox')!.split(' ').slice(0, 2)).toEqual(['-50', '-20'])
  })

  it('blocks moving, resizing and deleting when read-only, but keeps objects named and focusable', () => {
    const { board } = renderEditor({ readOnly: true })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Redo' })).toBeNull()
    drag(board, [50, 50], [90, 90])
    expect(pressed('Note: Buy milk')).toBe(true)
    expect(document.querySelector('[data-handle]')).toBeNull()
    const note = objectButton('Note: Buy milk')
    focus(note)
    fireEvent.keyDown(note, { key: 'ArrowRight' })
    fireEvent.keyDown(note, { key: 'Delete' })
    fireEvent.keyDown(note, { key: 'ArrowRight', altKey: true })
    expect(onChange).not.toHaveBeenCalled()
    expect(objectButton('Note: Buy milk')).toBeTruthy()
  })

  it('keeps undo and redo in their own bar on the board, not the top bar', () => {
    renderEditor()
    const history = screen.getByRole('toolbar', { name: 'Undo and redo' })
    expect(within(history).getByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(within(history).getByRole('button', { name: 'Redo' })).toBeTruthy()
    const zoomBar = screen.getByRole('toolbar', { name: 'Zoom' })
    expect(within(zoomBar).queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(history.closest('.wb-editor__stage')).not.toBeNull()
  })

  it('replaces the objects and clears undo on a new version', () => {
    const { board, rerender } = renderEditor()
    drag(board, [50, 50], [80, 50])
    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement
    expect(undo.disabled).toBe(false)
    const fresh = object({ id: 'n', kind: 'note', text: 'Fresh start' })
    rerender(editor({ objects: [fresh], version: 2 }))
    expect(objectButton('Note: Fresh start')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Note: Buy milk' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(root$(), { key: 'z', ctrlKey: true })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(objectButton('Note: Fresh start').getAttribute('aria-pressed')).toBe('false')
  })
})
