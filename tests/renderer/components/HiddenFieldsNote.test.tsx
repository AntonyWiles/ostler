// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HiddenFieldsNote } from '@renderer/components/HiddenFieldsNote'

/**
 * The quiet note under a form that leaves something out (a task type's
 * fields): a sentence of what is hidden and where, then the button that shows it.
 */

describe('the hidden fields note', () => {
  it('says what is hidden, then offers to show it', () => {
    const onAction = vi.fn()
    render(<HiddenFieldsNote message="Something is hidden." action="Show it" onAction={onAction} />)
    const note = screen.getByText('Something is hidden.').closest('p')
    expect(note).toHaveClass('hidden-fields-note')
    fireEvent.click(screen.getByRole('button', { name: 'Show it' }))
    expect(onAction).toHaveBeenCalledOnce()
  })

  it('is the button alone, a quiet link, with no sentence', () => {
    render(<HiddenFieldsNote action="Show all fields" onAction={() => {}} />)
    const note = screen.getByRole('button', { name: 'Show all fields' }).closest('p')
    expect(note).toHaveClass('hidden-fields-note')
    expect(note).toHaveTextContent(/^Show all fields$/)
  })
})
