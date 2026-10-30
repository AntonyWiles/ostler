import { useRef, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { Field, setNativeValue, useFieldIds, type FieldChromeProps } from './Field'
import { Icon, X } from './icons'
import { assignRef } from './assign-ref'
import { cx } from './cx'
import './TextField.css'
import { t } from '@shared/i18n'

export interface TextFieldProps
  extends FieldChromeProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'className'> {
  /** Before the text: an icon or a fixed word. */
  prefix?: ReactNode
  /** After the text: a unit or a hint. */
  suffix?: ReactNode
  /** Shows a clear button while the field has text. */
  clearable?: boolean
  /** Called by the clear button. Without it, clearing fires onChange with "". */
  onClear?: () => void
  inputClassName?: string
  ref?: Ref<HTMLInputElement>
}

/** A labelled single-line text input with hint, error, affixes and a clear button. */
export function TextField({
  label,
  hideLabel,
  hint,
  error,
  className,
  prefix,
  suffix,
  clearable = false,
  onClear,
  inputClassName,
  id,
  ref,
  disabled,
  ...input
}: TextFieldProps) {
  const ids = useFieldIds(id, { hint, error }, input['aria-describedby'])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const hasValue = input.value !== undefined ? String(input.value) !== '' : true

  const clear = () => {
    if (onClear) onClear()
    else if (inputRef.current) setNativeValue(inputRef.current, '')
    inputRef.current?.focus()
  }

  return (
    <Field
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error}
      className={className}
      ids={ids}
    >
      <div className={cx('ui-input-box', disabled && 'is-disabled')}>
        {prefix && <span className="ui-input-box__affix">{prefix}</span>}
        <input
          {...input}
          ref={(node) => {
            inputRef.current = node
            assignRef(ref, node)
          }}
          id={ids.controlId}
          disabled={disabled}
          aria-invalid={ids.invalid || undefined}
          aria-describedby={ids.describedBy}
          className={inputClassName}
        />
        {suffix && <span className="ui-input-box__affix">{suffix}</span>}
        {clearable && hasValue && !disabled && !input.readOnly && (
          <button
            type="button"
            className="ui-input-box__clear"
            aria-label={t('common:textField.clear')}
            title={t('common:textField.clear')}
            onClick={clear}
          >
            <Icon icon={X} />
          </button>
        )}
      </div>
    </Field>
  )
}
