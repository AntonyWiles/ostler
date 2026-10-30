import { useState } from 'react'
import type { GoalCheckIn, GoalCheckInInput, GoalMeasure, PlanningGoal } from '@shared/ostler-api'
import {
  formatMeasureValue,
  goalProgress,
  measureAgainstTarget,
  measureSummary,
  paceText,
  sortCheckIns,
  type GoalPace
} from '@shared/goal-measures'
import { formatIsoDateShort } from '@shared/dates'
import { Badge, Button, IconButton, InlineAlert, Menu, useToast, type BadgeTone } from '../../../ui'
import { Ellipsis, Pencil, Plus, Trash2 } from '../../../ui/icons'
import { GoalMeasureChart } from './GoalMeasureChart'
import { GoalCheckInDialog, GoalMeasureDialog } from './GoalMeasureDialogs'
import './GoalMeasure.css'
import { t } from '@shared/i18n'

const PACE_TONE: Record<GoalPace, BadgeTone> = {
  reached: 'success',
  ahead: 'success',
  'on-pace': 'info',
  behind: 'warning'
}

type Dialog = { kind: 'measure' } | { kind: 'check-in'; checkIn: GoalCheckIn | null } | null

/**
 * A goal's number in the Goals and milestones panel (N5.6a): Add a measure,
 * or the latest value against the target, ahead or behind in words, the
 * chart, Check in, and the check-ins, each editable and removable with Undo.
 * Reaching the target says so; closing the goal stays the person's to do.
 */
export function GoalMeasureSection({
  goal,
  checkIns,
  today,
  onChanged,
  onGoalChanged
}: {
  goal: PlanningGoal
  checkIns: readonly GoalCheckIn[]
  today: string
  /** Check-ins changed: read them again. */
  onChanged: () => Promise<void> | void
  /** The goal's measure changed: read the goals again. */
  onGoalChanged: () => Promise<void> | void
}) {
  const { toastUndo } = useToast()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [error, setError] = useState<string | null>(null)
  const measure = goal.measure ?? null

  const saveMeasure = async (next: GoalMeasure | null): Promise<boolean> => {
    const result = await window.ostlerAPI.updatePlanningGoal(goal.id, { measure: next })
    if (!result.ok) {
      setError(result.error || t('tasks:goalMeasure.couldntSaveMeasure'))
      return false
    }
    setError(null)
    await onGoalChanged()
    return true
  }

  const removeMeasure = async () => {
    const before = measure
    if (!(await saveMeasure(null))) return
    toastUndo(
      t('tasks:goalMeasure.measureRemoved', { title: goal.title }),
      () => void saveMeasure(before),
      t('tasks:goalMeasure.measureRemovedBody')
    )
  }

  const restore = async (checkIn: GoalCheckIn) => {
    await window.ostlerAPI.restoreGoalCheckIn(goal.id, checkIn)
    await onChanged()
  }

  const checkIn = async (input: GoalCheckInInput): Promise<boolean> => {
    const result = await window.ostlerAPI.recordGoalCheckIn(goal.id, input)
    if (!result.ok) {
      setError(result.error || t('tasks:goalMeasure.couldntCheckIn'))
      return false
    }
    setError(null)
    await onChanged()
    const { replaced } = result.value
    const undo = replaced
      ? () => restore(replaced)
      : async () => {
          await window.ostlerAPI.deleteGoalCheckIn(goal.id, input.date)
          await onChanged()
        }
    toastUndo(
      replaced
        ? t('tasks:goalMeasure.replaced', { date: formatIsoDateShort(input.date) })
        : t('tasks:goalMeasure.checkedIn', {
            value: formatMeasureValue(input.value, measure?.unit ?? '')
          }),
      undo
    )
    return true
  }

  const remove = async (entry: GoalCheckIn) => {
    const result = await window.ostlerAPI.deleteGoalCheckIn(goal.id, entry.date)
    if (!result.ok) {
      setError(result.error || t('tasks:goalMeasure.couldntRemoveCheckIn'))
      return
    }
    await onChanged()
    toastUndo(t('tasks:goalMeasure.removed', { date: formatIsoDateShort(entry.date) }), () =>
      restore(result.value)
    )
  }

  const dialogs = (
    <>
      {dialog?.kind === 'measure' && (
        <GoalMeasureDialog
          goalTitle={goal.title}
          measure={measure}
          today={today}
          onClose={() => setDialog(null)}
          onSave={saveMeasure}
        />
      )}
      {dialog?.kind === 'check-in' && (
        <GoalCheckInDialog
          goalTitle={goal.title}
          unit={measure?.unit ?? ''}
          checkIn={dialog.checkIn}
          today={today}
          onClose={() => setDialog(null)}
          onSave={checkIn}
        />
      )}
    </>
  )

  if (!measure) {
    return (
      <div className="goal-measure goal-measure--empty">
        {error && (
          <InlineAlert tone="danger" onDismiss={() => setError(null)}>
            {error}
          </InlineAlert>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={Plus}
          onClick={() => setDialog({ kind: 'measure' })}
        >
          {t('tasks:goalMeasure.addMeasure')}
        </Button>
        {dialogs}
      </div>
    )
  }

  const progress = goalProgress(measure, checkIns, today)
  const summary = measureSummary(progress, measure)
  const newestFirst = sortCheckIns(checkIns).reverse()

  return (
    <div className="goal-measure" data-pace={progress.pace}>
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
      <div className="goal-measure__head">
        <strong className="goal-measure__value">
          {measureAgainstTarget(progress.latest, measure)}
        </strong>
        <Badge tone={PACE_TONE[progress.pace]}>{paceText(progress)}</Badge>
        {progress.pace === 'reached' && goal.status === 'active' && (
          <span className="goal-measure__hint">{t('tasks:goalMeasure.reachedHint')}</span>
        )}
        <span className="goal-measure__actions">
          <Button
            size="sm"
            icon={Plus}
            onClick={() => setDialog({ kind: 'check-in', checkIn: null })}
          >
            {t('tasks:goalMeasure.checkIn')}
          </Button>
          <Menu
            label={t('tasks:goalMeasure.editMeasure')}
            placement="bottom-end"
            items={[
              {
                label: t('tasks:goalMeasure.editMeasure'),
                icon: Pencil,
                onSelect: () => setDialog({ kind: 'measure' })
              },
              {
                label: t('tasks:goalMeasure.removeMeasure'),
                icon: Trash2,
                tone: 'danger',
                onSelect: () => void removeMeasure()
              }
            ]}
            renderTrigger={(trigger) => (
              <IconButton
                {...trigger}
                label={t('tasks:goalMeasure.measureTitle', { title: goal.title })}
                icon={Ellipsis}
                size="sm"
              />
            )}
          />
        </span>
      </div>
      <GoalMeasureChart
        title={goal.title}
        measure={measure}
        checkIns={checkIns}
        summary={summary}
      />
      <section className="goal-measure__check-ins" aria-label={t('tasks:goalMeasure.checkIns')}>
        {newestFirst.length === 0 ? (
          <p className="goal-measure__quiet">{t('tasks:goalMeasure.noCheckIns')}</p>
        ) : (
          <ul>
            {newestFirst.map((entry) => {
              const date = formatIsoDateShort(entry.date)
              return (
                <li key={entry.date} className="goal-measure__check-in">
                  <span className="goal-measure__check-in-date">{date}</span>
                  <span className="goal-measure__check-in-value">
                    {formatMeasureValue(entry.value, measure.unit)}
                  </span>
                  {entry.note && <span className="goal-measure__check-in-note">{entry.note}</span>}
                  <IconButton
                    size="sm"
                    icon={Pencil}
                    label={t('tasks:goalMeasure.editCheckIn', { date })}
                    onClick={() => setDialog({ kind: 'check-in', checkIn: entry })}
                  />
                  <IconButton
                    size="sm"
                    icon={Trash2}
                    label={t('tasks:goalMeasure.removeCheckIn', { date })}
                    onClick={() => void remove(entry)}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {dialogs}
    </div>
  )
}
