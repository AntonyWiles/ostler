// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mark } from '@shared/markup'
import { MarkupEditor } from '@renderer/components/markup/MarkupEditor'
import { ConfirmProvider, ToastProvider } from '@renderer/ui'
import { installOstlerApi } from '../fixtures/ostler-api'

/**
 * Mark up (N4.2b): every tool by mouse and by keyboard, selecting, moving
 * and deleting marks, undo and redo. jsdom has no canvas, so drawing and
 * encoding are stubbed; the marks handed to `flattenToPng` are what would
 * be saved. With no layout, a screen point is a picture pixel.
 */

const flattened: Mark[][] = []

vi.mock('@renderer/components/markup/draw', () => ({
  annotationColours: () => ({ red: 'r', yellow: 'y', blue: 'b', green: 'g', black: 'k' }),
  appFontFamily: () => 'Segoe UI',
  drawMarkup: () => {},
  loadPicture: async () => ({
    image: { naturalWidth: 300, naturalHeight: 300 },
    release: () => {}
  }),
  flattenToPng: async (_image: unknown, _size: unknown, marks: Mark[]) => {
    flattened.push(marks)
    return Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
  }
}))

const onSave = vi.fn(async () => null)
const onClose = vi.fn()

async function renderEditor() {
  render(
    <ToastProvider>
      <ConfirmProvider>
        <MarkupEditor
          open
          title="Mark up the snip"
          saveLabel="Use this picture"
          load={async () => ({ bytes: Uint8Array.from([1]), mimeType: 'image/png' })}
          onSave={onSave}
          onClose={onClose}
        />
      </ConfirmProvider>
    </ToastProvider>
  )
  return screen.findByRole('group', { name: /^The picture, 300 × 300/ })
}

function drag(stage: Element, from: [number, number], to: [number, number]) {
  fireEvent.mouseDown(stage, { button: 0, clientX: from[0], clientY: from[1] })
  fireEvent.mouseMove(document, { clientX: to[0], clientY: to[1] })
  fireEvent.mouseUp(document, { clientX: to[0], clientY: to[1] })
}

async function saved(): Promise<Mark[]> {
  fireEvent.click(screen.getByRole('button', { name: 'Use this picture' }))
  await waitFor(() => expect(onSave).toHaveBeenCalled())
  return flattened.at(-1)!
}

function layout() {
  return document.querySelector('.markup-editor__layout')!
}

beforeEach(() => {
  installOstlerApi()
  // jsdom has no canvas: the editor draws nothing, as when a context is lost.
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  flattened.length = 0
  onSave.mockClear()
  onClose.mockClear()
})

describe('the mark-up editor', () => {
  it('draws an arrow, a box, a highlight and a blur with the mouse', async () => {
    const stage = await renderEditor()
    // Arrow is the first tool.
    expect(screen.getByRole('button', { name: 'Arrow' }).getAttribute('aria-pressed')).toBe('true')
    drag(stage, [10, 10], [150, 150])
    fireEvent.click(screen.getByRole('button', { name: 'Box' }))
    drag(stage, [220, 220], [290, 290])
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }))
    drag(stage, [120, 10], [180, 40])
    fireEvent.click(screen.getByRole('button', { name: 'Blur, for anything private' }))
    drag(stage, [10, 220], [80, 290])
    // A click is not a mark.
    drag(stage, [5, 5], [6, 6])

    expect(screen.getByRole('button', { name: 'Arrow, from top left to centre' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Box, at bottom right' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Highlight, at top' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Blur, at bottom left' })).toBeTruthy()
    const marks = await saved()
    expect(marks.map((mark) => mark.kind)).toEqual(['arrow', 'box', 'highlight', 'blur'])
    expect(marks[1]).toMatchObject({ x: 220, y: 220, width: 70, height: 70, colour: 'red' })
  })

  it('places text with a click and edits it in its field', async () => {
    const stage = await renderEditor()
    fireEvent.keyDown(layout(), { key: 't' })
    expect(screen.getByRole('button', { name: 'Text' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.mouseDown(stage, { button: 0, clientX: 60, clientY: 130 })
    const field = await screen.findByRole('textbox', { name: 'Text of the selected mark' })
    fireEvent.change(field, { target: { value: 'Wrong total' } })
    expect(screen.getByRole('button', { name: 'Text “Wrong total”, at centre' })).toBeTruthy()
    const marks = await saved()
    expect(marks).toEqual([expect.objectContaining({ kind: 'text', text: 'Wrong total' })])
  })

  it('picks every tool by its key', async () => {
    await renderEditor()
    const keys: [string, string][] = [
      ['v', 'Select, to move and change marks'],
      ['a', 'Arrow'],
      ['r', 'Box'],
      ['h', 'Highlight'],
      ['t', 'Text'],
      ['b', 'Blur, for anything private']
    ]
    for (const [key, name] of keys) {
      fireEvent.keyDown(layout(), { key })
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true')
    }
  })

  it('adds a box and a blur by typing their position, without drawing', async () => {
    await renderEditor()
    const form = screen.getByRole('group', { name: 'Add by position' })
    const field = (name: string) => within(form, name)
    fireEvent.change(field('Left'), { target: { value: '200' } })
    fireEvent.change(field('Top'), { target: { value: '200' } })
    fireEvent.change(field('Width'), { target: { value: '90' } })
    fireEvent.change(field('Height'), { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add mark' }))
    const added = screen.getByRole('button', { name: 'Box, at bottom right' })
    expect(document.activeElement).toBe(added)

    fireEvent.change(screen.getByRole('combobox', { name: 'Mark' }), { target: { value: 'blur' } })
    fireEvent.change(field('Left'), { target: { value: '0' } })
    fireEvent.change(field('Top'), { target: { value: '0' } })
    // Enter in a field adds, as a form would.
    fireEvent.keyDown(field('Height'), { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Blur, at top left' })).toBeTruthy()

    fireEvent.change(field('Left'), { target: { value: '290' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add mark' }))
    expect(screen.getByRole('alert').textContent).toMatch(/past the picture’s edge/)

    const marks = await saved()
    expect(marks).toEqual([
      expect.objectContaining({ kind: 'box', x: 200, y: 200, width: 90, height: 90 }),
      expect.objectContaining({ kind: 'blur', x: 0, y: 0, width: 90, height: 90 })
    ])
  })

  it('moves the focused mark with the arrow keys, and deletes it', async () => {
    const stage = await renderEditor()
    fireEvent.keyDown(layout(), { key: 'r' })
    drag(stage, [10, 10], [60, 50])
    drag(stage, [200, 200], [250, 250])
    const first = screen.getByRole('button', { name: 'Box, at top left' })
    act(() => first.focus())
    expect(first.getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    fireEvent.keyDown(first, { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(first, { key: 'ArrowRight', altKey: true })
    let marks = await saved()
    expect(marks[0]).toMatchObject({ x: 11, y: 20, width: 51, height: 40 })

    fireEvent.keyDown(screen.getByRole('button', { name: 'Box, at top left' }), {
      key: 'Delete'
    })
    expect(screen.queryByRole('button', { name: 'Box, at top left' })).toBeNull()
    // Focus goes to the next mark.
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Box, at bottom right' })
    )
    marks = await saved()
    expect(marks).toHaveLength(1)
  })

  it('selects and moves a mark with the mouse, and recolours it', async () => {
    const stage = await renderEditor()
    fireEvent.keyDown(layout(), { key: 'r' })
    drag(stage, [10, 10], [60, 50])
    fireEvent.keyDown(layout(), { key: 'v' })
    const mark = screen.getByRole('button', { name: 'Box, at top left' })
    fireEvent.mouseDown(mark, { button: 0, clientX: 20, clientY: 20 })
    fireEvent.mouseMove(document, { clientX: 220, clientY: 220 })
    fireEvent.mouseUp(document, { clientX: 220, clientY: 220 })
    expect(screen.getByRole('button', { name: 'Box, at bottom right' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }))
    const marks = await saved()
    expect(marks).toEqual([expect.objectContaining({ x: 210, y: 210, colour: 'blue' })])
  })

  it('moves a mark taken by its border with a drawing tool still chosen (MOP-34)', async () => {
    const stage = await renderEditor()
    fireEvent.keyDown(layout(), { key: 'r' })
    drag(stage, [10, 10], [60, 50])
    // Still the box tool: a press on the mark (its border, in the app) moves it, draws nothing.
    const mark = screen.getByRole('button', { name: 'Box, at top left' })
    fireEvent.mouseDown(mark, { button: 0, clientX: 10, clientY: 20 })
    fireEvent.mouseMove(document, { clientX: 210, clientY: 220 })
    fireEvent.mouseUp(document, { clientX: 210, clientY: 220 })
    expect(screen.getByRole('button', { name: 'Box, at bottom right' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Box,/ })).toHaveLength(1)
  })

  it('undoes and redoes with Ctrl+Z and Ctrl+Y, and with its buttons', async () => {
    const stage = await renderEditor()
    drag(stage, [10, 10], [150, 150])
    fireEvent.keyDown(layout(), { key: 'r' })
    drag(stage, [200, 200], [250, 250])
    fireEvent.keyDown(layout(), { key: 'z', ctrlKey: true })
    expect(screen.queryByRole('button', { name: 'Box, at bottom right' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.queryByRole('button', { name: /^Arrow,/ })).toBeNull()
    fireEvent.keyDown(layout(), { key: 'y', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(screen.getByRole('button', { name: /^Arrow,/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Box, at bottom right' })).toBeTruthy()
  })

  it('cancelling with marks asks first, and keeps nothing', async () => {
    const stage = await renderEditor()
    drag(stage, [10, 10], [150, 150])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard marks' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSave).not.toHaveBeenCalled()
  })
})

function within(root: HTMLElement, label: string): HTMLInputElement {
  const found = Array.from(root.querySelectorAll('input')).find(
    (input) => input.labels?.[0]?.textContent?.trim() === label
  )
  if (!found) throw new Error(`No field called ${label}`)
  return found
}
