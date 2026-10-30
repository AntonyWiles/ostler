import { useId, type ReactNode } from 'react'
import { VisuallyHidden } from './VisuallyHidden'
import { cx } from './cx'
import './Field.css'

export interface FieldChromeProps {
  /** Required: the visible label above the control (or a hidden one with `hideLabel`). */
  label: ReactNode
  /** Hidden visually, still the accessible name. For search boxes and dense toolbars. */
  hideLabel?: boolean
  /** Help under the control. */
  hint?: ReactNode
  /** An error under the control, in plain words. Sets `aria-invalid`. */
  error?: ReactNode
  className?: string
}

export interface FieldIds {
  controlId: string
  labelId: string
  describedBy: string | undefined
  invalid: boolean
}

/** Ids shared by a field's label, control, hint and error. */
export function useFieldIds(
  id: string | undefined,
  { hint, error }: Pick<FieldChromeProps, 'hint' | 'error'>,
  extraDescribedBy?: string
): FieldIds & { hintId: string; errorId: string } {
  const auto = useId()
  const controlId = id ?? auto
  const hintId = `${controlId}-hint`
  const errorId = `${controlId}-error`
  const describedBy =
    [extraDescribedBy, error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') ||
    undefined
  return {
    controlId,
    labelId: `${controlId}-label`,
    hintId,
    errorId,
    describedBy,
    invalid: !!error
  }
}

/** Label above, control, then hint or error below: the one form layout. */
export function Field({
  label,
  hideLabel,
  hint,
  error,
  className,
  ids,
  children
}: FieldChromeProps & { ids: ReturnType<typeof useFieldIds>; children: ReactNode }) {
  const labelNode = (
    <label id={ids.labelId} htmlFor={ids.controlId} className="ui-field__label">
      {label}
    </label>
  )
  return (
    <div className={cx('ui-field', !!error && 'is-invalid', className)}>
      {hideLabel ? <VisuallyHidden>{labelNode}</VisuallyHidden> : labelNode}
      {children}
      {error ? (
        <p id={ids.errorId} className="ui-field__error">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={ids.hintId} className="ui-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** Sets a React-controlled input's value as if the user typed it, so onChange fires. */
export function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}
