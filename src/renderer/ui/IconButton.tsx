import type { ButtonHTMLAttributes, Ref } from 'react'
import { Icon, type LucideIcon } from './icons'
import { Tooltip } from './Tooltip'
import { cx } from './cx'
import './IconButton.css'

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> {
  /** Required: the accessible name and the tooltip. */
  label: string
  icon: LucideIcon
  /** Extra classes for the icon, e.g. chevronClass() on a disclosure. */
  iconClassName?: string
  /** A toggle: sets `aria-pressed`. */
  pressed?: boolean
  size?: 'sm' | 'md'
  variant?: 'ghost' | 'secondary' | 'danger'
  ref?: Ref<HTMLButtonElement>
  /** The keys of its shortcut, from the shortcut table: shown in the tooltip. */
  shortcut?: string
}

/** An icon-only button. Its label is both the tooltip and the `aria-label`. */
export function IconButton({
  label,
  icon,
  iconClassName,
  pressed,
  size = 'md',
  variant = 'ghost',
  type = 'button',
  className,
  ref,
  shortcut,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip content={label} describe={false} shortcut={shortcut}>
      <button
        {...rest}
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        className={cx(
          'ui-icon-button',
          `ui-icon-button--${size}`,
          `ui-icon-button--${variant}`,
          className
        )}
      >
        <Icon icon={icon} size={size === 'md' ? 'lg' : 'md'} className={iconClassName} />
      </button>
    </Tooltip>
  )
}
