// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl, type SegmentedOption } from '@renderer/ui'

type View = 'list' | 'board' | 'calendar' | 'table'
const OPTIONS: SegmentedOption<View>[] = [
  { value: 'list', label: 'List' },
  { value: 'board', label: 'Board' },
  { value: 'calendar', label: 'Calendar', disabled: true },
  { value: 'table', label: 'Table' }
]

function Harness({ onChange }: { onChange?: (value: View) => void }) {
  const [value, setValue] = useState<View>('list')
  return (
    <SegmentedControl
      label="View"
      options={OPTIONS}
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
    />
  )
}

describe('SegmentedControl', () => {
  it('is a radiogroup with one checked radio and one tab stop', () => {
    render(<Harness />)
    expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument()
    const list = screen.getByRole('radio', { name: 'List' })
    expect(list).toHaveAttribute('aria-checked', 'true')
    expect(list).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Board' })).toHaveAttribute('tabindex', '-1')
  })

  it('moves the selection with arrow keys, skipping disabled options', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('radio', { name: 'List' }), { key: 'ArrowRight' })
    const board = screen.getByRole('radio', { name: 'Board' })
    expect(board).toHaveAttribute('aria-checked', 'true')
    expect(board).toHaveFocus()
    fireEvent.keyDown(board, { key: 'ArrowRight' })
    const table = screen.getByRole('radio', { name: 'Table' })
    expect(table).toHaveAttribute('aria-checked', 'true')
    expect(table).toHaveFocus()
    fireEvent.keyDown(table, { key: 'ArrowLeft' })
    expect(screen.getByRole('radio', { name: 'Board' })).toHaveAttribute('aria-checked', 'true')
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(['board', 'table', 'board'])
  })

  it('selects on click and disables options', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const calendar = screen.getByRole('radio', { name: 'Calendar' })
    expect(calendar).toBeDisabled()
    fireEvent.click(calendar)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'Table' }))
    expect(onChange).toHaveBeenCalledWith('table')
  })
})
