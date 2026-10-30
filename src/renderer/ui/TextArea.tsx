import { useLayoutEffect, useRef, type Ref, type TextareaHTMLAttributes } from 'react'
import { Field, useFieldIds, type FieldChromeProps } from './Field'
import { assignRef } from './assign-ref'
import { cx } from './cx'
import './TextArea.css'

export interface TextAreaProps
  extends FieldChromeProps, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  /** Grow with the text, from `rows` up to `maxRows`, then scroll. Default on. */
  autoGrow?: boolean
  maxRows?: number
  ref?: Ref<HTMLTextAreaElement>
}

/** A labelled multi-line text input that grows with its content up to a maximum. */
export function TextArea({
  label,
  hideLabel,
  hint,
  error,
  className,
  autoGrow = true,
  rows = 3,
  maxRows = 12,
  id,
  ref,
  disabled,
  ...textarea
}: TextAreaProps) {
  const ids = useFieldIds(id, { hint, error }, textarea['aria-describedby'])
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const area = areaRef.current
    if (!autoGrow || !area) return
    const style = getComputedStyle(area)
    const line = Number.parseFloat(style.lineHeight) || 20
    const chrome = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom) || 0
    area.style.height = 'auto'
    const max = line * maxRows + chrome
    area.style.height = `${Math.min(area.scrollHeight, max)}px`
    area.style.overflowY = area.scrollHeight > max ? 'auto' : 'hidden'
  }, [autoGrow, maxRows, textarea.value])

  return (
    <Field
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error}
      className={className}
      ids={ids}
    >
      <div className={cx('ui-input-box', 'ui-textarea', disabled && 'is-disabled')}>
        <textarea
          {...textarea}
          ref={(node) => {
            areaRef.current = node
            assignRef(ref, node)
          }}
          id={ids.controlId}
          rows={rows}
          disabled={disabled}
          aria-invalid={ids.invalid || undefined}
          aria-describedby={ids.describedBy}
        />
      </div>
    </Field>
  )
}
