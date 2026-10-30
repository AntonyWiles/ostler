// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Popover } from '@renderer/ui'

function Harness() {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  return (
    <>
      <button ref={anchorRef} type="button" onClick={() => setOpen((was) => !was)}>
        Filters
      </button>
      <p>Outside</p>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} label="Filter">
        <button type="button">Apply</button>
      </Popover>
    </>
  )
}

function openPopover() {
  const trigger = screen.getByRole('button', { name: 'Filters' })
  trigger.focus()
  fireEvent.click(trigger)
  return trigger
}

describe('Popover', () => {
  it('is a dialog named by its label, rendered into document.body, focusing its first control', () => {
    const { container } = render(<Harness />)
    openPopover()
    const popover = screen.getByRole('dialog', { name: 'Filter' })
    expect(container.contains(popover)).toBe(false)
    expect(document.body.contains(popover)).toBe(true)
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveFocus()
  })

  it('closes on Escape and returns focus to the opener', () => {
    render(<Harness />)
    const trigger = openPopover()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes when Tab leaves it at either end, with focus back on the opener', () => {
    render(<Harness />)
    let trigger = openPopover()
    const apply = screen.getByRole('button', { name: 'Apply' })
    // Tab past the last control: closed, rather than off to the end of the page.
    fireEvent.keyDown(apply, { key: 'Tab' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    trigger = openPopover()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Apply' }), { key: 'Tab', shiftKey: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('keeps Tab inside while there is a control to move to', () => {
    function Two() {
      const [open, setOpen] = useState(true)
      const anchorRef = useRef<HTMLButtonElement | null>(null)
      return (
        <>
          <button ref={anchorRef} type="button">
            Filters
          </button>
          <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} label="Filter">
            <button type="button">Clear</button>
            <button type="button">Apply</button>
          </Popover>
        </>
      )
    }
    render(<Two />)
    const clear = screen.getByRole('button', { name: 'Clear' })
    expect(clear).toHaveFocus()
    const tab = fireEvent.keyDown(clear, { key: 'Tab' })
    // Not handled: the browser moves on to Apply.
    expect(tab).toBe(true)
    expect(screen.getByRole('dialog', { name: 'Filter' })).toBeInTheDocument()
  })

  it('closes on a mousedown outside, but not inside', () => {
    render(<Harness />)
    openPopover()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Apply' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText('Outside'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
