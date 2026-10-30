// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VisuallyHidden } from '@renderer/ui'

describe('VisuallyHidden', () => {
  it('keeps its text in the accessible name', () => {
    render(
      <button type="button">
        <span aria-hidden="true">×</span>
        <VisuallyHidden>Close panel</VisuallyHidden>
      </button>
    )
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeInTheDocument()
    expect(screen.getByText('Close panel')).toHaveClass('ui-visually-hidden')
  })
})
