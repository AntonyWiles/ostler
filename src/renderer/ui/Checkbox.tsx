import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { assignRef } from './assign-ref'
import { cx } from './cx'
import './Checkbox.css'

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'className'
> {
  /** Required: the visible label (or an `aria-label` with `label` set to null for a bare box). */
  label: ReactNode
  hint?: ReactNode
  /** The "some selected" state; shown as a dash and read as "mixed". */
  indeterminate?: boolean
  className?: string
  ref?: Ref<HTMLInputElement>
}

/** A native checkbox, restyled, with its label. */
export function Checkbox({
  label,
  hint,
  indeterminate = false,
  className,
  id,
  ref,
  ...input
}: CheckboxProps) {
  const auto = useId()
  const inputId = id ?? auto
  const hintId = `${inputId}-hint`
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <div className={cx('ui-check', input.disabled && 'is-disabled', className)}>
      <input
        {...input}
        ref={(node) => {
          inputRef.current = node
          assignRef(ref, node)
        }}
        id={inputId}
        type="checkbox"
        className="ui-check__input"
        aria-checked={indeterminate ? 'mixed' : undefined}
        aria-describedby={
          [input['aria-describedby'], hint ? hintId : null].filter(Boolean).join(' ') || undefined
        }
      />
      {label !== null && (
        <label htmlFor={inputId} className="ui-check__label">
          {label}
        </label>
      )}
      {hint && (
        <p id={hintId} className="ui-check__hint">
          {hint}
        </p>
      )}
    </div>
  )
}
