import type { ReactNode } from 'react'
import { Button } from './Button'
import { ErrorText } from './ErrorText'
import { IconButton } from './IconButton'
import { CircleAlert, CircleCheck, Icon, Info, TriangleAlert, X } from './icons'
import { cx } from './cx'
import './InlineAlert.css'
import { t } from '@shared/i18n'

export type InlineAlertTone = 'info' | 'success' | 'warning' | 'danger'

export interface InlineAlertProps {
  tone?: InlineAlertTone
  title?: string
  children?: ReactNode
  action?: { label: string; onClick: () => void }
  /** Shows a dismiss button. */
  onDismiss?: () => void
  className?: string
}

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert }

/**
 * A page-level or form-level message. Warnings and errors are announced at
 * once (role="alert"); info and success politely (role="status").
 */
export function InlineAlert({
  tone = 'info',
  title,
  children,
  action,
  onDismiss,
  className
}: InlineAlertProps) {
  const urgent = tone === 'danger' || tone === 'warning'
  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={cx('ui-inline-alert', `ui-inline-alert--${tone}`, className)}
    >
      <span className="ui-inline-alert__icon">
        <Icon icon={ICONS[tone]} />
      </span>
      <div className="ui-inline-alert__text">
        {title && <p className="ui-inline-alert__title">{title}</p>}
        {children && (
          <div className="ui-inline-alert__body">
            <ErrorText>{children}</ErrorText>
          </div>
        )}
      </div>
      {action && (
        <Button size="sm" variant="secondary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
      {onDismiss && (
        <IconButton
          label={t('common:inlineAlert.dismiss')}
          icon={X}
          size="sm"
          onClick={onDismiss}
        />
      )}
    </div>
  )
}
