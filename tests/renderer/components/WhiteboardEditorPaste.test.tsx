// @vitest-environment jsdom
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ObjectMap } from '@shared/whiteboard/history'
import { cleanWhiteboardObject, type WhiteboardObjectInput } from '@shared/whiteboard/model'
import {
  WhiteboardEditor,
  type WhiteboardEditorProps
} from '@renderer/components/whiteboard/WhiteboardEditor'
import type {
  PictureRef,
  WhiteboardPictureSource
} from '@renderer/components/whiteboard/picture-source'
import { clearCopiedWhiteboardObjects } from '@renderer/components/whiteboard/whiteboard-clipboard'
import { AnnouncerProvider } from '@renderer/ui'

/**
 * Pictures pasted, dropped and inserted, and text and links pasted, on the
 * whiteboard (docs/plans/whiteboards, prompt 11, D16). As in the other editor
 * tests, jsdom has no layout: the view stays at 100% and a client point is a
 * board point.
 */

function object(fields: Record<string, unknown>): WhiteboardObjectInput {
  return cleanWhiteboardObject({ x: 0, y: 0, width: 200, height: 200, z: 1, ...fields })
}

const noteA = object({ id: 'a', kind: 'note', text: 'Buy milk', z: 1 })
const noteB = object({ id: 'b', kind: 'note', text: 'Call Sam', x: 300, z: 2 })
const BOARD = [noteA, noteB]

const PROJECT = '11111111-2222-4333-8444-555555555555'
const TASK = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
/** `ostler://task/<projectId>/<taskId>`: ids are UUIDs. */
const TASK_LINK = `ostler://task/${PROJECT}/${TASK}`

const SITE: PictureRef = { itemId: 'pic-site', title: 'Site photo', width: 1600, height: 1200 }
const PLAN: PictureRef = { itemId: 'pic-plan', title: 'Floor plan', width: 300, height: 900 }

let changes: ObjectMap[] = []
const onChange = vi.fn((present: ObjectMap) => changes.push(present))
let source: { [K in keyof WhiteboardPictureSource]: ReturnType<typeof vi.fn> }

function renderEditor(props: Partial<WhiteboardEditorProps> = {}) {
  render(
    <AnnouncerProvider>
      <WhiteboardEditor
        title="Launch"
        objects={BOARD}
        version={1}
        onChange={onChange}
        imageUrl={() => null}
        projectId="p1"
        pictures={source as unknown as WhiteboardPictureSource}
        {...props}
      />
    </AnnouncerProvider>
  )
  return screen.getByRole('group', { name: 'Whiteboard: Launch' })
}

function focusBoard(props: Partial<WhiteboardEditorProps> = {}) {
  const board = renderEditor(props)
  act(() => board.focus())
  return board
}

/** A drop of `files` at a client point (jsdom's drag events carry no point of their own). */
function drop(board: Element, files: File[], [x, y]: [number, number]) {
  const event = createEvent.drop(board, { dataTransfer: { files, types: ['Files'] } })
  Object.defineProperty(event, 'clientX', { value: x })
  Object.defineProperty(event, 'clientY', { value: y })
  fireEvent(board, event)
}

/** A clipboard event as Chromium (or Ostler's off-screen preload) sends it. */
function clipboardEvent(type: 'copy' | 'paste', text = '', files: File[] = []) {
  const store = new Map<string, string>([['text/plain', text]])
  const clipboardData = {
    setData: vi.fn((format: string, value: string) => store.set(format, value)),
    getData: (format: string) => store.get(format) ?? '',
    files
  }
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: clipboardData })
  return { event, text: () => store.get('text/plain') ?? '' }
}

function dispatchOnFocus(event: Event) {
  act(() => {
    ;(document.activeElement ?? document.body).dispatchEvent(event)
  })
}

function paste(text: string, files: File[] = []) {
  const { event } = clipboardEvent('paste', text, files)
  dispatchOnFocus(event)
  return event
}

const latest = () => changes[changes.length - 1]
const added = () => {
  const old = new Set(BOARD.map((entry) => entry.id))
  return [...latest().values()].filter((entry) => !old.has(entry.id))
}
const announced = () => document.querySelector('[data-announcer]')?.textContent?.trim() ?? ''
const root$ = () => document.querySelector('.wb-editor')!
const png = (name = 'site.png') => new File(['png'], name, { type: 'image/png' })

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  changes = []
  onChange.mockClear()
  clearCopiedWhiteboardObjects()
  source = {
    importFiles: vi.fn(async () => [SITE]),
    pickFiles: vi.fn(async () => [SITE]),
    listLibraryPictures: vi.fn(async () => [SITE, PLAN])
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pasting text and links (D16)', () => {
  it('makes an item card from an Ostler link', () => {
    focusBoard()
    const event = paste(TASK_LINK)
    expect(event.defaultPrevented).toBe(true)
    expect(onChange).toHaveBeenCalledTimes(1)
    const [card] = added()
    expect(card).toMatchObject({
      kind: 'card',
      width: 280,
      height: 72,
      link: TASK_LINK
    })
    expect(screen.getByRole('button', { name: /^Card:/ }).getAttribute('aria-pressed')).toBe('true')
    expect(announced()).toBe('Card added')
  })

  it('makes a note linked to a web address', () => {
    focusBoard()
    paste('https://example.com')
    const [note] = added()
    expect(note).toMatchObject({
      kind: 'note',
      text: 'https://example.com',
      link: 'https://example.com'
    })
    expect(announced()).toBe('Linked note added')
  })

  it('makes one note from two lines of text', () => {
    focusBoard()
    paste('First line\nSecond line')
    const notes = added()
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ kind: 'note', text: 'First line\nSecond line', link: null })
    expect(announced()).toBe('Note added')
  })

  it('makes one note per line after Ctrl+Shift+V, at most 50, and says how many were left out', () => {
    focusBoard()
    // Off screen the preload prevents the key's default and pastes itself: still remembered.
    const prevent = (event: KeyboardEvent) => event.preventDefault()
    window.addEventListener('keydown', prevent, true)
    fireEvent.keyDown(root$(), { key: 'V', ctrlKey: true, shiftKey: true })
    window.removeEventListener('keydown', prevent, true)
    const lines = Array.from({ length: 60 }, (_, index) => `Idea ${index + 1}`)
    paste(lines.join('\n'))
    expect(onChange).toHaveBeenCalledTimes(1)
    const notes = added().sort((a, b) => a.z - b.z)
    expect(notes).toHaveLength(50)
    expect(notes.every((note) => note.kind === 'note')).toBe(true)
    expect(notes[0].text).toBe('Idea 1')
    expect(notes[49].text).toBe('Idea 50')
    // Five columns, 220 apart.
    expect(notes[1].x - notes[0].x).toBe(220)
    expect(notes[5].x).toBe(notes[0].x)
    expect(notes[5].y - notes[0].y).toBe(220)
    expect(announced()).toBe('50 notes added 10 more lines were left out.')
  })

  it('makes one note of many lines when Ctrl+Shift+V was not pressed just before', () => {
    focusBoard()
    paste('One\nTwo\nThree')
    expect(added()).toHaveLength(1)
  })

  it('still pastes objects copied from a board (prompt 06)', () => {
    renderEditor()
    act(() => screen.getByRole('button', { name: 'Note: Buy milk' }).focus())
    const copy = clipboardEvent('copy')
    dispatchOnFocus(copy.event)
    const event = paste(copy.text())
    expect(event.defaultPrevented).toBe(true)
    const [copied] = added()
    expect(copied).toMatchObject({ kind: 'note', text: 'Buy milk' })
    expect(announced()).toBe('Pasted 1 object')
  })

  it('leaves a paste inside a note’s text box to the text box', () => {
    const board = renderEditor()
    fireEvent.doubleClick(board, { clientX: 50, clientY: 50 })
    const box = screen.getByRole('textbox', { name: 'Note text' })
    act(() => box.focus())
    const before = onChange.mock.calls.length
    const event = paste('https://example.com')
    expect(event.defaultPrevented).toBe(false)
    expect(onChange.mock.calls.length).toBe(before)
    expect(source.importFiles).not.toHaveBeenCalled()
  })

  it('pastes nothing on a read-only board', () => {
    focusBoard({ readOnly: true })
    const event = paste('Hello')
    expect(event.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('pictures (D11)', () => {
  it('imports a pasted picture and adds it fitted inside 480 by 480', async () => {
    focusBoard()
    const file = png()
    const event = paste('', [file])
    expect(event.defaultPrevented).toBe(true)
    expect(source.importFiles).toHaveBeenCalledWith([file])
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    const [image] = added()
    expect(image).toMatchObject({
      kind: 'image',
      width: 480,
      height: 360,
      data: { imageItemId: 'pic-site' }
    })
    expect(announced()).toBe('1 picture added')
  })

  it('adds one picture of a drop of a picture and a text file, and names the other', async () => {
    const board = renderEditor()
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' })
    const picture = png()
    drop(board, [picture, text], [600, 400])
    expect(source.importFiles).toHaveBeenCalledWith([picture])
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    const images = added()
    expect(images).toHaveLength(1)
    // Centred on the drop point.
    expect(images[0]).toMatchObject({ kind: 'image', x: 360, y: 220, width: 480, height: 360 })
    expect(announced()).toBe('1 picture added 1 file left out: only pictures go on a whiteboard.')
  })

  it('shows the drop hint while files are dragged over the board', () => {
    const board = renderEditor()
    fireEvent.dragOver(board, { dataTransfer: { files: [], types: ['Files'] } })
    expect(screen.getByText('Drop pictures to put them on the board')).toBeTruthy()
    fireEvent.dragLeave(board, { relatedTarget: document.body })
    expect(screen.queryByText('Drop pictures to put them on the board')).toBeNull()
  })

  it('inserts the pictures chosen with Picture › From the Library…, side by side', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Insert a picture' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'From the Library…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Insert pictures from the Library' })
    expect(source.listLibraryPictures).toHaveBeenCalledTimes(1)
    const insert = screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement
    expect(insert.disabled).toBe(true)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Site photo' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Floor plan' }))
    fireEvent.click(insert)
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(dialog.isConnected).toBe(false)
    const images = added().sort((a, b) => a.x - b.x)
    expect(images.map((image) => image.kind === 'image' && image.data.imageItemId)).toEqual([
      'pic-site',
      'pic-plan'
    ])
    expect(images[0]).toMatchObject({ width: 480, height: 360 })
    expect(images[1]).toMatchObject({ width: 160, height: 480 })
    expect(images[1].x - (images[0].x + images[0].width)).toBe(20)
    expect(announced()).toBe('2 pictures added')
  })

  it('opens the Picture menu with I and picks files from it', async () => {
    renderEditor()
    fireEvent.keyDown(root$(), { key: 'i' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'From a file…' }))
    expect(source.pickFiles).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(added()[0]).toMatchObject({ kind: 'image', data: { imageItemId: 'pic-site' } })
  })

  it('names a picture by its Library title', () => {
    const picture = object({
      id: 'p',
      kind: 'image',
      y: 300,
      z: 3,
      data: { imageItemId: 'pic-site' }
    })
    renderEditor({ objects: [picture], pictureTitles: new Map([['pic-site', 'Site photo']]) })
    expect(screen.getByRole('button', { name: 'Picture: Site photo' })).toBeTruthy()
  })

  it('has no Picture tool without a picture source', () => {
    renderEditor({ pictures: undefined })
    expect(screen.queryByRole('button', { name: 'Insert a picture' })).toBeNull()
  })
})
