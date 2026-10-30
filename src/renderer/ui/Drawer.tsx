import {
  useCallback,
  useId,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { IconButton } from './IconButton'
import { Portal } from './Portal'
import { DismissableScope } from '../hooks/useDismissable'
import { X } from './icons'
import { useModalLayer } from './overlay/layer'
import { cx } from './cx'
import './Drawer.css'
import { t } from '@shared/i18n'

export const DRAWER_MIN_WIDTH = 320
export const DRAWER_DEFAULT_WIDTH = 480
const KEYBOARD_STEP = 32
const STORAGE_PREFIX = 'ostler.drawer-width.'

/** Whether any drawer has been resized: the person already knows they can. */
export function hasResizedDrawer(): boolean {
  try {
    for (let index = 0; index < window.localStorage.length; index += 1)
      if (window.localStorage.key(index)?.startsWith(STORAGE_PREFIX)) return true
  } catch {
    // No storage: say no, and the tip shows once more than it needs to.
  }
  return false
}

/** The widest a drawer may be: 90% of the window. */
function maxWidth(): number {
  return Math.max(DRAWER_MIN_WIDTH, Math.floor(window.innerWidth * 0.9))
}

export function clampDrawerWidth(width: number, max = maxWidth()): number {
  return Math.round(Math.min(Math.max(width, DRAWER_MIN_WIDTH), max))
}

function readWidth(id: string, fallback: number): number {
  try {
    const stored = Number(window.localStorage.getItem(STORAGE_PREFIX + id))
    return Number.isFinite(stored) && stored > 0 ? clampDrawerWidth(stored) : fallback
  } catch {
    return fallback
  }
}

function saveWidth(id: string, width: number): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, String(width))
  } catch {
    // Storage is a convenience: a drawer that forgets its width still works.
  }
}

export interface DrawerProps {
  /** Remembers this drawer's width under this id ("task", "library-item"). */
  id: string
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** Header actions beside the close button. */
  actions?: ReactNode
  /** Header content before the title: a status, a type mark. */
  headerStart?: ReactNode
  defaultWidth?: number
  canDismiss?: boolean
  closeOnBackdrop?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Where focus goes back to on close if the opener was re-created (see useModalLayer). */
  returnFocusTo?: () => HTMLElement | null
  className?: string
  /** Keys pressed in the panel, before the drawer's own (Escape, Tab). */
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
  /** A paste anywhere in the panel. */
  onPaste?: (event: ClipboardEvent<HTMLElement>) => void
}

/**
 * A side panel for viewing or editing one item while its list stays in view.
 * The same rules as Dialog (focus trap, Escape, focus return), plus a
 * resizable width that is remembered per drawer.
 */
export function Drawer(props: DrawerProps) {
  if (!props.open) return null
  return <DrawerLayer {...props} />
}

function DrawerLayer({
  id,
  onClose,
  title,
  description,
  children,
  footer,
  actions,
  headerStart,
  defaultWidth = DRAWER_DEFAULT_WIDTH,
  canDismiss = true,
  closeOnBackdrop = true,
  initialFocusRef,
  returnFocusTo,
  className,
  onKeyDown,
  onPaste
}: DrawerProps) {
  const titleId = useId()
  const descriptionId = useId()
  const [width, setWidthState] = useState(() => readWidth(id, clampDrawerWidth(defaultWidth)))
  const { backdropProps, panelRef, onPanelKeyDown } = useModalLayer({
    onClose,
    canDismiss,
    closeOnBackdrop,
    initialFocusRef,
    returnFocusTo
  })

  const setWidth = useCallback(
    (next: number) => {
      const clamped = clampDrawerWidth(next)
      setWidthState(clamped)
      saveWidth(id, clamped)
    },
    [id]
  )

  const onResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // The handle is on the left edge: Left widens, Right narrows.
    const delta = { ArrowLeft: KEYBOARD_STEP, ArrowRight: -KEYBOARD_STEP }[event.key]
    if (delta !== undefined) {
      event.preventDefault()
      setWidth(width + delta)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setWidth(DRAWER_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      setWidth(maxWidth())
    }
  }

  const onResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture?.(event.pointerId)
    const move = (moveEvent: globalThis.PointerEvent) =>
      setWidth(window.innerWidth - moveEvent.clientX)
    const stop = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  return (
    <Portal>
      <DismissableScope of={backdropProps.ref}>
        <div
          className="ui-backdrop ui-drawer-backdrop"
          data-ui-layer=""
          role="presentation"
          {...backdropProps}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            className={cx('ui-drawer', className)}
            style={{ width }}
            onPaste={onPaste}
            onKeyDown={(event) => {
              onKeyDown?.(event)
              onPanelKeyDown(event)
            }}
          >
            <header className="ui-drawer__header">
              {headerStart && <div className="ui-drawer__start">{headerStart}</div>}
              <div className="ui-drawer__titles">
                <h2 id={titleId} className="ui-drawer__title">
                  {title}
                </h2>
                {description && (
                  <p id={descriptionId} className="ui-drawer__description">
                    {description}
                  </p>
                )}
              </div>
              <div className="ui-drawer__actions">
                {actions}
                <IconButton
                  label={t('common:drawer.close')}
                  icon={X}
                  size="sm"
                  onClick={onClose}
                  disabled={!canDismiss}
                />
              </div>
            </header>
            <div className="ui-drawer__body">{children}</div>
            {footer && <footer className="ui-drawer__footer">{footer}</footer>}
            {/* Last in the DOM, so it is not where focus lands on open. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t('common:drawer.resizePanel')}
              aria-valuenow={width}
              aria-valuemin={DRAWER_MIN_WIDTH}
              aria-valuemax={maxWidth()}
              tabIndex={0}
              className="ui-drawer__resize"
              // On the control, not the grip: a tip can't point at what is aria-hidden.
              data-tour="drawer-resize"
              onKeyDown={onResizeKey}
              onPointerDown={onResizeStart}
            >
              <span className="ui-drawer__grip" aria-hidden="true" />
            </div>
          </div>
        </div>
      </DismissableScope>
    </Portal>
  )
}
