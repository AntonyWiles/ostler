import { useState, type FormEvent } from 'react'
import type { EstimateUnit, PlanningWorkItem } from '@shared/ostler-api'
import { isIsoDate, todayIsoDate } from '@shared/dates'
import {
  MINUTES_PER_DAY,
  clockTime,
  defaultBlockLength,
  isBlockStart,
  parseClockTime,
  snapMinute
} from '@shared/planning/time-blocks'
import { t } from '@shared/i18n'
import { useDayOffNote } from '../../hooks/useDayOffNote'
import { lengthText, useTimeBlockActions } from '../../hooks/useTimeBlocks'
import { useProjectEstimateUnit } from '../../context/OstlerContext'
import { Button, DateField, Dialog, Select, TextField } from '../../ui'
import './time-blocks.css'

const LENGTHS = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480]

/** Block time… for a workspace's task: the dialog, saving through the one service. */
export function BlockTimeFor({ item, onClose }: { item: PlanningWorkItem; onClose: () => void }) {
  const estimateUnit = useProjectEstimateUnit(item.projectId)
  const actions = useTimeBlockActions()
  return (
    <BlockTimeDialog
      item={item}
      estimateUnit={estimateUnit}
      onClose={onClose}
      onCreate={async (input) => (await actions.create({ workItemId: item.id, ...input })) !== null}
    />
  )
}

/**
 * Block time… (N3.4a): the keyboard way to put a task into the week, from
 * its menu and drawer. A date, a start on the quarter hour and a length (the
 * task's estimate in hours, else an hour), cut at midnight. A day off shows
 * the note date fields show; it never blocks.
 */
export function BlockTimeDialog({
  item,
  estimateUnit,
  initial,
  onClose,
  onCreate
}: {
  item: PlanningWorkItem
  estimateUnit: EstimateUnit
  initial?: { date?: string; startMinute?: number }
  onClose: () => void
  onCreate: (input: {
    date: string
    startMinute: number
    lengthMinutes: number
  }) => Promise<boolean>
}) {
  const [date, setDate] = useState(initial?.date ?? todayIsoDate())
  const [start, setStart] = useState(clockTime(initial?.startMinute ?? 9 * 60))
  const startMinute = parseClockTime(start)
  const [length, setLength] = useState(() =>
    defaultBlockLength(item.estimate, estimateUnit, initial?.startMinute ?? 9 * 60)
  )
  const [busy, setBusy] = useState(false)
  const note = useDayOffNote(date, item.assigneeId)

  const startError =
    startMinute === null
      ? t('views:timeBlocks.startNeeded')
      : !isBlockStart(startMinute)
        ? t('views:timeBlocks.quarterHour')
        : undefined
  const fits = startMinute !== null && startMinute + length <= MINUTES_PER_DAY
  const lengths = [...new Set([...LENGTHS, length])].sort((a, b) => a - b)

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (busy || startMinute === null || startError || !isIsoDate(date)) return
    setBusy(true)
    const made = await onCreate({
      date,
      startMinute,
      lengthMinutes: Math.min(length, MINUTES_PER_DAY - startMinute)
    })
    setBusy(false)
    if (made) onClose()
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('views:timeBlocks.dialogTitle', { title: item.title })}
      description={t('views:timeBlocks.dialogDescription')}
      onClose={onClose}
      canDismiss={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common:confirm.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!!startError || !isIsoDate(date)}
            onClick={() => void submit()}
          >
            {t('views:timeBlocks.blockTime')}
          </Button>
        </>
      }
    >
      <form className="time-block-dialog" onSubmit={(event) => void submit(event)}>
        <DateField
          label={t('views:timeBlocks.date')}
          value={date}
          onChange={setDate}
          due={false}
          note={note}
        />
        <TextField
          label={t('views:timeBlocks.startTime')}
          type="time"
          step={900}
          value={start}
          error={startError}
          onChange={(event) => setStart(event.target.value)}
          onBlur={() => {
            const minute = parseClockTime(start)
            if (minute !== null) setStart(clockTime(snapMinute(minute)))
          }}
          data-autofocus
        />
        <Select
          label={t('views:timeBlocks.length')}
          hint={fits ? undefined : t('views:timeBlocks.cutAtMidnight')}
          options={lengths.map((minutes) => ({
            value: String(minutes),
            label: lengthText(minutes)
          }))}
          value={String(length)}
          onChange={(event) => setLength(Number(event.target.value))}
        />
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
