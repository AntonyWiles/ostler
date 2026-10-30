// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetDismissableStackForTests,
  DismissableScope,
  useDismissable
} from '@renderer/hooks/useDismissable'

/** A portalled backdrop with the hook attached, as an overlay uses it. */
function ModalBackdrop({
  className,
  onClose,
  canDismiss = true,
  closeOnBackdrop = true,
  children
}: {
  className: string
  onClose: () => void
  canDismiss?: boolean
  closeOnBackdrop?: boolean
  children: ReactNode
}) {
  const backdropProps = useDismissable(onClose, { canDismiss, closeOnBackdrop })
  return createPortal(
    <div className={className} role="presentation" {...backdropProps}>
      <DismissableScope of={backdropProps.ref}>{children}</DismissableScope>
    </div>,
    document.body
  )
}

function pressEscape() {
  fireEvent.keyDown(window, { key: 'Escape' })
}

describe('useDismissable', () => {
  beforeEach(() => {
    __resetDismissableStackForTests()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <ModalBackdrop className="backdrop" onClose={onClose}>
        <div role="dialog">body</div>
      </ModalBackdrop>
    )
    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape from the moment it is on the page', () => {
    // Anything that sees the overlay as soon as it is in the page (a test's
    // findBy, a fast key press) comes before React's passive effects. The
    // sibling below runs at that point: just after the overlay's commit.
    function PressEscapeNow() {
      useLayoutEffect(() => pressEscape(), [])
      return null
    }
    const onClose = vi.fn()
    render(
      <>
        <ModalBackdrop className="backdrop" onClose={onClose}>
          <div role="dialog">body</div>
        </ModalBackdrop>
        <PressEscapeNow />
      </>
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes only the innermost overlay, one Escape at a time', () => {
    const closeOuter = vi.fn()
    const closeInner = vi.fn()
    render(
      <ModalBackdrop className="outer" onClose={closeOuter}>
        <div role="dialog">outer</div>
        <ModalBackdrop className="inner" onClose={closeInner}>
          <div role="dialog">inner</div>
        </ModalBackdrop>
      </ModalBackdrop>
    )
    pressEscape()
    expect(closeInner).toHaveBeenCalledTimes(1)
    expect(closeOuter).not.toHaveBeenCalled()
  })

  it('swallows Escape while busy rather than closing the overlay behind it', () => {
    const closeOuter = vi.fn()
    const closeInner = vi.fn()
    render(
      <ModalBackdrop className="outer" onClose={closeOuter}>
        <div role="dialog">outer</div>
        <ModalBackdrop className="inner" onClose={closeInner} canDismiss={false}>
          <div role="dialog">inner</div>
        </ModalBackdrop>
      </ModalBackdrop>
    )
    pressEscape()
    expect(closeInner).not.toHaveBeenCalled()
    expect(closeOuter).not.toHaveBeenCalled()
  })

  it('closes on a mousedown that starts on the backdrop itself', () => {
    const onClose = vi.fn()
    render(
      <ModalBackdrop className="backdrop" onClose={onClose}>
        <div role="dialog">body</div>
      </ModalBackdrop>
    )
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.mouseDown(screen.getByRole('presentation'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('leaves the backdrop inert when closeOnBackdrop is off, but still honours Escape', () => {
    const onClose = vi.fn()
    render(
      <ModalBackdrop className="backdrop" onClose={onClose} closeOnBackdrop={false}>
        <div role="dialog">body</div>
      </ModalBackdrop>
    )
    fireEvent.mouseDown(screen.getByRole('presentation'))
    expect(onClose).not.toHaveBeenCalled()

    pressEscape()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ignores an Escape that belongs to an IME candidate window', () => {
    const onClose = vi.fn()
    render(
      <ModalBackdrop className="backdrop" onClose={onClose}>
        <div role="dialog">body</div>
      </ModalBackdrop>
    )
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('restores focus to whatever was focused before the overlay opened', () => {
    function Harness() {
      return (
        <>
          <button id="opener">Open</button>
          <ModalBackdrop className="backdrop" onClose={() => undefined}>
            <div role="dialog">body</div>
          </ModalBackdrop>
        </>
      )
    }
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(<Harness />)
    unmount()
    expect(document.activeElement).toBe(opener)
  })
})
