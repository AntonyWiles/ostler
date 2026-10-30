import { useEffect, useState } from 'react'
import type { TimeEntry } from '@shared/ostler-api'
import { MAX_TIME_NOTE_LENGTH } from '@shared/ostler-api'
import { isIsoDate, toIsoDate, todayIsoDate } from '@shared/dates'
import { isClockTime, localInstant } from '@shared/reminder-settings'
import { durationInputText, parseDuration } from '@shared/time/duration'
import { usePeople } from '../context/PeopleContext'
import { AssigneeField } from '../views/planning/AssigneeField'
import { Button, Checkbox, DateField, Dialog, InlineAlert, TextField } from '../ui'
import './time.css'
import { t } from '@shared/i18n'

/** `HH:MM` of a moment, local time. */
function clockOf(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export interface TimeEntryEditorProps {
  /** The entry to edit; leave out to add one to `task`. */
  entry?: TimeEntry
  task: { projectId: string; id: string; title: string }
  onClose: () => void
  /** After a save, with the saved entry. */
  onSaved: (entry: TimeEntry) => void
}

/**
 * Adds or edits one time entry (R2.3): the day and time it started, how long
 * (`1h 30m`, `1.5h`, `90m`, with the region's decimal separator), a note and
 * the person. The drawer's Time section and the Timesheet both open this one.
 * A running timer's duration is not editable until it stops. Billable starts
 * as the project's "New time is billable" (N6.4); billed time is locked.
 */
export function TimeEntryEditor({ entry, task, onClose, onSaved }: TimeEntryEditorProps) {
  const people = usePeople()
  const running = entry !== undefined && entry.durationSeconds === null
  const [date, setDate] = useState(entry ? toIsoDate(new Date(entry.startedAt)) : todayIsoDate())
  const [time, setTime] = useState(entry ? clockOf(entry.startedAt) : clockOf(Date.now()))
  const [duration, setDuration] = useState(
    entry?.durationSeconds ? durationInputText(entry.durationSeconds) : ''
  )
  const [note, setNote] = useState(entry?.note ?? '')
  const [personId, setPersonId] = useState<string | null>(
    entry ? entry.personId : (people.me?.id ?? null)
  )
  const [billable, setBillable] = useState(entry?.billable ?? false)
  const locked = Boolean(entry?.billingId)
  const [error, setError] = useState<string | null>(null)
  const [durationError, setDurationError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (entry) return
    let current = true
    void window.ostlerAPI.getBillingSettings(task.projectId).then((result) => {
      if (current && result.ok) setBillable(result.value.newTimeBillable)
    })
    return () => {
      current = false
    }
  }, [entry, task.projectId])

  const save = async () => {
    if (!isIsoDate(date) || !isClockTime(time)) {
      setError(t('tasks:time.chooseDayTime'))
      return
    }
    const seconds = running ? null : parseDuration(duration)
    if (!running && seconds === null) {
      setDurationError(t('tasks:time.durationHelp'))
      return
    }
    setBusy(true)
    const startedAt = localInstant(date, time)
    const result = entry
      ? await window.ostlerAPI.updateTimeEntry(task.projectId, entry.id, {
          startedAt,
          ...(seconds === null ? {} : { durationSeconds: seconds }),
          note,
          personId,
          billable
        })
      : await window.ostlerAPI.createTimeEntry(task.projectId, {
          workItemId: task.id,
          startedAt,
          durationSeconds: seconds!,
          note,
          personId,
          billable
        })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved(result.value)
  }

  return (
    <Dialog
      open
      size="sm"
      onClose={onClose}
      closeOnBackdrop={false}
      title={entry ? t('tasks:time.editTime') : t('tasks:time.addTime')}
      description={t('tasks:time.onTask', { task: task.title })}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('tasks:time.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={busy || locked}
            onClick={() => void save()}
          >
            {entry ? t('tasks:time.save') : t('tasks:time.addTime')}
          </Button>
        </>
      }
    >
      <div className="time-entry-editor">
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        {locked && <InlineAlert tone="info">{t('tasks:time.billedLocked')}</InlineAlert>}
        <DateField label={t('tasks:time.day')} value={date} onChange={setDate} due={false} />
        <TextField
          label={t('tasks:time.started')}
          type="time"
          value={time}
          onChange={(event) => setTime(event.target.value)}
        />
        {running ? (
          <p className="time-entry-editor__wide task-drawer__muted">
            {t('tasks:time.stillRunning')}
          </p>
        ) : (
          <TextField
            className="time-entry-editor__wide"
            label={t('tasks:time.duration')}
            hint={t('tasks:time.durationHint')}
            error={durationError}
            value={duration}
            data-autofocus
            onChange={(event) => {
              setDuration(event.target.value)
              setDurationError(undefined)
            }}
          />
        )}
        <TextField
          className="time-entry-editor__wide"
          label={t('tasks:time.note')}
          value={note}
          maxLength={MAX_TIME_NOTE_LENGTH}
          onChange={(event) => setNote(event.target.value)}
        />
        <AssigneeField
          className="time-entry-editor__wide"
          label={t('tasks:time.person')}
          projectId={task.projectId}
          value={personId}
          onChange={setPersonId}
        />
        <Checkbox
          className="time-entry-editor__wide"
          label={t('tasks:time.billable')}
          checked={billable}
          disabled={locked}
          onChange={(event) => setBillable(event.target.checked)}
        />
      </div>
    </Dialog>
  )
}
