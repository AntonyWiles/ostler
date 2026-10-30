// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, Dialog } from '@renderer/ui'
import { __resetDismissableStackForTests } from '@renderer/hooks/useDismissable'

afterEach(() => __resetDismissableStackForTests())

function Harness({ canDismiss = true }: { canDismiss?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New goal"
        description="What should be true when it is done."
        canDismiss={canDismiss}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary">Create goal</Button>
          </>
        }
      >
        <input aria-label="Goal title" />
      </Dialog>
    </>
  )
}

function openDialog() {
  const opener = screen.getByRole('button', { name: 'Open' })
  opener.focus()
  fireEvent.click(opener)
  return opener
}

describe('Dialog', () => {
  it('is a modal dialog named by its title and described by its description', () => {
    render(<Harness />)
    openDialog()
    const dialog = screen.getByRole('dialog', { name: 'New goal' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('What should be true when it is done.')
    // Rendered into document.body, outside the app's stacking context.
    expect(dialog.closest('#root')).toBeNull()
  })

  it('moves focus inside on open and traps Tab and Shift+Tab', () => {
    render(<Harness />)
    openDialog()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    const close = screen.getByRole('button', { name: 'Close' })
    const create = screen.getByRole('button', { name: 'Create goal' })
    create.focus()
    fireEvent.keyDown(create, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(create).toHaveFocus()
  })

  it('closes on Escape and returns focus to the opener', () => {
    render(<Harness />)
    const opener = openDialog()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('closes from its close button and from a backdrop mousedown', () => {
    render(<Harness />)
    openDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    openDialog()
    const backdrop = screen.getByRole('dialog').parentElement!
    fireEvent.mouseDown(backdrop)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ignores Escape and disables the close button while it cannot be dismissed', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose} title="Saving" canDismiss={false}>
        Busy
      </Dialog>
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
  })

  it('locks page scroll while open', () => {
    render(<Harness />)
    openDialog()
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.body.style.overflow).toBe('')
  })
})
