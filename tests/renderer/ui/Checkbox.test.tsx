// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox } from '@renderer/ui'

describe('Checkbox', () => {
  it('is a checkbox named by its label and described by its hint', () => {
    render(<Checkbox label="Archived" hint="Show archived tasks too" />)
    const box = screen.getByRole('checkbox', { name: 'Archived' })
    expect(box).not.toBeChecked()
    expect(box).toHaveAccessibleDescription('Show archived tasks too')
  })

  it('toggles on click', () => {
    const onChange = vi.fn()
    render(<Checkbox label="Archived" onChange={onChange} />)
    const box = screen.getByRole('checkbox', { name: 'Archived' })
    fireEvent.click(box)
    expect(onChange).toHaveBeenCalledOnce()
    expect(box).toBeChecked()
  })

  it('reads as mixed when indeterminate', () => {
    render(<Checkbox label="Select all" indeterminate checked={false} onChange={() => {}} />)
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select all' })
    expect(box).toHaveAttribute('aria-checked', 'mixed')
    expect(box.indeterminate).toBe(true)
    expect(box).toBePartiallyChecked()
  })

  it('can be disabled', () => {
    render(<Checkbox label="Archived" disabled onChange={() => {}} />)
    const box = screen.getByRole('checkbox', { name: 'Archived' })
    expect(box).toBeDisabled()
    // jsdom still dispatches synthetic clicks to disabled inputs; browsers do not.
  })
})
