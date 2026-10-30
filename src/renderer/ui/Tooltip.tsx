import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref
} from 'react'
import { Portal } from './Portal'
import { Kbd } from './Kbd'
import { assignRef } from './assign-ref'
import { lastInputWasKeyboard } from './input-modality'
import { useAnchoredPosition } from './overlay/layer'
import type { Placement } from './overlay/position'
import './Tooltip.css'

/** Hover delay before a tooltip opens. Focus opens it at once. */
export const TOOLTIP_DELAY_MS = 400

type TriggerProps = {
  ref?: Ref<HTMLElement>
  'aria-describedby'?: string
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void
  onMouseLeave?: (event: MouseEvent<HTMLElement>) => void
  onFocus?: (event: FocusEvent<HTMLElement>) => void
  onBlur?: (event: FocusEvent<HTMLElement>) => void
}

export interface TooltipProps {
  content: ReactNode
  /** One focusable element: the tooltip attaches to it. */
  children: ReactElement<TriggerProps>
  placement?: Placement
  /**
   * Adds the tooltip to the trigger's `aria-describedby`. Turn off when the
   * tooltip only repeats the trigger's accessible name (IconButton).
   */
  describe?: boolean
  /**
   * The keys of the trigger's shortcut, from the shortcut table
   * (`shortcut(id).keys`), shown after the content as keycaps.
   */
  shortcut?: string
}

/**
 * A short label shown on hover (after 400 ms) and on keyboard focus (at
 * once). Focus the page gives itself, as a window opens or comes back, opens
 * nothing: a tooltip shown then stayed until the pointer passed over its
 * trigger. Escape, and the window losing focus, close it. Never put the only
 * copy of essential information here.
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  describe = true,
  shortcut
}: TooltipProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const floatingRef = useRef<HTMLDivElement | null>(null)
  const style = useAnchoredPosition(open, anchorRef, floatingRef, { placement })

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clear, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onWindowBlur = () => setOpen(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [open])

  if (content === null || content === undefined || content === '') return children

  const props = children.props
  const describedBy = [props['aria-describedby'], describe ? id : null].filter(Boolean).join(' ')
  return (
    <>
      {cloneElement(children, {
        ref: (node: HTMLElement | null) => {
          anchorRef.current = node
          assignRef(props.ref, node)
        },
        'aria-describedby': describedBy || undefined,
        onMouseEnter: (event) => {
          props.onMouseEnter?.(event)
          clear()
          timer.current = setTimeout(() => setOpen(true), TOOLTIP_DELAY_MS)
        },
        onMouseLeave: (event) => {
          props.onMouseLeave?.(event)
          clear()
          setOpen(false)
        },
        onFocus: (event) => {
          props.onFocus?.(event)
          clear()
          if (lastInputWasKeyboard()) setOpen(true)
        },
        onBlur: (event) => {
          props.onBlur?.(event)
          clear()
          setOpen(false)
        }
      })}
      {/* Always in the DOM (hidden when closed) so aria-describedby resolves. */}
      <Portal>
        <div
          ref={floatingRef}
          id={id}
          role="tooltip"
          className="ui-tooltip"
          hidden={!open}
          style={open ? style : undefined}
        >
          {content}
          {shortcut && <Kbd shortcut={shortcut} className="ui-tooltip__kbd" />}
        </div>
      </Portal>
    </>
  )
}
