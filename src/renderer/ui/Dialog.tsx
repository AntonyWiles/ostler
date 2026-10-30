import { useId, type ReactNode, type RefObject } from 'react'
import { IconButton } from './IconButton'
import { Portal } from './Portal'
import { DismissableScope } from '../hooks/useDismissable'
import { X } from './icons'
import { useModalLayer } from './overlay/layer'
import { cx } from './cx'
import './Dialog.css'
import { t } from '@shared/i18n'

export type DialogSize = 'sm' | 'md' | 'lg' | 'full'

export interface DialogProps {
  open: boolean
  onClose: () => void
  /** Required: the heading and the dialog's accessible name. */
  title: ReactNode
  /** A line under the title, read as the dialog's description. */
  description?: ReactNode
  size?: DialogSize
  children?: ReactNode
  /** Footer actions, right-aligned, primary last. */
  footer?: ReactNode
  /** False while busy: Escape, the backdrop and the close button do nothing. */
  canDismiss?: boolean
  /** False when the dialog holds edits a stray click would lose. Escape still closes. */
  closeOnBackdrop?: boolean
  /** What to focus on open. Otherwise `[data-autofocus]`, then the first focusable. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Where focus goes back to on close if the opener has gone (see useModalLayer). */
  returnFocusTo?: () => HTMLElement | null
  /** Element role: `alertdialog` for confirmations. */
  role?: 'dialog' | 'alertdialog'
  className?: string
}

/**
 * A modal: focus trap, Escape to close, focus back to the opener, scroll lock.
 * Short, focused decisions and creation forms. Rendered into document.body.
 */
export function Dialog(props: DialogProps) {
  if (!props.open) return null
  return <DialogLayer {...props} />
}

function DialogLayer({
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
  canDismiss = true,
  closeOnBackdrop = true,
  initialFocusRef,
  returnFocusTo,
  role = 'dialog',
  className
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const { backdropProps, panelRef, onPanelKeyDown } = useModalLayer({
    onClose,
    canDismiss,
    closeOnBackdrop,
    initialFocusRef,
    returnFocusTo
  })

  return (
    <Portal>
      <DismissableScope of={backdropProps.ref}>
        <div
          className="ui-backdrop ui-dialog-backdrop"
          data-ui-layer=""
          role="presentation"
          {...backdropProps}
        >
          <div
            ref={panelRef}
            role={role}
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            className={cx('ui-dialog', `ui-dialog--${size}`, className)}
            onKeyDown={onPanelKeyDown}
          >
            <header className="ui-dialog__header">
              <div className="ui-dialog__titles">
                <h2 id={titleId} className="ui-dialog__title">
                  {title}
                </h2>
                {description && (
                  <p id={descriptionId} className="ui-dialog__description">
                    {description}
                  </p>
                )}
              </div>
              <IconButton
                label={t('common:dialog.close')}
                icon={X}
                size="sm"
                onClick={onClose}
                disabled={!canDismiss}
              />
            </header>
            {children !== undefined && <div className="ui-dialog__body">{children}</div>}
            {footer && <footer className="ui-dialog__footer">{footer}</footer>}
          </div>
        </div>
      </DismissableScope>
    </Portal>
  )
}
