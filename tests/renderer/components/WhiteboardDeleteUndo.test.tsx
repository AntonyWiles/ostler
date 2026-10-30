// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ObjectMap } from '@shared/whiteboard/history'
import { cleanWhiteboardObject, type WhiteboardObjectInput } from '@shared/whiteboard/model'
import { WhiteboardEditor } from '@renderer/components/whiteboard/WhiteboardEditor'
import { AnnouncerProvider, ToastProvider } from '@renderer/ui'

/**
 * The Undo toast after a delete on the whiteboard undoes that delete, and
 * nothing else: once the board has changed since, it leaves the board alone.
 */

function object(fields: Record<string, unknown>): WhiteboardObjectInput {
  return cleanWhiteboardObject({ x: 0, y: 0, width: 200, height: 200, z: 1, ...fields })
}

const BOARD = [
  object({ id: 'a', kind: 'note', text: 'Buy milk', z: 1 }),
  object({ id: 'b', kind: 'note', text: 'Call Sam', x: 300, z: 2 })
]

let changes: ObjectMap[] = []
const latest = () => changes[changes.length - 1]

function renderEditor() {
  render(
    <ToastProvider>
      <AnnouncerProvider>
        <WhiteboardEditor
          title="Launch"
          objects={BOARD}
          version={1}
          onChange={(present) => changes.push(present)}
          imageUrl={() => null}
        />
      </AnnouncerProvider>
    </ToastProvider>
  )
}

function deleteNote(name: string) {
  const note = screen.getByRole('button', { name })
  act(() => note.focus())
  fireEvent.keyDown(note, { key: 'Delete' })
}

/** Ctrl+Z outside the board: the newest Undo toast's undo. */
function toastUndo() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
  })
}

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never
  changes = []
  Object.defineProperty(window, 'ostlerAPI', {
    configurable: true,
    // Subscriptions hand back an unsubscribe; every call answers "not here".
    value: new Proxy(
      {},
      {
        get: (_target, name) =>
          String(name).startsWith('on')
            ? () => () => {}
            : vi.fn(async () => ({ ok: false, error: 'none' }))
      }
    )
  })
})

describe('Undo after a delete on the whiteboard', () => {
  it('brings the deleted object back', () => {
    renderEditor()
    deleteNote('Note: Buy milk')
    expect(latest().has('a')).toBe(false)
    toastUndo()
    expect(latest().has('a')).toBe(true)
  })

  it('leaves a later step alone once the board has changed since', () => {
    renderEditor()
    deleteNote('Note: Call Sam')
    // A step after the delete, with no toast of its own: a copy of Buy milk.
    const board = screen.getByRole('group', { name: 'Whiteboard: Launch' })
    for (const type of ['pointerdown', 'pointerup'])
      fireEvent(
        board,
        new MouseEvent(type, {
          clientX: 50,
          clientY: 50,
          button: 0,
          bubbles: true,
          cancelable: true
        })
      )
    fireEvent.keyDown(document.querySelector('.wb-editor')!, { key: 'd', ctrlKey: true })
    const afterDuplicate = latest()
    expect(afterDuplicate.size).toBe(2)
    // The delete's Undo would take the copy away, not bring Call Sam back: it does nothing.
    toastUndo()
    expect(latest()).toBe(afterDuplicate)
    expect(latest().has('b')).toBe(false)
  })
})
