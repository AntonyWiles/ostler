import type { HTMLAttributes, ReactNode } from 'react'
import { Icon, type LucideIcon } from './icons'
import { cx } from './cx'
import './Badge.css'

export type BadgeTone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  icon?: LucideIcon
  children: ReactNode
}

/** A short label: a count, a state, a kind. Colour never carries the meaning alone. */
export function Badge({ tone = 'neutral', icon, className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={cx('ui-badge', `ui-badge--${tone}`, className)}>
      {icon && <Icon icon={icon} />}
      {children}
    </span>
  )
}
