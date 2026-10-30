// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { IconButton } from '@renderer/ui'
import { X } from '@renderer/ui/icons'

describe('IconButton', () => {
  it('is a button named by its label, without describing itself twice', () => {
    render(<IconButton label="Close" icon={X} />)
    const button = screen.getByRole('button', { name: 'Close' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).not.toHaveAttribute('aria-describedby')
  })

  it('reports pressed state when it is a toggle', () => {
    render(<IconButton label="Pin" icon={X} pressed />)
    expect(screen.getByRole('button', { name: 'Pin' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows its label as a tooltip on focus', () => {
    render(<IconButton label="Close" icon={X} />)
    // Keyboard focus: a tooltip opens on focus that follows a key.
    fireEvent.keyDown(window, { key: 'Tab' })
    fireEvent.focus(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Close')
  })

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn()
    render(<IconButton label="Close" icon={X} disabled onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Close' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
