// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Card } from '@renderer/ui'

describe('Card', () => {
  it('is a plain, unfocusable surface by default', () => {
    render(<Card data-testid="card">Body</Card>)
    const card = screen.getByTestId('card')
    expect(card).not.toHaveAttribute('tabindex')
    expect(card).not.toHaveAttribute('aria-current')
  })

  it('renders as the element given', () => {
    render(
      <Card as="article" aria-label="Task">
        Body
      </Card>
    )
    expect(screen.getByRole('article', { name: 'Task' })).toBeInTheDocument()
  })

  it('is focusable and activates on Enter and Space when interactive with onClick', () => {
    const onClick = vi.fn()
    render(
      <Card interactive onClick={onClick} aria-label="Open task" data-testid="card">
        <button type="button">Inner</button>
      </Card>
    )
    const card = screen.getByTestId('card')
    expect(card).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(card, { key: 'Enter' })
    fireEvent.keyDown(card, { key: ' ' })
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('ignores Enter pressed on a control inside it', () => {
    const onClick = vi.fn()
    render(
      <Card interactive onClick={onClick}>
        <button type="button">Inner</button>
      </Card>
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'Inner' }), { key: 'Enter' })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('is not focusable when interactive without onClick, and marks selection', () => {
    render(
      <Card interactive selected data-testid="card">
        Body
      </Card>
    )
    const card = screen.getByTestId('card')
    expect(card).not.toHaveAttribute('tabindex')
    expect(card).toHaveAttribute('aria-current', 'true')
  })
})
