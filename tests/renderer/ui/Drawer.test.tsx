// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Drawer } from '@renderer/ui'
import { findTarget } from '@renderer/tips/targets'

const KEY = 'ostler.drawer-width.task'

function Harness({ canDismiss = true }: { canDismiss?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open task
      </button>
      <Drawer
        id="task"
        open={open}
        onClose={() => setOpen(false)}
        title="Fix the build"
        description="Task details"
        canDismiss={canDismiss}
      >
        <input aria-label="Name" />
      </Drawer>
    </>
  )
}

/**
 * The opener is re-created while the drawer is open, as a task's card is when
 * it moves column; `returnFocusTo` finds its replacement.
 */
function RecreatedOpener() {
  const [open, setOpen] = useState(false)
  const [generation, setGeneration] = useState(0)
  return (
    <>
      <button key={generation} type="button" data-opener="" onClick={() => setOpen(true)}>
        Open task
      </button>
      <Drawer
        id="task"
        open={open}
        onClose={() => setOpen(false)}
        title="Fix the build"
        returnFocusTo={() => document.querySelector<HTMLElement>('[data-opener]')}
      >
        <button type="button" onClick={() => setGeneration((next) => next + 1)}>
          Move the task
        </button>
      </Drawer>
    </>
  )
}

function openDrawer() {
  const opener = screen.getByRole('button', { name: 'Open task' })
  opener.focus()
  fireEvent.click(opener)
  return opener
}

describe('Drawer', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders nothing while closed', () => {
    render(<Harness />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is a modal dialog named by its title and described by its description', () => {
    render(<Harness />)
    openDrawer()
    const dialog = screen.getByRole('dialog', { name: 'Fix the build' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('Task details')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('closes on Escape and returns focus to the opener', () => {
    render(<Harness />)
    const opener = openDrawer()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('returns focus to returnFocusTo when the opener was re-created while open', () => {
    render(<RecreatedOpener />)
    const opener = openDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Move the task' }))
    expect(opener.isConnected).toBe(false)

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open task' })).toHaveFocus()
  })

  it('closes from its Close button', () => {
    render(<Harness />)
    openDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cannot be dismissed while canDismiss is false', () => {
    render(<Harness canDismiss={false} />)
    openDrawer()
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('resizes with arrow keys and remembers the width', () => {
    render(<Harness />)
    openDrawer()
    const handle = screen.getByRole('separator', { name: 'Resize panel' })
    expect(handle).toHaveAttribute('aria-valuenow', '480')
    expect(handle).toHaveAttribute('aria-valuemin', '320')
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handle).toHaveAttribute('aria-valuenow', '512')
    expect(window.localStorage.getItem(KEY)).toBe('512')
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(handle).toHaveAttribute('aria-valuenow', '448')
    fireEvent.keyDown(handle, { key: 'Home' })
    expect(handle).toHaveAttribute('aria-valuenow', '320')
    expect(window.localStorage.getItem(KEY)).toBe('320')
  })

  it('gives the resize tip a target it can point at: the separator, not its hidden grip', () => {
    // jsdom lays nothing out: every element counts as on screen.
    const rects = vi
      .spyOn(Element.prototype, 'getClientRects')
      .mockReturnValue([{}] as unknown as DOMRectList)
    render(<Harness />)
    openDrawer()
    expect(findTarget('[data-tour="drawer-resize"]')).toBe(
      screen.getByRole('separator', { name: 'Resize panel' })
    )
    rects.mockRestore()
  })

  it('opens at the remembered width', () => {
    window.localStorage.setItem(KEY, '600')
    render(<Harness />)
    openDrawer()
    expect(screen.getByRole('separator', { name: 'Resize panel' })).toHaveAttribute(
      'aria-valuenow',
      '600'
    )
  })
  it('puts headerStart before the title, outside the dialog name', () => {
    render(
      <Drawer
        id="lead"
        open
        onClose={() => {}}
        title="Fix the build"
        headerStart={<span>Ready</span>}
      >
        body
      </Drawer>
    )
    const dialog = screen.getByRole('dialog', { name: 'Fix the build' })
    expect(dialog.querySelector('.ui-drawer__start')?.textContent).toBe('Ready')
  })
})
