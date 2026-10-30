import type { ChangeEvent } from 'react'
import { TextField, type TextFieldProps } from './TextField'
import './NumberField.css'

export interface NumberFieldProps extends Omit<
  TextFieldProps,
  'type' | 'value' | 'onChange' | 'suffix' | 'min' | 'max' | 'step' | 'clearable'
> {
  /** null while the field is empty. */
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  step?: number
  /** Shown after the number: "days", "h", "pts". */
  unit?: string
}

/**
 * A number with step, min/max and a unit. Arrow keys step (the native input),
 * and a value outside min/max is clamped when the field loses focus.
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  onBlur,
  ...rest
}: NumberFieldProps) {
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
  return (
    <TextField
      {...rest}
      type="number"
      inputMode="decimal"
      className={['ui-number-field', rest.className].filter(Boolean).join(' ')}
      inputClassName="tabular-nums"
      value={value ?? ''}
      min={min}
      max={max}
      step={step}
      suffix={unit}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        const raw = event.target.value
        onChange(raw === '' || Number.isNaN(Number(raw)) ? null : Number(raw))
      }}
      onBlur={(event) => {
        if (value !== null && clamp(value) !== value) onChange(clamp(value))
        onBlur?.(event)
      }}
    />
  )
}
