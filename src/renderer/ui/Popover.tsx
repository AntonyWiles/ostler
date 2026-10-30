import { useEffect, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Portal } from './Portal'
import { tabbableIn, useAnchoredLayer } from './overlay/layer'
import type { Placement } from './overlay/position'
import { cx } from './cx'
import './Popover.css'

export interface PopoverProps {
  open: boolean
  onClose: () => void
  /** The element it hangs from (usually the button that opened it). */
  anchorRef: RefObject<HTMLElement | null>
  /** Names the popover for assistive tech. */
  label: string
  placement?: Placement
  /** Move focus to the first focusable inside on open. Default on. */
  autoFocus?: boolean
  children: ReactNode
  className?: string
}

/**
 * A non-modal panel anchored to an element. Click outside, Escape or Tab past
 * either end closes it, and focus goes back to the opener. Rendered into
 * document.body.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  label,
  placement = 'bottom-start',
  autoFocus = true,
  children,
  className
}: PopoverProps) {
  const { floatingRef, style } = useAnchoredLayer({ open, onClose, anchorRef, placement })

  useEffect(() => {
    if (!open || !autoFocus) return
    const panel = floatingRef.current
    if (panel) (tabbableIn(panel)[0] ?? panel).focus()
  }, [open, autoFocus, floatingRef])

  if (!open) return null

  // The popover sits at the end of the page, so Tab past its last control (or
  // Shift+Tab before its first) would leave for the end of the page. It closes
  // instead, and focus goes back to the opener, where Tab carries on.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const panel = floatingRef.current
    if (event.key !== 'Tab' || !panel) return
    const items = tabbableIn(panel)
    const active = document.activeElement
    const leaving =
      items.length === 0 ||
      (event.shiftKey ? active === items[0] || active === panel : active === items.at(-1))
    if (!leaving) return
    event.preventDefault()
    onClose()
  }

  return (
    <Portal>
      <div
        ref={floatingRef}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className={cx('ui-floating', 'ui-popover', className)}
        style={style}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </Portal>
  )
}
