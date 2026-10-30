import type { FocusEvent, ReactNode } from 'react'
import {
  MAX_FIELD_TEXT_LENGTH,
  type PlanningFieldDefinition,
  type PlanningFieldValue,
  type PlanningWorkItem
} from '@shared/ostler-api'
import { Checkbox, DateField, NumberField, Select, TextField } from '../../ui'
import { isAiField } from '@shared/planning/ai-fields'
import { AiFieldSparkle } from './AiFieldMark'
import './CustomFieldInput.css'
import { t } from '@shared/i18n'

export interface CustomFieldInputProps {
  field: PlanningFieldDefinition
  /** The value as stored; undefined when the task has none. */
  value: PlanningFieldValue | undefined
  /**
   * The new value, null for none. `typed` is true for text and numbers being
   * typed, which save after a pause; every other change is finished when made.
   */
  onChange: (value: PlanningFieldValue | null, typed: boolean) => void
  error?: string
  hideLabel?: boolean
  /** Overrides the field's name as the label (a table cell names its row too). */
  label?: string
  autoFocus?: boolean
  onFocus?: () => void
  onBlur?: (event: FocusEvent<HTMLElement>) => void
}

/**
 * One custom field's editor (R2.2), by its type: the drawer, New task's More
 * details, the plan grid and the List's cells all use it, so a field is
 * filled in the same way everywhere. The field's name is the person's own
 * words and is shown as it is.
 */
export function CustomFieldInput({
  field,
  value,
  onChange,
  error,
  hideLabel,
  label = field.name,
  autoFocus,
  onFocus,
  onBlur
}: CustomFieldInputProps) {
  // An AI field (N8.4) shows its sparkle beside its name.
  const named: ReactNode =
    isAiField(field) && !hideLabel ? (
      <>
        {label}
        <AiFieldSparkle field={field} />
      </>
    ) : (
      label
    )
  switch (field.type) {
    case 'text':
      return (
        <TextField
          label={named}
          hideLabel={hideLabel}
          value={typeof value === 'string' ? value : ''}
          maxLength={MAX_FIELD_TEXT_LENGTH}
          error={error}
          autoFocus={autoFocus}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value, true)}
        />
      )
    case 'number':
      return (
        <NumberField
          label={label}
          hideLabel={hideLabel}
          value={typeof value === 'number' ? value : null}
          error={error}
          autoFocus={autoFocus}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(number) => onChange(number, true)}
        />
      )
    case 'date':
      return (
        <DateField
          label={label}
          hideLabel={hideLabel}
          due={false}
          value={typeof value === 'string' ? value : ''}
          error={error}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(date) => onChange(date || null, false)}
        />
      )
    case 'checkbox':
      return (
        <Checkbox
          label={label}
          checked={value === true}
          autoFocus={autoFocus}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.checked, false)}
        />
      )
    case 'choice':
      return (
        <Select
          label={named}
          hideLabel={hideLabel}
          value={typeof value === 'string' ? value : ''}
          error={error}
          autoFocus={autoFocus}
          onFocus={onFocus}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value || null, false)}
          options={[
            { value: '', label: t('tasks:customFields.none') },
            ...field.options.map((option) => ({ value: option.id, label: option.name }))
          ]}
        />
      )
    case 'choices': {
      const chosen = Array.isArray(value) ? value : []
      return (
        <fieldset className="custom-field-choices" onFocus={onFocus} onBlur={onBlur}>
          <legend className={hideLabel ? 'ui-visually-hidden' : 'custom-field-choices__legend'}>
            {label}
          </legend>
          {field.options.length === 0 && (
            <p className="custom-field-choices__empty">{t('tasks:customFields.noOptionsYet')}</p>
          )}
          {field.options.map((option, index) => (
            <Checkbox
              key={option.id}
              label={
                <span className="custom-field-choices__option">
                  <span
                    className="custom-field-dot"
                    style={{ background: option.color }}
                    aria-hidden="true"
                  />
                  {option.name}
                </span>
              }
              autoFocus={autoFocus && index === 0}
              checked={chosen.includes(option.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...chosen, option.id]
                    : chosen.filter((id) => id !== option.id),
                  false
                )
              }
            />
          ))}
          {error && <p className="custom-field-choices__error">{error}</p>}
        </fieldset>
      )
    }
  }
}

/** A task's value for a field, from its values. */
export function fieldValueOf(
  item: Pick<PlanningWorkItem, 'fieldValues'>,
  fieldId: string
): PlanningFieldValue | undefined {
  return item.fieldValues?.[fieldId]
}
