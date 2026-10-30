import type { ReactNode } from 'react'
import { Icon, type LucideIcon } from './icons'
import { cx } from './cx'
import './EmptyState.css'

export interface EmptyStateProps {
  icon?: LucideIcon
  /** What goes here: "No tasks yet". */
  title: string
  /** One sentence on why it is useful. */
  description?: ReactNode
  /** The first action, usually a primary Button. */
  action?: ReactNode
  /** An optional quieter link or ghost button. */
  secondaryAction?: ReactNode
  headingLevel?: 2 | 3
  className?: string
}

/** Says what goes here, why it helps, and offers the first step. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  headingLevel = 2,
  className
}: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <div className={cx('ui-empty-state', className)}>
      {icon && (
        <span className="ui-empty-state__icon">
          <Icon icon={icon} size="lg" />
        </span>
      )}
      <Heading className="ui-empty-state__title">{title}</Heading>
      {description && <p className="ui-empty-state__description">{description}</p>}
      {(action || secondaryAction) && (
        <div className="ui-empty-state__actions">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}
