// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  SHORTCUTS,
  resolveShortcut,
  useShortcuts,
  type ShortcutHandlers
} from '@renderer/navigation/shortcuts'

function Harness({ handlers, dialog = false }: { handlers: ShortcutHandlers; dialog?: boolean }) {
  useShortcuts(handlers)
  return (
    <div>
      <input aria-label="Search" />
      <button type="button">Somewhere</button>
      {dialog && <div role="dialog" aria-label="Open dialog" />}
    </div>
  )
}

describe('useShortcuts', () => {
  it('opens the first project view on Ctrl+1 and the ninth on Ctrl+9', () => {
    const projectView = vi.fn()
    const { getByRole } = render(<Harness handlers={{ 'project-view': projectView }} />)
    fireEvent.keyDown(getByRole('button'), { key: '1', ctrlKey: true })
    fireEvent.keyDown(getByRole('button'), { key: '9', ctrlKey: true })
    expect(projectView.mock.calls).toEqual([[0], [8]])
  })

  it('ignores bare digits, which belong to typing and screen readers', () => {
    const projectView = vi.fn()
    const { getByRole } = render(<Harness handlers={{ 'project-view': projectView }} />)
    fireEvent.keyDown(getByRole('button'), { key: '1' })
    expect(projectView).not.toHaveBeenCalled()
  })

  it('ignores shortcuts while typing, except the ones meant for anywhere', () => {
    const projectView = vi.fn()
    const sidebar = vi.fn()
    const palette = vi.fn()
    const { getByRole } = render(
      <Harness handlers={{ 'project-view': projectView, sidebar, palette }} />
    )
    const input = getByRole('textbox')
    fireEvent.keyDown(input, { key: '1', ctrlKey: true })
    fireEvent.keyDown(input, { key: 'b', ctrlKey: true })
    expect(projectView).not.toHaveBeenCalled()
    expect(sidebar).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'k', ctrlKey: true })
    expect(palette).toHaveBeenCalledTimes(1)
  })

  it('ignores shortcuts while a dialog is open, except the palette', () => {
    const projectView = vi.fn()
    const newTask = vi.fn()
    const palette = vi.fn()
    const { getByRole } = render(
      <Harness handlers={{ 'project-view': projectView, 'new-task': newTask, palette }} dialog />
    )
    const button = getByRole('button')
    fireEvent.keyDown(button, { key: '1', ctrlKey: true })
    fireEvent.keyDown(button, { key: 'n', ctrlKey: true })
    expect(projectView).not.toHaveBeenCalled()
    expect(newTask).not.toHaveBeenCalled()
    fireEvent.keyDown(button, { key: 'k', ctrlKey: true })
    expect(palette).toHaveBeenCalledTimes(1)
  })

  it('runs a two-key sequence: G then H goes Home', () => {
    const goHome = vi.fn()
    const { getByRole } = render(<Harness handlers={{ 'go-home': goHome }} />)
    const button = getByRole('button')
    fireEvent.keyDown(button, { key: 'h' })
    expect(goHome).not.toHaveBeenCalled()
    fireEvent.keyDown(button, { key: 'g' })
    fireEvent.keyDown(button, { key: 'h' })
    expect(goHome).toHaveBeenCalledTimes(1)
  })

  it('tells Ctrl+N from Ctrl+Shift+N, quick add from anywhere', () => {
    const newTask = vi.fn()
    const quickAdd = vi.fn()
    const { getByRole } = render(
      <Harness handlers={{ 'new-task': newTask, 'quick-add': quickAdd }} />
    )
    fireEvent.keyDown(getByRole('button'), { key: 'N', ctrlKey: true, shiftKey: true })
    expect(newTask).not.toHaveBeenCalled()
    expect(quickAdd).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(getByRole('button'), { key: 'n', ctrlKey: true })
    expect(newTask).toHaveBeenCalledTimes(1)
    expect(quickAdd).toHaveBeenCalledTimes(1)
  })

  it('runs G then I: go to the Inbox', () => {
    const goInbox = vi.fn()
    const { getByRole } = render(<Harness handlers={{ 'go-inbox': goInbox }} />)
    fireEvent.keyDown(getByRole('button'), { key: 'g' })
    fireEvent.keyDown(getByRole('button'), { key: 'i' })
    expect(goInbox).toHaveBeenCalledTimes(1)
  })

  it('gives a key to the project when both the app and the project handle it', () => {
    // The shell mounts before a project opens, so its listener comes first.
    // Ctrl+N in a project used to open the app's quick add, which files the
    // task in whichever project was used last (found by the GUI monkey).
    function Project({ handlers }: { handlers: ShortcutHandlers }) {
      useShortcuts(handlers, 'project')
      return null
    }
    const appNewTask = vi.fn()
    const projectNewTask = vi.fn()
    const { getByRole, rerender } = render(<Harness handlers={{ 'new-task': appNewTask }} />)
    rerender(
      <>
        <Harness handlers={{ 'new-task': appNewTask }} />
        <Project handlers={{ 'new-task': projectNewTask }} />
      </>
    )
    fireEvent.keyDown(getByRole('button'), { key: 'n', ctrlKey: true })
    expect(projectNewTask).toHaveBeenCalledTimes(1)
    expect(appNewTask).not.toHaveBeenCalled()

    // Without a project, the app's handler runs.
    rerender(<Harness handlers={{ 'new-task': appNewTask }} />)
    fireEvent.keyDown(getByRole('button'), { key: 'n', ctrlKey: true })
    expect(appNewTask).toHaveBeenCalledTimes(1)
  })

  it('takes punctuation in its stride: "*", "(", "+" and "\\" never throw', () => {
    // The key used to go into a regular expression, so typing a Markdown
    // bullet anywhere in the app threw "Invalid regular expression".
    expect(resolveShortcut(new KeyboardEvent('keydown', { key: '*' }), null)).toBeNull()
    for (const key of ['(', ')', '+', '[', '\\', '|', '.', '$', '^']) {
      expect(() => resolveShortcut(new KeyboardEvent('keydown', { key }), null)).not.toThrow()
    }
    expect(resolveShortcut(new KeyboardEvent('keydown', { key: 'g' }), null)).toEqual({
      pending: 'g'
    })
  })

  it('holds the whole information-architecture table, one entry per id', () => {
    const ids = SHORTCUTS.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(SHORTCUTS.find((entry) => entry.id === 'project-view')?.keys).toBe('Ctrl+1–9')
  })
})
