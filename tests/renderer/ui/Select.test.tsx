// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Select } from '@renderer/ui'

const OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'high', label: 'High' },
  { value: 'gone', label: 'Gone', disabled: true }
]

describe('Select', () => {
  it('is a native combobox named by its label', () => {
    render(<Select label="Priority" options={OPTIONS} defaultValue="low" />)
    const select = screen.getByRole('combobox', { name: 'Priority' })
    expect(select.tagName).toBe('SELECT')
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByRole('option', { name: 'Gone' })).toBeDisabled()
  })

  it('fires onChange when a choice is made', () => {
    const onChange = vi.fn()
    render(<Select label="Priority" options={OPTIONS} value="low" onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Priority' }), {
      target: { value: 'high' }
    })
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('describes errors and marks the select invalid', () => {
    render(<Select label="Priority" options={OPTIONS} error="Pick one" />)
    const select = screen.getByRole('combobox', { name: 'Priority' })
    expect(select).toHaveAttribute('aria-invalid', 'true')
    expect(select).toHaveAccessibleDescription('Pick one')
  })

  it('can be disabled', () => {
    render(<Select label="Priority" options={OPTIONS} disabled />)
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeDisabled()
  })
})
