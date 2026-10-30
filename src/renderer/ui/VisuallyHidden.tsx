import type { HTMLAttributes } from 'react'
import { cx } from './cx'
import './VisuallyHidden.css'

/** Text for assistive tech only: in the accessibility tree, off the screen. */
export function VisuallyHidden({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...rest} className={cx('ui-visually-hidden', className)} />
}
