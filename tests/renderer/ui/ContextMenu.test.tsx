// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ContextMenu, type MenuEntry } from '@renderer/ui'

function setup() {
  const onRename = vi.fn()
  const items: MenuEntry[] = [
    { label: 'Rename', onSelect: onRename },
    { label: 'Delete', onSelect: vi.fn(), disabled: true }
  ]
  render(
    <ContextMenu label="Task actions" items={items}>
      <button type="button">Task card</button>
    </ContextMenu>
  )
  return { onRename, target: screen.getByRole('button', { name: 'Task card' }) }
}

describe('ContextMenu', () => {
  it('opens a named menu on right-click', () => {
    const { target } = setup()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(fireEvent.contextMenu(target, { clientX: 10, clientY: 20 })).toBe(false)
    expect(screen.getByRole('menu', { name: 'Task actions' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('opens on Shift+F10 and on the Menu key', () => {
    const { target } = setup()
    fireEvent.keyDown(target, { key: 'F10', shiftKey: true })
    expect(screen.getByRole('menu', { name: 'Task actions' })).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.keyDown(target, { key: 'ContextMenu' })
    expect(screen.getByRole('menu', { name: 'Task actions' })).toBeInTheDocument()
  })

  it('closes on a press anywhere outside the menu, the element it was opened on too (MOP-46)', () => {
    const { target } = setup()
    fireEvent.contextMenu(target, { clientX: 10, clientY: 20 })
    fireEvent.mouseDown(target)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.contextMenu(target, { clientX: 10, clientY: 20 })
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('ignores F10 without Shift', () => {
    const { target } = setup()
    fireEvent.keyDown(target, { key: 'F10' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('closes on Escape and runs a chosen item', () => {
    const { target, onRename } = setup()
    target.focus()
    fireEvent.contextMenu(target)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.contextMenu(target)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Rename' }), { key: 'Enter' })
    expect(onRename).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('leaves a right-click in a text field to the field, for its spelling suggestions', () => {
    render(
      <ContextMenu label="Task actions" items={[{ label: 'Rename', onSelect: () => {} }]}>
        <div tabIndex={-1}>
          <input aria-label="Title" />
          <span>Card</span>
        </div>
      </ContextMenu>
    )
    const field = screen.getByRole('textbox', { name: 'Title' })
    expect(fireEvent.contextMenu(field)).toBe(true)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(fireEvent.contextMenu(screen.getByText('Card'))).toBe(false)
    expect(screen.getByRole('menu', { name: 'Task actions' })).toBeInTheDocument()
  })
})
