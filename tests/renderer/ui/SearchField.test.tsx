// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SearchField } from '@renderer/ui'

function Controlled({
  initial = 'bug',
  slashShortcut = false,
  onValue = () => {}
}: {
  initial?: string
  slashShortcut?: boolean
  onValue?: (value: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <SearchField
        label="Search tasks"
        slashShortcut={slashShortcut}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          onValue(event.target.value)
        }}
      />
      <button type="button">Elsewhere</button>
      <textarea aria-label="Notes" />
    </>
  )
}

describe('SearchField', () => {
  it('is a searchbox named by its visually hidden label', () => {
    render(<Controlled />)
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('bug')
  })

  it('clears on Escape, and lets Escape through when already empty', () => {
    const onValue = vi.fn()
    render(<Controlled onValue={onValue} />)
    const input = screen.getByRole('searchbox', { name: 'Search tasks' })
    // fireEvent returns false when the default was prevented.
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(false)
    expect(onValue).toHaveBeenCalledWith('')
    expect(input).toHaveValue('')
    expect(fireEvent.keyDown(input, { key: 'Escape' })).toBe(true)
  })

  it('leaves "/" alone while a dialog is open, as every single-key shortcut does', () => {
    render(
      <>
        <Controlled initial="" slashShortcut />
        <div role="dialog" aria-label="Task">
          <button type="button">In the dialog</button>
        </div>
      </>
    )
    const inDialog = screen.getByRole('button', { name: 'In the dialog' })
    inDialog.focus()
    expect(fireEvent.keyDown(inDialog, { key: '/' })).toBe(true)
    expect(inDialog).toHaveFocus()
  })

  it('focuses on "/" when the shortcut is on, but not while typing elsewhere', () => {
    render(<Controlled initial="" slashShortcut />)
    const input = screen.getByRole('searchbox', { name: 'Search tasks' })
    const notes = screen.getByRole('textbox', { name: 'Notes' })
    notes.focus()
    fireEvent.keyDown(notes, { key: '/' })
    expect(notes).toHaveFocus()
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
    elsewhere.focus()
    fireEvent.keyDown(elsewhere, { key: '/' })
    expect(input).toHaveFocus()
  })

  it('ignores "/" without the shortcut', () => {
    render(<Controlled initial="" />)
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
    elsewhere.focus()
    fireEvent.keyDown(elsewhere, { key: '/' })
    expect(elsewhere).toHaveFocus()
  })

  it('can be disabled', () => {
    render(<SearchField label="Search tasks" disabled />)
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toBeDisabled()
  })
})
