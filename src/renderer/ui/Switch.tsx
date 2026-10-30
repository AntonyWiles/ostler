import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { cx } from './cx'
import './Checkbox.css'
import './Switch.css'

export interface SwitchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'className' | 'role'
> {
  label: ReactNode
  hint?: ReactNode
  className?: string
  ref?: Ref<HTMLInputElement>
}

/** An on/off setting that applies at once: a native checkbox with `role="switch"`. */
export function Switch({ label, hint, className, id, ref, ...input }: SwitchProps) {
  const auto = useId()
  const inputId = id ?? auto
  const hintId = `${inputId}-hint`
  return (
    <div className={cx('ui-check', 'ui-switch', input.disabled && 'is-disabled', className)}>
      <input
        {...input}
        ref={ref}
        id={inputId}
        type="checkbox"
        role="switch"
        className="ui-switch__input"
        aria-describedby={
          [input['aria-describedby'], hint ? hintId : null].filter(Boolean).join(' ') || undefined
        }
      />
      <label htmlFor={inputId} className="ui-check__label">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="ui-check__hint">
          {hint}
        </p>
      )}
    </div>
  )
}
