import { useId, type ButtonHTMLAttributes, type MouseEvent, type ReactNode, type Ref } from 'react'
import { Icon, Sparkles, type LucideIcon } from './icons'
import { Spinner } from './Spinner'
import { Tooltip } from './Tooltip'
import { VisuallyHidden } from './VisuallyHidden'
import { cx } from './cx'
import './Button.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ai'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  iconEnd?: LucideIcon
  /** Extra classes for the leading icon, e.g. chevronClass() on a disclosure. */
  iconClassName?: string
  /** Busy: keeps its width, shows a spinner, announces busy and ignores clicks. */
  loading?: boolean
  /**
   * Why the button is disabled. Shown as a tooltip and read through
   * `aria-describedby`; the button stays focusable so both can be reached.
   */
  disabledReason?: string
  ref?: Ref<HTMLButtonElement>
  children?: ReactNode
}

/**
 * The button. One `primary` per screen; `secondary` and `ghost` for the rest;
 * `danger` for destructive actions; `ai` for actions that call Ostler AI.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconEnd,
  iconClassName,
  loading = false,
  disabled = false,
  disabledReason,
  type = 'button',
  className,
  children,
  onClick,
  ref,
  ...rest
}: ButtonProps) {
  const reasonId = useId()
  const leading = icon ?? (variant === 'ai' ? Sparkles : undefined)
  // A disabled button with a reason stays focusable (aria-disabled), so the
  // reason can be reached from the keyboard and the tooltip can open.
  const explained = disabled && !!disabledReason
  const inert = disabled || loading
  // A button busy with its own action stays focusable too (aria-disabled), so
  // pressing it does not drop keyboard focus to the page while it works.
  const focusable = explained || loading

  const button = (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx(
        'ui-button',
        `ui-button--${variant}`,
        `ui-button--${size}`,
        loading && 'is-loading',
        className
      )}
      disabled={disabled && !focusable}
      aria-disabled={focusable || undefined}
      aria-busy={loading || undefined}
      aria-describedby={
        [rest['aria-describedby'], explained ? reasonId : null].filter(Boolean).join(' ') ||
        undefined
      }
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (inert) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
    >
      <span className="ui-button__content">
        {leading && <Icon icon={leading} className={iconClassName} />}
        {children}
        {iconEnd && <Icon icon={iconEnd} />}
      </span>
      {loading && (
        <span className="ui-button__spinner">
          <Spinner size="sm" />
        </span>
      )}
    </button>
  )

  // The reason sits beside the button, not inside it, so it describes the
  // button without becoming part of its name.
  return explained ? (
    <>
      <Tooltip content={disabledReason} describe={false}>
        {button}
      </Tooltip>
      <VisuallyHidden id={reasonId}>{disabledReason}</VisuallyHidden>
    </>
  ) : (
    button
  )
}
