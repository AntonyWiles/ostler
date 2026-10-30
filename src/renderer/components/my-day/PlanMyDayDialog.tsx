import { useEffect, useMemo, useState } from 'react'
import type { MyDayTask, PlanMyDayCandidates } from '@shared/ostler-api'
import { formatIsoDateShort } from '@shared/dates'
import { t } from '@shared/i18n'
import { myDayHours, myDayTotal, planSections, type PlanSectionId } from '@shared/planning/my-day'
import { usePeople } from '../../context/PeopleContext'
import { useReorderableList } from '../../hooks/useMyDay'
import {
  Button,
  Checkbox,
  Dialog,
  IconButton,
  InlineAlert,
  NumberField,
  Skeleton,
  useToast
} from '../../ui'
import { GripVertical, X } from '../../ui/icons'
import { estimateText, hoursText, listDayName } from '../../views/home/my-day-text'
import './PlanMyDayDialog.css'

/** The hours typed into the panel when Workload has no capacity, kept for the next morning. */
export const MY_DAY_HOURS_KEY = 'ostler.myDay.hours'

function readTypedHours(): number | null {
  try {
    const value = Number(localStorage.getItem(MY_DAY_HOURS_KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function writeTypedHours(hours: number | null): void {
  try {
    if (hours === null) localStorage.removeItem(MY_DAY_HOURS_KEY)
    else localStorage.setItem(MY_DAY_HOURS_KEY, String(hours))
  } catch {
    // Storage can be unavailable; the number is only a convenience.
  }
}

export interface PlanMyDayDialogProps {
  open: boolean
  onClose: () => void
  /** The person's local date. */
  today: string
  /** After Start my day and after its undo: Home reads again. */
  onChanged: () => void
}

/**
 * Plan my day (N1.4, decision N12): a short panel to pick what the person
 * will really do today from what was left from the last list, Today's tasks
 * and high-priority tasks with no date, put it in order, and see the picked
 * estimates against today's hours. Start my day saves the list in that order.
 */
export function PlanMyDayDialog({ open, onClose, today, onChanged }: PlanMyDayDialogProps) {
  const people = usePeople()
  const { toastUndo } = useToast()
  const [candidates, setCandidates] = useState<PlanMyDayCandidates | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<MyDayTask[]>([])
  const [typedHours, setTypedHours] = useState<number | null>(readTypedHours)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setCandidates(null)
    setError(null)
    void window.ostlerAPI.getPlanMyDay(today).then((result) => {
      if (cancelled) return
      if (!result.ok) return setError(result.error)
      setCandidates(result.value)
      setPicked(result.value.myDay)
    })
    return () => {
      cancelled = true
    }
  }, [open, today])

  const sections = useMemo(() => (candidates ? planSections(candidates) : []), [candidates])
  const pickedIds = new Set(picked.map((task) => task.id))
  const total = myDayTotal(picked)
  const hours = myDayHours(people.me, typedHours)

  const toggle = (task: MyDayTask, on: boolean) =>
    setPicked((current) =>
      on
        ? current.some((entry) => entry.id === task.id)
          ? current
          : [...current, task]
        : current.filter((entry) => entry.id !== task.id)
    )

  const { rowProps, onKeyDown } = useReorderableList(
    picked,
    (_task, _placement, order) => setPicked(order),
    (id) => `[data-plan-order-id="${id}"]`
  )

  const sectionTitle = (id: PlanSectionId) =>
    id === 'leftOver' && candidates?.leftOver
      ? t('views:myDay.sections.leftOver', { day: listDayName(candidates.leftOver.date, today) })
      : t(`views:myDay.sections.${id}`)

  const start = async () => {
    const before = candidates?.myDay.map((task) => task.id) ?? []
    setSaving(true)
    const result = await window.ostlerAPI.startMyDay(
      today,
      picked.map((task) => task.id)
    )
    setSaving(false)
    if (!result.ok) return setError(t('views:myDay.couldntStart') + ' ' + result.error)
    onChanged()
    onClose()
    toastUndo(t('views:myDay.started', { count: result.value.length }), async () => {
      await window.ostlerAPI.startMyDay(today, before)
      onChanged()
    })
  }

  const over = hours.hours !== null ? total.hours - hours.hours : 0

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={t('views:myDay.panelTitle')}
      description={t('views:myDay.panelDescription')}
      canDismiss={!saving}
      closeOnBackdrop={false}
      className="plan-my-day"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {t('views:myDay.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void start()}
            loading={saving}
            disabled={saving || candidates === null}
          >
            {t('views:myDay.start')}
          </Button>
        </>
      }
    >
      {error && <InlineAlert tone="danger">{t('views:myDay.couldntLoad', { error })}</InlineAlert>}
      {candidates === null && !error ? (
        <Skeleton lines={5} />
      ) : (
        <div className="plan-my-day__columns">
          <div className="plan-my-day__sections">
            {sections.length === 0 && (
              <p className="plan-my-day__quiet">{t('views:myDay.nothingToPick')}</p>
            )}
            {sections.map((section) => (
              <fieldset key={section.id} className="plan-my-day__section">
                <legend>{sectionTitle(section.id)}</legend>
                <ul>
                  {section.tasks.map((task) => (
                    <li key={task.id} className="plan-my-day__candidate">
                      <Checkbox
                        label={task.title}
                        checked={pickedIds.has(task.id)}
                        onChange={(event) => toggle(task, event.target.checked)}
                        hint={candidateHint(task)}
                      />
                    </li>
                  ))}
                </ul>
              </fieldset>
            ))}
          </div>
          <section className="plan-my-day__order" aria-labelledby="plan-my-day-order">
            <h3 id="plan-my-day-order">{t('views:myDay.yourOrder')}</h3>
            <div className="plan-my-day__total" aria-live="polite">
              <p className={over > 0 ? 'is-over' : undefined}>
                {hours.hours !== null
                  ? t('views:myDay.total', {
                      picked: hoursText(total.hours),
                      hours: hoursText(hours.hours)
                    })
                  : t('views:myDay.totalNoHours', { picked: hoursText(total.hours) })}
                {hours.hours !== null && (
                  <>
                    {' · '}
                    {over > 0
                      ? t('views:myDay.over', { hours: hoursText(over) })
                      : t('views:myDay.left', { hours: hoursText(-over) })}
                  </>
                )}
              </p>
              {total.unestimated > 0 && (
                <p>{t('views:myDay.unestimated', { count: total.unestimated })}</p>
              )}
              {total.pointsTasks > 0 && (
                <p>
                  {t('views:myDay.pointsTasks', {
                    count: total.pointsTasks,
                    points: hoursText(total.points)
                  })}
                </p>
              )}
              {hours.fromCapacity ? (
                <p className="plan-my-day__quiet">{t('views:myDay.capacityFrom')}</p>
              ) : (
                <NumberField
                  label={t('views:myDay.hoursToday')}
                  hint={t('views:myDay.hoursTodayHint')}
                  value={typedHours}
                  min={0}
                  max={24}
                  step={0.5}
                  unit={t('views:myDay.hoursUnit')}
                  onChange={(value) => {
                    setTypedHours(value)
                    writeTypedHours(value)
                  }}
                />
              )}
            </div>
            {picked.length === 0 ? (
              <p className="plan-my-day__quiet">{t('views:myDay.nothingPicked')}</p>
            ) : (
              <ol className="plan-my-day__list" aria-label={t('views:myDay.yourOrder')}>
                {picked.map((task) => {
                  const row = rowProps(task)
                  return (
                    <li
                      key={task.id}
                      {...row}
                      className={['plan-my-day__picked', row.className].filter(Boolean).join(' ')}
                    >
                      <GripVertical className="plan-my-day__grip" aria-hidden="true" />
                      <span
                        className="plan-my-day__picked-title"
                        tabIndex={0}
                        data-plan-order-id={task.id}
                        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                        title={t('views:myDay.move')}
                        onKeyDown={(event) => onKeyDown(event, task)}
                      >
                        {task.title}
                      </span>
                      <span className="plan-my-day__picked-meta">{estimateText(task)}</span>
                      <IconButton
                        size="sm"
                        icon={X}
                        label={t('views:myDay.unpick', { title: task.title })}
                        onClick={() => toggle(task, false)}
                      />
                    </li>
                  )
                })}
              </ol>
            )}
          </section>
        </div>
      )}
    </Dialog>
  )
}

/** A candidate's project, due date and estimate, under its title. */
function candidateHint(task: MyDayTask): string {
  return [
    task.projectName,
    task.targetDate ? formatIsoDateShort(task.targetDate) : null,
    estimateText(task)
  ]
    .filter(Boolean)
    .join(' · ')
}
