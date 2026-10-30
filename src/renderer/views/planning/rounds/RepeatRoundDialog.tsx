import { useEffect, useState } from 'react'
import type { PlanningMilestone, PlanningWorkItem } from '@shared/ostler-api'
import { formatIsoDate, isIsoDate, todayIsoDate } from '@shared/dates'
import {
  currentRoundStart,
  defaultRoundLength,
  followingRoundStart,
  MAX_ROUND_LENGTH_DAYS,
  type MilestoneRoundPreview
} from '@shared/milestone-rounds'
import { Button, DateField, Dialog, InlineAlert, NumberField } from '../../../ui'
import { RecurrenceRuleFields, useRuleDraft } from '../RecurrenceRuleFields'
import { joinSentences, t } from '@shared/i18n'
import './rounds.css'

/**
 * Repeat this round (N5.7a): when the next round starts (the task repeat's
 * rule picker, anchored on this round's start), how many days a round lasts
 * (from the milestone's dates), and a preview of the next round from the
 * service, which makes it. Saving sets the schedule; Stop repeating is on
 * the milestone's menu.
 */
export function RepeatRoundDialog({
  milestone,
  tasks,
  onClose,
  onSaved
}: {
  milestone: PlanningMilestone
  /** The round's tasks, for its start date. */
  tasks: PlanningWorkItem[]
  onClose: () => void
  onSaved: (milestone: PlanningMilestone) => void
}) {
  const start = currentRoundStart(
    milestone,
    tasks.flatMap((task) => [task.startDate, task.targetDate]),
    todayIsoDate()
  )
  const draft = useRuleDraft(milestone.repeat?.rule, start, 'monthly')
  const [lengthDays, setLengthDays] = useState<number | null>(
    milestone.repeat?.lengthDays ?? defaultRoundLength(start, milestone.targetDate)
  )
  const rule = draft.rule()
  const ruleKey = JSON.stringify(rule)
  const suggested = rule ? followingRoundStart(rule, start) : ''
  // The next start follows the rule until the person picks a day of their own.
  const [nextStart, setNextStart] = useState(milestone.repeat?.nextStart ?? suggested)
  const [picked, setPicked] = useState(Boolean(milestone.repeat))
  useEffect(() => {
    if (!picked && suggested) setNextStart(suggested)
  }, [ruleKey, picked])

  const [preview, setPreview] = useState<MilestoneRoundPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input =
    rule && lengthDays !== null && isIsoDate(nextStart) ? { rule, lengthDays, nextStart } : null
  const inputKey = JSON.stringify(input)
  useEffect(() => {
    if (!input) {
      setPreview(null)
      return
    }
    let current = true
    void window.ostlerAPI.previewMilestoneRound(milestone.id, input).then((result) => {
      if (!current) return
      setPreview(result.ok ? result.value : null)
      setError(result.ok ? null : result.error)
    })
    return () => {
      current = false
    }
  }, [inputKey])

  const save = async () => {
    if (!input) return
    if (input.rule.every === 'week' && input.rule.weekdays?.length === 0) {
      setError(t('tasks:taskRepeatSection.chooseLeastOneDay'))
      return
    }
    setBusy(true)
    const result = await window.ostlerAPI.setMilestoneRepeat(milestone.id, input)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onSaved(result.value)
    onClose()
  }

  const day = (value: string) => formatIsoDate(value, { day: 'numeric', month: 'short' })
  const formId = `repeat-round-${milestone.id}`

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      title={t('tasks:rounds.dialogTitle')}
      description={t('tasks:rounds.dialogDescription', { name: milestone.name })}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('tasks:rounds.cancel')}
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy} disabled={!input}>
            {t('tasks:rounds.save')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="round-repeat"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        <RecurrenceRuleFields
          draft={draft}
          label={t('tasks:rounds.nextRoundStarts')}
          allowNone={false}
        />
        <NumberField
          label={t('tasks:rounds.lasts')}
          hint={t('tasks:rounds.lastsHint', { start: day(start) })}
          unit={t('tasks:rounds.days')}
          min={1}
          max={MAX_ROUND_LENGTH_DAYS}
          step={1}
          value={lengthDays}
          onChange={setLengthDays}
        />
        <DateField
          label={t('tasks:rounds.nextStart')}
          value={nextStart}
          due={false}
          onChange={(value) => {
            setPicked(true)
            setNextStart(value)
          }}
        />
        {preview && (
          <p className="round-repeat__preview" aria-live="polite">
            {joinSentences([
              t('tasks:rounds.preview', {
                name: preview.name,
                from: day(preview.start),
                to: day(preview.end),
                count: preview.taskCount
              }),
              preview.repeatingCount > 0 &&
                t('tasks:rounds.previewRepeating', { count: preview.repeatingCount })
            ])}
          </p>
        )}
      </form>
    </Dialog>
  )
}
