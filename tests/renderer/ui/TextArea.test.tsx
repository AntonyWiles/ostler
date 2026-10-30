// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TextArea } from '@renderer/ui'

describe('TextArea', () => {
  it('is a multi-line textbox named by its label', () => {
    render(<TextArea label="Notes" defaultValue="" />)
    const area = screen.getByRole('textbox', { name: 'Notes' })
    expect(area.tagName).toBe('TEXTAREA')
    expect(area).toHaveAttribute('rows', '3')
  })

  it('describes the field with its error and marks it invalid', () => {
    render(<TextArea label="Notes" hint="Markdown works" error="Too long" />)
    const area = screen.getByRole('textbox', { name: 'Notes' })
    expect(area).toHaveAttribute('aria-invalid', 'true')
    expect(area).toHaveAccessibleDescription('Too long Markdown works')
  })

  it('fires onChange as the user types', () => {
    const onChange = vi.fn()
    render(<TextArea label="Notes" value="" onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), {
      target: { value: 'line one' }
    })
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('can be disabled', () => {
    render(<TextArea label="Notes" disabled />)
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeDisabled()
  })
})
