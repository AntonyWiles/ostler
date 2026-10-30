// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@renderer/ui'
import { Plus } from '@renderer/ui/icons'

describe('Button', () => {
  it('is a button named by its text, defaulting to type="button"', () => {
    const onClick = vi.fn()
    render(
      <Button variant="primary" icon={Plus} onClick={onClick}>
        New task
      </Button>
    )
    const button = screen.getByRole('button', { name: 'New task' })
    expect(button).toHaveAttribute('type', 'button')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is reachable and activates from the keyboard like any native button', () => {
    render(<Button>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    button.focus()
    expect(button).toHaveFocus()
  })

  it('gives the ai variant a decorative Sparkles icon, not a different name', () => {
    render(<Button variant="ai">Draft with AI</Button>)
    const button = screen.getByRole('button', { name: 'Draft with AI' })
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('is natively disabled without a reason', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Create
      </Button>
    )
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('says why it is disabled, stays focusable and ignores clicks', () => {
    const onClick = vi.fn()
    render(
      <Button disabled disabledReason="Add a title first" onClick={onClick}>
        Create
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Create' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveAccessibleDescription('Add a title first')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
    // Keyboard focus: a tooltip opens on focus that follows a key.
    fireEvent.keyDown(window, { key: 'Tab' })
    fireEvent.focus(button)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Add a title first')
  })

  it('announces busy while loading, keeps its name and ignores clicks', () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Saving' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})
