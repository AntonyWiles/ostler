import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react'
import { cx } from './cx'
import './Card.css'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'li'
  /**
   * Hover and focus styles. With `onClick`, the card is also focusable and
   * Enter or Space activates it; give it an `aria-label`.
   */
  interactive?: boolean
  selected?: boolean
  padding?: 'none' | 'sm' | 'md'
  children?: ReactNode
}

/** A surface with a border and radius. */
export function Card({
  as: Tag = 'div',
  interactive = false,
  selected = false,
  padding = 'md',
  className,
  onClick,
  onKeyDown,
  children,
  ...rest
}: CardProps) {
  const clickable = interactive && !!onClick
  return (
    <Tag
      {...rest}
      className={cx(
        'ui-card',
        `ui-card--pad-${padding}`,
        interactive && 'is-interactive',
        selected && 'is-selected',
        className
      )}
      tabIndex={clickable ? (rest.tabIndex ?? 0) : rest.tabIndex}
      aria-current={selected || undefined}
      onClick={onClick}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        onKeyDown?.(event)
        if (!clickable || event.defaultPrevented || event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.currentTarget.click()
        }
      }}
    >
      {children}
    </Tag>
  )
}
