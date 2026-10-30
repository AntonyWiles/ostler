import type { ReactNode } from 'react'
import { cx } from './cx'
import './PageHeader.css'

export interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /** The page's one primary action, and at most a few quiet ones. */
  actions?: ReactNode
  className?: string
}

/** A page's title, subtitle and actions (title left, actions right). */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header className={cx('ui-page-header', className)}>
      <div className="ui-page-header__titles">
        <h1 className="ui-page-header__title">{title}</h1>
        {subtitle && <p className="ui-page-header__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  )
}
