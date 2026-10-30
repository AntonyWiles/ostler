import { useEffect, useId, useRef, useState, type FocusEvent } from 'react'
import { isIsoDate } from '@shared/dates'
import { Button } from './Button'
import { Field, useFieldIds, type FieldChromeProps } from './Field'
import { Popover } from './Popover'
import { ChevronDown, Icon } from './icons'
import { addDays, daysFromToday, relativeDateText, toIsoDate } from './date-text'
import { cx } from './cx'
import './DateField.css'
import { t } from '@shared/i18n'

export interface DateFieldProps extends FieldChromeProps {
  /** `YYYY-MM-DD`, or "" for no date. */
  value: string
  onChange: (value: string) => void
  /** A due date: past dates read "Overdue by …" and show as danger. Default on. */
  due?: boolean
  min?: string
  max?: string
  disabled?: boolean
  /**
   * A quiet note under the date that never blocks it, such as the day off it
   * falls on ("Christmas Day: a day off"). Read with the field.
   */
  note?: string
  id?: string
  /** Focus leaving or arriving in the date input itself (not the quick-pick button). */
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void
}

/**
 * Whether a date the input holds can be saved: a real day with a four-digit
 * year from 1000 on. Typing a year digit by digit passes through 0002, 0020
 * and 0202 on its way to 2026; none of those is saved.
 */
export function isSavableDate(value: string): boolean {
  return isIsoDate(value) && Number(value.slice(0, 4)) >= 1000
}

/**
 * A native date input, a quick-pick pop-up (Today, Tomorrow, Next week,
 * Clear), and the date in words beside it ("Tomorrow", "Overdue by 2 days").
 *
 * A date that is not a real one yet (a half-typed or mistyped year) stays in
 * the box as typed, marked invalid, and is not saved, so a slip of the year
 * never throws away the day and month (MOP-41).
 */
export function DateField({
  label,
  hideLabel,
  hint,
  error,
  className,
  value,
  onChange,
  due = true,
  min,
  max,
  disabled,
  note,
  id,
  onFocus,
  onBlur
}: DateFieldProps) {
  const baseId = useId()
  const relativeId = `${baseId}-relative`
  const noteId = `${baseId}-note`
  // What the box shows: the saved value, or a date being typed that is not one yet.
  const [draft, setDraft] = useState(value)
  const [badDraft, setBadDraft] = useState(false)
  useEffect(() => {
    setDraft(value)
    setBadDraft(false)
  }, [value])
  const relative = value && !badDraft ? relativeDateText(value, { due }) : ''
  const shownError = error ?? (badDraft ? t('common:dateField.notADate') : undefined)
  const ids = useFieldIds(
    id,
    { hint, error: shownError },
    [relative ? relativeId : null, note ? noteId : null].filter(Boolean).join(' ') || undefined
  )
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const days = value ? daysFromToday(value) : null
  const overdue = due && days !== null && days < 0

  const pick = (next: string) => {
    setDraft(next)
    setBadDraft(false)
    onChange(next)
    setOpen(false)
  }
  const typed = (input: HTMLInputElement) => {
    const next = input.value
    setDraft(next)
    // An empty value with badInput is a part left blank or half typed, not a clear.
    const bad = next === '' ? input.validity.badInput : !isSavableDate(next)
    setBadDraft(bad)
    if (!bad && next !== value) onChange(next)
  }
  const today = new Date()

  return (
    <Field
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={shownError}
      className={className}
      ids={ids}
    >
      <div className="ui-date-field">
        <div className={cx('ui-input-box', disabled && 'is-disabled')}>
          <input
            id={ids.controlId}
            type="date"
            value={draft}
            min={min}
            max={max}
            disabled={disabled}
            aria-invalid={ids.invalid || undefined}
            aria-describedby={ids.describedBy}
            className="tabular-nums"
            onChange={(event) => typed(event.target)}
            onFocus={onFocus}
            onBlur={onBlur}
          />
          <button
            ref={buttonRef}
            type="button"
            className="ui-date-field__picker"
            aria-label={t('common:dateField.quickDates')}
            title={t('common:dateField.quickDates')}
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
          >
            {/* A drop-down arrow, not a second calendar beside the input's own (MOP-40). */}
            <Icon icon={ChevronDown} />
          </button>
        </div>
        {relative && (
          <span id={relativeId} className={cx('ui-date-field__relative', overdue && 'is-overdue')}>
            {relative}
          </span>
        )}
      </div>
      {note && (
        <p id={noteId} className="ui-date-field__note">
          {note}
        </p>
      )}
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        label={t('common:dateField.quickDates')}
        placement="bottom-end"
      >
        <div className="ui-date-field__quick">
          <Button size="sm" variant="ghost" onClick={() => pick(toIsoDate(today))}>
            {t('common:dateField.today')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => pick(toIsoDate(addDays(today, 1)))}>
            {t('common:dateField.tomorrow')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => pick(toIsoDate(addDays(today, 7)))}>
            {t('common:dateField.nextWeek')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => pick('')} disabled={!value}>
            {t('common:dateField.clear')}
          </Button>
        </div>
      </Popover>
    </Field>
  )
}
