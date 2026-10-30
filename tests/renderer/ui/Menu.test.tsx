// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Menu, type MenuEntry } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'

afterEach(() => __resetDismissableStackForTests())

function setup() {
  const edit = vi.fn()
  const duplicate = vi.fn()
  const remove = vi.fn()
  const items: MenuEntry[] = [
    { label: 'Edit', onSelect: edit, shortcut: 'E' },
    { label: 'Duplicate', onSelect: duplicate },
    { label: 'Disabled thing', onSelect: vi.fn(), disabled: true, hint: 'Not now' },
    { type: 'separator' },
    {
      type: 'group',
      label: 'Danger',
      items: [{ label: 'Delete', onSelect: remove, tone: 'danger' }]
    }
  ]
  render(<Menu label="Task actions" items={items} />)
  const trigger = screen.getByRole('button', { name: 'Task actions' })
  return { trigger, edit, duplicate, remove }
}

const focusedName = () => document.activeElement?.textContent ?? ''

describe('Menu', () => {
  it('opens a named menu from its trigger, which reports it', () => {
    const { trigger } = setup()
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(screen.getByRole('menu', { name: 'Task actions' })).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('menuitem')).toHaveLength(4)
    expect(screen.getByRole('separator')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Danger' })).toBeInTheDocument()
  })

  it('moves with the arrow keys, Home and End, skipping disabled items', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    expect(focusedName()).toMatch(/^Edit/)
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(focusedName()).toBe('Duplicate')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(focusedName()).toBe('Delete')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(focusedName()).toMatch(/^Edit/)
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(focusedName()).toBe('Delete')
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(focusedName()).toMatch(/^Edit/)
    fireEvent.keyDown(menu, { key: 'End' })
    expect(focusedName()).toBe('Delete')
  })

  it('jumps by typeahead', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'd' })
    expect(focusedName()).toBe('Duplicate')
    // The same letter again cycles to the next match, skipping the disabled one.
    fireEvent.keyDown(menu, { key: 'd' })
    expect(focusedName()).toBe('Delete')
  })

  it('runs an item with Enter or Space and closes', () => {
    const { trigger, duplicate, edit } = setup()
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(duplicate).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getByRole('menu'), { key: ' ' })
    expect(edit).toHaveBeenCalledTimes(1)
  })

  it('does not run a disabled item', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    const disabled = screen.getByRole('menuitem', { name: 'Disabled thing' })
    expect(disabled).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(disabled)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the trigger', () => {
    const { trigger } = setup()
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('opens on ArrowUp at the last item', () => {
    const { trigger } = setup()
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    expect(focusedName()).toBe('Delete')
  })
  it('reads an item that shows a tick as a checkbox, or a radio, with its state', () => {
    const toggle = vi.fn()
    render(
      <Menu
        label="Window menu"
        items={[
          { label: 'Reopen at start', checked: true, onSelect: toggle },
          { label: 'Keep on top', checked: false, onSelect: vi.fn() },
          {
            type: 'group',
            label: 'Views',
            items: [
              { label: 'Default view', checked: false, checkKind: 'radio', onSelect: vi.fn() },
              { label: 'Urgent', checked: true, checkKind: 'radio', onSelect: vi.fn() }
            ]
          },
          { label: 'Show the main window', onSelect: vi.fn() }
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Window menu' }))
    const reopen = screen.getByRole('menuitemcheckbox', { name: 'Reopen at start' })
    expect(reopen).toHaveAttribute('aria-checked', 'true')
    // A tick shows only while it is checked, hidden from screen readers.
    expect(reopen.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    const onTop = screen.getByRole('menuitemcheckbox', { name: 'Keep on top' })
    expect(onTop).toHaveAttribute('aria-checked', 'false')
    expect(onTop.querySelector('svg')).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'Urgent' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('menuitemradio', { name: 'Default view' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
    // A plain action stays a menuitem, with no checked state.
    expect(screen.getByRole('menuitem', { name: 'Show the main window' })).not.toHaveAttribute(
      'aria-checked'
    )
    // Arrow keys and Enter work across all three kinds.
    expect(document.activeElement).toBe(reopen)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(onTop)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' })
    expect(toggle).toHaveBeenCalledOnce()
  })

  it('shows the hint of an item on hover, such as why it is disabled', () => {
    const { trigger } = setup()
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Disabled thing' }).getAttribute('title')).toBe(
      'Not now'
    )
  })

  it('keeps its items in place while open, and shows the new ones next time', () => {
    const before: MenuEntry[] = [
      { label: 'Costs', onSelect: vi.fn() },
      { label: 'Shopping list', onSelect: vi.fn() },
      { label: 'Time report', onSelect: vi.fn() }
    ]
    // Costs joins the tabs while the menu is open.
    const after = before.slice(1)
    const { rerender } = render(<Menu label="More views" items={before} />)
    const trigger = screen.getByRole('button', { name: 'More views' })
    const names = () => screen.getAllByRole('menuitem').map((item) => item.textContent)
    fireEvent.click(trigger)
    rerender(<Menu label="More views" items={after} />)
    expect(names()).toEqual(['Costs', 'Shopping list', 'Time report'])
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(trigger)
    expect(names()).toEqual(['Shopping list', 'Time report'])
  })
})
