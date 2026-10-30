import { cx } from './cx'
import './Spinner.css'

export interface SpinnerProps {
  /** Announced to assistive tech. Omit when the surrounding control already says it is busy. */
  label?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/** For an action in progress. Loading content uses Skeleton instead. */
export function Spinner({ label, size = 'md', className }: SpinnerProps) {
  return (
    <span
      className={cx('ui-spinner', `ui-spinner--${size}`, className)}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    />
  )
}
