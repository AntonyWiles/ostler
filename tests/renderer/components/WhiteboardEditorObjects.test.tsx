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
import { clearCopiedWhiteboardObjects } from '@renderer/components/whiteboard/whiteboard-clipboard'
import { AnnouncerProvider } from '@renderer/ui'
import {
  chosenOption,
  isOffered,
  pickColour,
  pickStyle,
  styleBar,
  styleControl
} from './whiteboard-style-helpers'

/**
 * The whiteboard editor's notes, text, style controls, Arrange, Duplicate and
 * copy and paste (docs/plans/whiteboards, prompt 06). As in
 * WhiteboardEditor.test.tsx: jsdom has no layout, so the view stays at 100%
 * with the board's origin top-left and a client point is a board point.
 */

function object(fields: Record<string, unknown>): WhiteboardObjectInput {
  return cleanWhiteboardObject({ x: 0, y: 0, width: 200, height: 200, z: 1, ...fields })
}

const noteA = object({ id: 'a', kind: 'note', text: 'Buy milk', z: 1 })
const noteB = object({ id: 'b', kind: 'note', text: 'Call Sam', x: 300, z: 2 })
const noteC = object({ id: 'n3', kind: 'note', text: 'Pay rent', x: 900, y: 40, z: 3 })
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
const words = object({
  id: 't',
  kind: 'text',
  text: 'Heading',
  y: 600,
  width: 240,
  height: 32,
  z: 5
})
const picture = object({ id: 'p', kind: 'image', x: 0, y: 300, z: 6, data: { imageItemId: 'pic' } })

const BOARD = [noteA, noteB, noteC, line, words]

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

function click(board: Element, at: [number, number], init: MouseEventInit = {}) {
  pointer('pointerdown', board, at, { button: 0, ...init })
  pointer('pointerup', board, at, init)
}

function focus(element: HTMLElement | SVGElement) {
  act(() => element.focus())
}

/** A clipboard event as Chromium (or Ostler's off-screen preload) sends it. */
function clipboardEvent(type: 'copy' | 'cut' | 'paste', text = '') {
  const store = new Map<string, string>([['text/plain', text]])
  const clipboardData = {
    setData: vi.fn((format: string, value: string) => store.set(format, value)),
    getData: (format: string) => store.get(format) ?? ''
  }
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: clipboardData })
  return { event, clipboardData, text: () => store.get('text/plain') }
}

function dispatchOnFocus(event: Event) {
  act(() => {
    ;(document.activeElement ?? document.body).dispatchEvent(event)
  })
}

const objectButton = (name: string) => screen.getByRole('button', { name })
const latest = () => changes[changes.length - 1]
const root$ = () => document.querySelector('.wb-editor')!
const announced = () => document.querySelector('[data-announcer]')?.textContent?.trim() ?? ''
const textBox = (name: string) => screen.getByRole('textbox', { name }) as HTMLTextAreaElement
const undoButton = () => screen.getByRole('button', { name: 'Undo' })
const key = (init: KeyboardEventInit & { key: string }) => fireEvent.keyDown(root$(), init)
const added = (before: Iterable<string>) => {
  const old = new Set(before)
  return [...latest().values()].filter((entry) => !old.has(entry.id))
}

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  changes = []
  onChange.mockClear()
  outerKeys.mockClear()
  clearCopiedWhiteboardObjects()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('notes and text on the whiteboard', () => {
  it('lists the new keys in the shortcut table', () => {
    const keys = Object.fromEntries(WHITEBOARD_SHORTCUTS.map((entry) => [entry.id, entry.keys]))
    expect(keys).toMatchObject({
      note: 'N',
      text: 'T',
      place: 'Enter',
      'edit-text': 'Enter',
      'finish-text': 'Ctrl+Enter',
      duplicate: 'Ctrl+D',
      group: 'Ctrl+G',
      ungroup: 'Ctrl+Shift+G',
      'bring-to-front': 'Ctrl+Shift+]',
      'send-to-back': 'Ctrl+Shift+['
    })
  })

  it('places a 200 by 200 yellow note with N and a click, and opens its text box', () => {
    const { board } = renderEditor()
    key({ key: 'n' })
    const tools = screen.getByRole('toolbar', { name: 'Tools' })
    expect(
      within(tools).getByRole('button', { name: 'Sticky note' }).getAttribute('aria-pressed')
    ).toBe('true')
    click(board, [512, 407])
    const [note] = added(BOARD.map((entry) => entry.id))
    expect(note).toMatchObject({
      kind: 'note',
      x: 510,
      y: 410,
      width: 200,
      height: 200,
      colour: 'yellow'
    })
    const box = textBox('Note text')
    expect(document.activeElement).toBe(box)
    expect(announced()).toBe('Note added')
    // The tool goes back to Select.
    expect(within(tools).getByRole('button', { name: 'Select' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('makes a new note and the words typed into it one undo step', () => {
    const { board } = renderEditor()
    key({ key: 'n' })
    click(board, [500, 400])
    const box = textBox('Note text')
    fireEvent.change(box, { target: { value: 'I' } })
    fireEvent.change(box, { target: { value: 'Id' } })
    fireEvent.change(box, { target: { value: 'Idea' } })
    // Enter is a new line in a note.
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.queryByRole('textbox')).not.toBeNull()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.activeElement).toBe(objectButton('Note: Idea'))
    fireEvent.keyDown(root$(), { key: 'z', ctrlKey: true })
    expect(latest().size).toBe(BOARD.length)
    expect((undoButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('edits an existing note on a double-click, and the edit is one undo step', () => {
    const { board } = renderEditor()
    fireEvent.doubleClick(board, { clientX: 50, clientY: 50 })
    const box = textBox('Note text')
    expect(box.value).toBe('Buy milk')
    // The note is hidden from the scene while its words are in the box.
    expect(screen.queryByRole('button', { name: 'Note: Buy milk' })).toBeNull()
    fireEvent.change(box, { target: { value: 'Buy milk!' } })
    fireEvent.change(box, { target: { value: 'Buy oat milk!' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    expect(latest().get('a')).toMatchObject({ text: 'Buy oat milk!' })
    fireEvent.keyDown(root$(), { key: 'z', ctrlKey: true })
    expect(latest().get('a')).toMatchObject({ text: 'Buy milk' })
    expect((undoButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('edits the focused object with Enter, and a click outside ends editing', () => {
    const { board } = renderEditor()
    const note = objectButton('Note: Call Sam')
    focus(note)
    fireEvent.keyDown(note, { key: 'Enter' })
    const box = textBox('Note text')
    expect(box.value).toBe('Call Sam')
    click(board, [1500, 1500])
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.activeElement).toBe(objectButton('Note: Call Sam'))
  })

  it('places a text in the middle of the view with T and Enter', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    const { board } = renderEditor({ objects: [] })
    focus(board)
    fireEvent.keyDown(board, { key: 't' })
    fireEvent.keyDown(board, { key: 'Enter' })
    const [text] = [...latest().values()]
    // The view is 1000 × 600 at 100%: the middle is 500, 300; a text is 240 × 32.
    expect(text).toMatchObject({ kind: 'text', x: 380, y: 280, width: 240 })
    const box = textBox('Text')
    fireEvent.change(box, { target: { value: 'Launch plan' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(latest().get(text.id)).toMatchObject({ text: 'Launch plan' })
  })

  it('removes a new text left empty when editing ends, leaving nothing to undo', () => {
    const { board } = renderEditor()
    key({ key: 't' })
    click(board, [500, 400])
    const box = textBox('Text')
    fireEvent.change(box, { target: { value: ' ' } })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(latest().size).toBe(BOARD.length)
    expect([...latest().values()].some((entry) => entry.y === 400)).toBe(false)
    expect((undoButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('grows a text object to its words', () => {
    renderEditor()
    const text = objectButton('Text: Heading')
    focus(text)
    fireEvent.keyDown(text, { key: 'Enter' })
    const box = textBox('Text')
    fireEvent.change(box, {
      target: { value: 'A heading long enough to wrap onto a second line of the text' }
    })
    expect(latest().get('t')!.height).toBeGreaterThan(32)
  })
})

describe('the style controls', () => {
  it('stay in place: text size for a note, alignment only for a text', () => {
    renderEditor()
    focus(objectButton('Note: Buy milk'))
    const before = within(styleBar())
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label')?.split(':')[0])
    expect(isOffered('Colour')).toBe(true)
    expect(isOffered('Text size')).toBe(true)
    expect(isOffered('Alignment')).toBe(false)
    focus(objectButton('Text: Heading'))
    expect(isOffered('Alignment')).toBe(true)
    // The same controls, in the same order, whatever is selected.
    const after = within(styleBar())
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label')?.split(':')[0])
    expect(after).toEqual(before)
  })

  it('offer only the colour for a note and a line together, and are not there when read-only', () => {
    const { board, unmount } = renderEditor()
    click(board, [50, 50])
    click(board, [250, 100], { shiftKey: true })
    expect(isOffered('Colour')).toBe(true)
    expect(isOffered('Text size')).toBe(false)
    expect(isOffered('Line width')).toBe(false)
    unmount()
    renderEditor({ readOnly: true })
    focus(objectButton('Note: Buy milk'))
    expect(screen.queryByRole('toolbar', { name: 'Style' })).toBeNull()
  })

  it('say why a control is off when nothing is selected', () => {
    renderEditor()
    expect(isOffered('Colour')).toBe(false)
    expect(styleControl('Colour')).toHaveAccessibleDescription(
      'Select something, or pick a drawing tool, to set this.'
    )
  })

  it('recolour the whole selection in one commit and announce it', () => {
    const { board } = renderEditor()
    click(board, [50, 50])
    click(board, [350, 50], { shiftKey: true })
    expect(chosenOption('Colour')).toBe('Yellow')
    pickColour('Red')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(latest().get('a')).toMatchObject({ colour: 'red' })
    expect(latest().get('b')).toMatchObject({ colour: 'red' })
    expect(announced()).toBe('Colour: Red')
    expect(chosenOption('Colour')).toBe('Red')
  })

  it('set text size and alignment', () => {
    renderEditor()
    focus(objectButton('Text: Heading'))
    pickStyle('Text size', 'Huge')
    expect(latest().get('t')).toMatchObject({ data: { textSize: 'huge' } })
    pickStyle('Alignment', 'Middle')
    expect(latest().get('t')).toMatchObject({ data: { textSize: 'huge', align: 'middle' } })
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})

describe('arranging', () => {
  it('changes stacking with the keys', () => {
    renderEditor()
    const note = objectButton('Note: Buy milk')
    focus(note)
    fireEvent.keyDown(note, { key: ']', code: 'BracketRight', ctrlKey: true })
    expect(latest().get('a')!.z).toBeGreaterThan(latest().get('b')!.z)
    expect(latest().get('a')!.z).toBeLessThan(latest().get('n3')!.z)
    expect(announced()).toBe('Brought forward')
    fireEvent.keyDown(note, { key: '}', code: 'BracketRight', ctrlKey: true, shiftKey: true })
    const zs = [...latest().values()].map((entry) => entry.z)
    expect(latest().get('a')!.z).toBe(Math.max(...zs))
    fireEvent.keyDown(note, { key: '[', code: 'BracketLeft', ctrlKey: true })
    expect(announced()).toBe('Sent backward')
    fireEvent.keyDown(note, { key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true })
    expect(latest().get('a')!.z).toBe(Math.min(...[...latest().values()].map((entry) => entry.z)))
    expect(outerKeys).not.toHaveBeenCalled()
  })

  it('groups with Ctrl+G and ungroups with Ctrl+Shift+G', () => {
    const { board } = renderEditor()
    click(board, [50, 50])
    click(board, [350, 50], { shiftKey: true })
    key({ key: 'g', ctrlKey: true })
    const groupId = latest().get('a')!.groupId
    expect(groupId).not.toBeNull()
    expect(latest().get('b')!.groupId).toBe(groupId)
    expect(announced()).toBe('Grouped 2 objects')
    key({ key: 'G', ctrlKey: true, shiftKey: true })
    expect(latest().get('a')!.groupId).toBeNull()
    expect(latest().get('b')!.groupId).toBeNull()
    expect(announced()).toBe('Ungrouped')
  })

  it('aligns, distributes and restacks from the Arrange menu', () => {
    const { board } = renderEditor()
    const arrange = screen.getByRole('button', { name: 'Arrange' })
    expect((arrange as HTMLButtonElement).disabled).toBe(true)
    click(board, [50, 50])
    click(board, [350, 50], { shiftKey: true })
    fireEvent.click(arrange)
    // Distributing needs three.
    const distribute = screen.getByRole('menuitem', { name: 'Distribute horizontally' })
    expect(
      distribute.getAttribute('aria-disabled') === 'true' || distribute.hasAttribute('disabled')
    ).toBe(true)
    fireEvent.click(screen.getByRole('menuitem', { name: /Align left/ }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(announced()).toBe('Aligned')
    expect(latest().get('b')).toMatchObject({ x: 0 })
    expect(latest().get('a')).toMatchObject({ x: 0 })
    // Not selected: stays where it was.
    expect(latest().get('n3')).toMatchObject({ x: 900, y: 40 })
    fireEvent.click(arrange)
    fireEvent.click(screen.getByRole('menuitem', { name: /Bring to front/ }))
    expect(announced()).toBe('Brought to front')
  })

  it('distributes three objects evenly', () => {
    const { board } = renderEditor({
      objects: [noteA, object({ ...noteB, x: 250 }), object({ ...noteC, y: 0 })]
    })
    click(board, [50, 50])
    click(board, [300, 50], { shiftKey: true })
    click(board, [950, 50], { shiftKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Arrange' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Distribute horizontally' }))
    // 0–200 and 900–1100: the middle one lands at 450 with gaps of 250.
    expect(latest().get('b')).toMatchObject({ x: 450 })
    expect(announced()).toBe('Distributed')
  })
})

describe('duplicating, copying and pasting', () => {
  it('duplicates with Ctrl+D: new ids, 20 right and down, still connected, on top', () => {
    const { board } = renderEditor()
    click(board, [50, 50])
    click(board, [350, 50], { shiftKey: true })
    click(board, [250, 100], { shiftKey: true })
    key({ key: 'd', ctrlKey: true })
    expect(onChange).toHaveBeenCalledTimes(1)
    const copies = added(BOARD.map((entry) => entry.id))
    expect(copies).toHaveLength(3)
    const copyA = copies.find((entry) => entry.text === 'Buy milk')!
    const copyB = copies.find((entry) => entry.text === 'Call Sam')!
    const copyLine = copies.find((entry) => entry.kind === 'connector')!
    expect(copyA).toMatchObject({ x: 20, y: 20 })
    expect(copyB).toMatchObject({ x: 320, y: 20 })
    expect(copyLine.kind === 'connector' && copyLine.data.from.objectId).toBe(copyA.id)
    expect(copyLine.kind === 'connector' && copyLine.data.to.objectId).toBe(copyB.id)
    const highest = Math.max(...BOARD.map((entry) => entry.z))
    expect(Math.min(...copies.map((entry) => entry.z))).toBeGreaterThan(highest)
    // The copies are the selection now: the original (above it, so read first) is not.
    const original = screen.getByRole('button', { name: 'Note: Buy milk 1' })
    const copy = screen.getByRole('button', { name: 'Note: Buy milk 2' })
    expect(original.getAttribute('aria-pressed')).toBe('false')
    expect(copy.getAttribute('aria-pressed')).toBe('true')
    expect(announced()).toBe('Duplicated 3 objects')
  })

  it("copies the selection's text with a copy event, and a paste event of it adds copies", () => {
    renderEditor()
    focus(objectButton('Note: Buy milk'))
    const copy = clipboardEvent('copy')
    dispatchOnFocus(copy.event)
    expect(copy.event.defaultPrevented).toBe(true)
    expect(copy.clipboardData.setData).toHaveBeenCalledWith('text/plain', 'Buy milk')
    expect(onChange).not.toHaveBeenCalled()
    const paste = clipboardEvent('paste', copy.text())
    dispatchOnFocus(paste.event)
    expect(paste.event.defaultPrevented).toBe(true)
    const [pasted] = added(BOARD.map((entry) => entry.id))
    expect(pasted).toMatchObject({ kind: 'note', text: 'Buy milk', x: 20, y: 20 })
    expect(announced()).toBe('Pasted 1 object')
  })

  it('cuts with a cut event: the text goes on the clipboard and the objects go', () => {
    renderEditor()
    focus(objectButton('Note: Call Sam'))
    const cut = clipboardEvent('cut')
    dispatchOnFocus(cut.event)
    expect(cut.event.defaultPrevented).toBe(true)
    expect(cut.text()).toBe('Call Sam')
    expect(latest().has('b')).toBe(false)
    expect(onChange).toHaveBeenCalledTimes(1)
    const paste = clipboardEvent('paste', 'Call Sam')
    dispatchOnFocus(paste.event)
    expect([...latest().values()].some((entry) => entry.text === 'Call Sam')).toBe(true)
  })

  // Other text became a note in prompt 11 (WhiteboardEditorPaste.test.tsx); a paste of nothing stays alone.
  it('leaves a paste with nothing in it alone', () => {
    renderEditor()
    focus(objectButton('Note: Buy milk'))
    dispatchOnFocus(clipboardEvent('copy').event)
    const paste = clipboardEvent('paste', '  \n ')
    dispatchOnFocus(paste.event)
    expect(paste.event.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('leaves out pictures copied from another project, and says so', () => {
    const { unmount } = renderEditor({ objects: [noteA, picture], projectId: 'one' })
    focus(objectButton('Note: Buy milk'))
    key({ key: 'a', ctrlKey: true })
    const copy = clipboardEvent('copy')
    dispatchOnFocus(copy.event)
    expect(copy.text()).toBe('Buy milk\nPicture')
    unmount()
    changes = []
    renderEditor({ objects: [], projectId: 'two' })
    focus(screen.getByRole('group', { name: 'Whiteboard: Launch' }))
    const paste = clipboardEvent('paste', copy.text())
    dispatchOnFocus(paste.event)
    const pasted = [...latest().values()]
    expect(pasted.map((entry) => entry.kind)).toEqual(['note'])
    expect(announced()).toBe('Pasted 1 object Pictures from another project were left out.')
  })
})
