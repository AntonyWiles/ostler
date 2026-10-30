import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { cx } from './cx'
import './Checkbox.css'
import './Radio.css'

export interface RadioProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'className'
> {
  label: ReactNode
  hint?: ReactNode
  className?: string
  ref?: Ref<HTMLInputElement>
}

/** A native radio button, restyled, with its label. Group them in a RadioGroup. */
export function Radio({ label, hint, className, id, ref, ...input }: RadioProps) {
  const auto = useId()
  const inputId = id ?? auto
  const hintId = `${inputId}-hint`
  return (
    <div className={cx('ui-check', input.disabled && 'is-disabled', className)}>
      <input
        {...input}
        ref={ref}
        id={inputId}
        type="radio"
        className="ui-check__input"
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

export interface RadioGroupProps {
  /** The question the group answers. */
  legend: ReactNode
  children: ReactNode
  orientation?: 'vertical' | 'horizontal'
  className?: string
}

/** A fieldset and legend around Radios that share a `name`. */
export function RadioGroup({
  legend,
  children,
  orientation = 'vertical',
  className
}: RadioGroupProps) {
  return (
    <fieldset className={cx('ui-radio-group', `ui-radio-group--${orientation}`, className)}>
      <legend className="ui-radio-group__legend">{legend}</legend>
      {children}
    </fieldset>
  )
}
