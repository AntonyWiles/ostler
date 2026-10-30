import type { FocusEvent } from 'react'
import { compareIsoDates, formatIsoDate, todayIsoDate } from '@shared/dates'
import { MAX_ESTIMATE } from '@shared/ostler-api'
import { ESTIMATE_UNIT_SHORT } from '@shared/task-labels'
import { useProjectEstimateUnit } from '../../context/OstlerContext'
import { DateField, NumberField, type DateFieldProps } from '../../ui'
import { useDayOffNote } from '../../hooks/useDayOffNote'
import { t } from '@shared/i18n'

/**
 * The start date, due date and estimate of a task, as the drawer and the
 * create forms show them. One place for the words and the start-after-due
 * check, so every form refuses the same input the same way (the service
 * gives the same message).
 */

/** A save that failed, in words, for the field to show until it is saved or discarded. */
type SaveFieldProps = Pick<DateFieldProps, 'onFocus' | 'onBlur'> & { saveError?: string }

export function TaskStartDateField({
  value,
  assigneeId,
  onChange,
  saveError,
  ...focus
}: {
  value: string
  /** Whose days off the date is checked against (N3.2), besides everyone's. */
  assigneeId?: string | null
  onChange: (value: string) => void
} & SaveFieldProps) {
  const note = useDayOffNote(value, assigneeId)
  return (
    <DateField
      label={t('tasks:workItemDrawer.startDate')}
      value={value}
      onChange={onChange}
      due={false}
      note={note}
      error={saveError}
      {...focus}
    />
  )
}

/**
 * The show-from date (N1.1a): until this day the task stays out of Today,
 * Upcoming, My work, the Board and the List. A future date says so.
 */
export function TaskShowFromField({
  value,
  onChange,
  saveError,
  ...focus
}: {
  value: string
  onChange: (value: string) => void
} & SaveFieldProps) {
  const later = value !== '' && value > todayIsoDate()
  return (
    <DateField
      label={t('tasks:someday.showFrom')}
      value={value}
      onChange={onChange}
      due={false}
      hint={
        later
          ? t('tasks:someday.hiddenUntil', {
              date: formatIsoDate(value, { day: 'numeric', month: 'long' })
            })
          : t('tasks:someday.showFromHint')
      }
      error={saveError}
      {...focus}
    />
  )
}

export function TaskDueDateField({
  value,
  assigneeId,
  startDate,
  done = false,
  onChange,
  className,
  saveError,
  ...focus
}: {
  value: string
  /** Whose days off the date is checked against (N3.2), besides everyone's. */
  assigneeId?: string | null
  /** The start date, to check the due date against. */
  startDate: string
  /** A finished task's due date is not overdue. */
  done?: boolean
  onChange: (value: string) => void
  className?: string
} & SaveFieldProps) {
  const note = useDayOffNote(value, assigneeId)
  return (
    <DateField
      label={t('tasks:workItemDrawer.dueDate')}
      value={value}
      onChange={onChange}
      due={!done}
      note={note}
      className={className}
      error={
        saveError ??
        (startDate && value && compareIsoDates(startDate, value) > 0
          ? t('tasks:workItemDrawer.startDateAfterDue')
          : undefined)
      }
      {...focus}
    />
  )
}

export function TaskEstimateField({
  projectId,
  value,
  onChange,
  saveError,
  onFocus,
  onBlur
}: {
  projectId: string
  value: number | null
  onChange: (value: number | null) => void
  saveError?: string
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void
}) {
  const estimateUnit = useProjectEstimateUnit(projectId)
  return (
    <NumberField
      label={t('tasks:workItemDrawer.estimate')}
      min={0}
      max={MAX_ESTIMATE}
      step={estimateUnit === 'hours' ? 0.5 : 1}
      unit={ESTIMATE_UNIT_SHORT[estimateUnit]}
      placeholder={t('tasks:workItemDrawer.none')}
      hint={
        estimateUnit === 'hours'
          ? t('tasks:workItemDrawer.hours')
          : t('tasks:workItemDrawer.points')
      }
      value={value}
      onChange={onChange}
      error={saveError}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  )
}
