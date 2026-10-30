import { useState } from 'react'
import {
  MAX_CHECK_IN_NOTE_LENGTH,
  MAX_MEASURE_UNIT_LENGTH,
  measureInputText,
  parseMeasureNumber,
  type GoalCheckIn,
  type GoalCheckInInput,
  type GoalMeasure,
  type GoalMeasureDirection
} from '@shared/goal-measures'
import { compareIsoDates, shiftIsoDate } from '@shared/dates'
import { decimalSeparator } from '@shared/time/duration'
import { formatNumber } from '@shared/format'
import { Button, DateField, Dialog, InlineAlert, Select, TextArea, TextField } from '../../../ui'
import { t } from '@shared/i18n'

/** "1.5" or "1,5": the example a number error shows, in the person's region. */
const numberExample = () => formatNumber(1.5)

/** Add or edit a goal's measure (N5.6a). Numbers are typed in the person's region's format. */
export function GoalMeasureDialog({
  goalTitle,
  measure,
  today,
  onClose,
  onSave
}: {
  goalTitle: string
  measure: GoalMeasure | null
  today: string
  onClose: () => void
  onSave: (measure: GoalMeasure) => Promise<boolean>
}) {
  const separator = decimalSeparator()
  const [unit, setUnit] = useState(measure?.unit ?? '')
  const [start, setStart] = useState(
    measure ? measureInputText(measure.startValue, separator) : '0'
  )
  const [target, setTarget] = useState(
    measure ? measureInputText(measure.targetValue, separator) : ''
  )
  const [startDate, setStartDate] = useState(measure?.startDate ?? today)
  const [targetDate, setTargetDate] = useState(measure?.targetDate ?? shiftIsoDate(today, 90))
  const [direction, setDirection] = useState<GoalMeasureDirection>(measure?.direction ?? 'up')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formId = 'goal-measure-form'

  const check = (): GoalMeasure | string => {
    const startValue = parseMeasureNumber(start, separator)
    const targetValue = parseMeasureNumber(target, separator)
    if (startValue === null || targetValue === null)
      return t('tasks:goalMeasure.notANumber', { example: numberExample() })
    if (unit.trim().length > MAX_MEASURE_UNIT_LENGTH) return t('tasks:goalMeasure.unitTooLong')
    if (!startDate || !targetDate) return t('tasks:goalMeasure.needsDates')
    if (compareIsoDates(startDate, targetDate) >= 0) return t('tasks:goalMeasure.datesOrder')
    if (direction === 'up' && targetValue <= startValue) return t('tasks:goalMeasure.targetHigher')
    if (direction === 'down' && targetValue >= startValue) return t('tasks:goalMeasure.targetLower')
    return { unit: unit.trim(), startValue, targetValue, startDate, targetDate, direction }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={t('tasks:goalMeasure.measureTitle', { title: goalTitle })}
      description={t('tasks:goalMeasure.measureDescription')}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('tasks:goalMeasure.cancel')}
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy}>
            {t('tasks:goalMeasure.saveMeasure')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="dialog-form goal-measure-form"
        onSubmit={(event) => {
          event.preventDefault()
          const checked = check()
          if (typeof checked === 'string') {
            setError(checked)
            return
          }
          setError(null)
          setBusy(true)
          void onSave(checked).then((saved) => {
            setBusy(false)
            if (saved) onClose()
          })
        }}
      >
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <TextField
          label={t('tasks:goalMeasure.unit')}
          hint={t('tasks:goalMeasure.unitHint')}
          data-autofocus
          maxLength={MAX_MEASURE_UNIT_LENGTH}
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
        />
        <div className="goal-measure-form__row">
          <TextField
            label={t('tasks:goalMeasure.startValue')}
            inputMode="decimal"
            value={start}
            onChange={(event) => setStart(event.target.value)}
            required
          />
          <TextField
            label={t('tasks:goalMeasure.targetValue')}
            inputMode="decimal"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            required
          />
        </div>
        <div className="goal-measure-form__row">
          <DateField
            label={t('tasks:goalMeasure.startDate')}
            due={false}
            value={startDate}
            onChange={setStartDate}
          />
          <DateField
            label={t('tasks:goalMeasure.targetDate')}
            due={false}
            value={targetDate}
            onChange={setTargetDate}
          />
        </div>
        <Select
          label={t('tasks:goalMeasure.direction')}
          value={direction}
          onChange={(event) => setDirection(event.target.value as GoalMeasureDirection)}
          options={[
            { value: 'up', label: t('tasks:goalMeasure.higher') },
            { value: 'down', label: t('tasks:goalMeasure.lower') }
          ]}
        />
      </form>
    </Dialog>
  )
}

/** Check in, or edit a check-in: a date (today by default), a value and a note. */
export function GoalCheckInDialog({
  goalTitle,
  unit,
  checkIn,
  today,
  onClose,
  onSave
}: {
  goalTitle: string
  unit: string
  /** The check-in being edited (a goal of one's own's too, N5.6b); its date can't change (one a day). */
  checkIn: Pick<GoalCheckIn, 'date' | 'value' | 'note'> | null
  today: string
  onClose: () => void
  onSave: (input: GoalCheckInInput) => Promise<boolean>
}) {
  const separator = decimalSeparator()
  const [date, setDate] = useState(checkIn?.date ?? today)
  const [value, setValue] = useState(checkIn ? measureInputText(checkIn.value, separator) : '')
  const [note, setNote] = useState(checkIn?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formId = 'goal-check-in-form'

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={
        checkIn
          ? t('tasks:goalMeasure.editCheckInTitle', { date: checkIn.date })
          : t('tasks:goalMeasure.checkInTitle', { title: goalTitle })
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('tasks:goalMeasure.cancel')}
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy}>
            {t('tasks:goalMeasure.saveCheckIn')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault()
          const reading = parseMeasureNumber(value, separator)
          if (reading === null) {
            setError(t('tasks:goalMeasure.notANumber', { example: numberExample() }))
            return
          }
          if (!date) {
            setError(t('tasks:goalMeasure.needsDates'))
            return
          }
          setError(null)
          setBusy(true)
          void onSave({ date, value: reading, note: note.trim() }).then((saved) => {
            setBusy(false)
            if (saved) onClose()
          })
        }}
      >
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <TextField
          label={
            unit ? t('tasks:goalMeasure.valueWithUnit', { unit }) : t('tasks:goalMeasure.value')
          }
          data-autofocus
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
        />
        <DateField
          label={t('tasks:goalMeasure.date')}
          due={false}
          value={date}
          disabled={checkIn !== null}
          onChange={setDate}
        />
        <TextArea
          label={t('tasks:goalMeasure.note')}
          hint={t('tasks:goalMeasure.noteHint')}
          rows={2}
          maxLength={MAX_CHECK_IN_NOTE_LENGTH}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </form>
    </Dialog>
  )
}
