import { useEffect, useState } from 'react'
import type { RescheduleQuery } from '@shared/ostler-api'
import { formatIsoDateShort, shiftIsoDate } from '@shared/dates'
import {
  DEFAULT_SPREAD_DAYS,
  MAX_SPREAD_DAYS,
  planChanges,
  undoChanges,
  type RescheduleMode,
  type ReschedulePlan
} from '@shared/planning/reschedule'
import { t } from '@shared/i18n'
import { dependencyConflictWords } from '../../views/planning/dependency-link-words'
import { useOstler } from '../../context/OstlerContext'
import { useToday } from '../../hooks/useToday'
import {
  Button,
  Checkbox,
  DateField,
  Dialog,
  InlineAlert,
  NumberField,
  Radio,
  RadioGroup,
  Skeleton,
  useToast
} from '../../ui'
import { useMoveDependents } from '../move-dependents/MoveDependentsProvider'
import './RescheduleDialog.css'

export interface RescheduleDialogProps {
  open: boolean
  onClose: () => void
  /** The overdue tasks to move; left out, the person's overdue tasks as Today counts them. */
  workItemIds?: string[]
  /** Whose capacity counts when spreading; Me when left out. */
  personId?: string | null
  /** After a reschedule and after its undo: the list reads again. */
  onChanged: () => void
}

const MODES: readonly RescheduleMode[] = ['today', 'tomorrow', 'date', 'spread']
const MODE_LABEL: Record<RescheduleMode, string> = {
  today: 'views:reschedule.modeToday',
  tomorrow: 'views:reschedule.modeTomorrow',
  date: 'views:reschedule.modeDate',
  spread: 'views:reschedule.modeSpread'
}

/**
 * Reschedule overdue work (N1.3): the four ways to move the pile, a preview
 * of every new date from main's one plan (`previewReschedule`), ticks to
 * leave tasks out, and one apply whose toast undoes it all.
 */
export function RescheduleDialog(props: RescheduleDialogProps) {
  if (!props.open) return null
  return <RescheduleDialogBody {...props} />
}

function RescheduleDialogBody({
  onClose,
  workItemIds,
  personId,
  onChanged
}: RescheduleDialogProps) {
  const today = useToday()
  const { projects } = useOstler()
  const { toast, toastUndo } = useToast()
  const { offer: offerMoveDependents } = useMoveDependents()
  const [mode, setMode] = useState<RescheduleMode>('tomorrow')
  const [date, setDate] = useState(() => shiftIsoDate(today, 7))
  const [days, setDays] = useState<number | null>(DEFAULT_SPREAD_DAYS)
  const [plan, setPlan] = useState<ReschedulePlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [left, setLeft] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)

  const spreadDays = days !== null && days >= 1 && days <= MAX_SPREAD_DAYS ? days : null
  const ready = (mode !== 'date' || date !== '') && (mode !== 'spread' || spreadDays !== null)
  const queryKey = JSON.stringify({ mode, date, spreadDays, today, workItemIds, personId })

  useEffect(() => {
    if (!ready) return
    let current = true
    const query: RescheduleQuery = {
      today,
      mode,
      ...(mode === 'date' ? { date } : {}),
      ...(mode === 'spread' ? { days: spreadDays! } : {}),
      ...(workItemIds ? { workItemIds } : {}),
      ...(personId !== undefined ? { personId } : {})
    }
    void window.ostlerAPI.previewReschedule(query).then((result) => {
      if (!current) return
      if (result.ok) {
        setPlan(result.value)
        setError(null)
      } else setError(result.error)
    })
    return () => {
      current = false
    }
    // queryKey stands for every input of the query, so the preview runs once per change.
  }, [queryKey, ready])

  const chosen = plan ? plan.entries.filter((entry) => !left.has(entry.id)) : []
  const projectName = (projectId: string) =>
    projects.find((project) => project.id === projectId)?.name ?? ''

  const apply = async () => {
    if (chosen.length === 0) return
    setBusy(true)
    const result = await window.ostlerAPI.applyReschedule(planChanges(chosen))
    setBusy(false)
    if (!result.ok) {
      toast({ title: t('views:reschedule.couldntApply'), body: result.error, tone: 'danger' })
      return
    }
    onClose()
    onChanged()
    const { changed, skipped } = result.value
    toastUndo(
      t('views:reschedule.applied', { count: changed.length }),
      async () => {
        const undone = await window.ostlerAPI.applyReschedule(undoChanges(changed))
        if (!undone.ok)
          toast({ title: t('views:reschedule.couldntUndo'), body: undone.error, tone: 'danger' })
        onChanged()
      },
      skipped.length > 0 ? t('views:reschedule.skipped', { count: skipped.length }) : undefined
    )
    // Tasks that wait on the moved ones and now start too early (N7.1).
    void offerMoveDependents(changed, onChanged)
  }

  const toggle = (id: string, include: boolean) =>
    setLeft((current) => {
      const next = new Set(current)
      if (include) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      canDismiss={!busy}
      title={t('views:reschedule.title')}
      description={t('views:reschedule.description')}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('views:reschedule.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void apply()}
            disabled={busy || !ready || chosen.length === 0}
          >
            {t('views:reschedule.apply', { count: chosen.length })}
          </Button>
        </>
      }
    >
      <div className="reschedule">
        <div className="reschedule__options">
          <RadioGroup legend={t('views:reschedule.how')}>
            {MODES.map((value) => (
              <Radio
                key={value}
                name="reschedule-mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                label={t(MODE_LABEL[value])}
                hint={value === 'spread' ? t('views:reschedule.modeSpreadHint') : undefined}
              />
            ))}
          </RadioGroup>
          {mode === 'date' && (
            <DateField
              label={t('views:reschedule.date')}
              value={date}
              onChange={setDate}
              due={false}
            />
          )}
          {mode === 'spread' && (
            <NumberField
              label={t('views:reschedule.days')}
              value={days}
              onChange={setDays}
              min={1}
              max={MAX_SPREAD_DAYS}
              unit={t('views:reschedule.daysUnit')}
            />
          )}
        </div>

        {error ? (
          <InlineAlert tone="danger">{t('views:reschedule.couldntPlan', { error })}</InlineAlert>
        ) : plan === null ? (
          <div aria-busy="true" aria-label={t('views:reschedule.loading')}>
            <Skeleton lines={4} />
          </div>
        ) : plan.entries.length === 0 ? (
          <p className="reschedule__quiet">{t('views:reschedule.nothing')}</p>
        ) : (
          <div className="reschedule__scroll">
            <table className="reschedule__table" aria-label={t('views:reschedule.previewLabel')}>
              <thead>
                <tr>
                  <th scope="col">
                    <Checkbox
                      label={null}
                      aria-label={t('views:reschedule.include')}
                      checked={left.size === 0}
                      indeterminate={left.size > 0 && chosen.length > 0}
                      onChange={(event) =>
                        setLeft(
                          event.target.checked
                            ? new Set()
                            : new Set(plan.entries.map((entry) => entry.id))
                        )
                      }
                    />
                  </th>
                  <th scope="col">{t('views:reschedule.task')}</th>
                  <th scope="col">{t('views:reschedule.project')}</th>
                  <th scope="col">{t('views:reschedule.oldDate')}</th>
                  <th scope="col">{t('views:reschedule.newDate')}</th>
                  <th scope="col">{t('views:reschedule.notes')}</th>
                </tr>
              </thead>
              <tbody>
                {plan.entries.map((entry) => {
                  const included = !left.has(entry.id)
                  return (
                    <tr key={entry.id} className={included ? undefined : 'is-left'}>
                      <td>
                        <Checkbox
                          label={null}
                          aria-label={t('views:reschedule.includeTask', { title: entry.title })}
                          checked={included}
                          onChange={(event) => toggle(entry.id, event.target.checked)}
                        />
                      </td>
                      <td className="reschedule__title">{entry.title}</td>
                      <td>{projectName(entry.projectId)}</td>
                      <td className="tabular-nums">{formatIsoDateShort(entry.fromDue)}</td>
                      <td className="tabular-nums">
                        {formatIsoDateShort(entry.toDue)}
                        {entry.toStart && (
                          <span className="reschedule__note">
                            {t('views:reschedule.starts', {
                              date: formatIsoDateShort(entry.toStart)
                            })}
                          </span>
                        )}
                      </td>
                      <td>
                        {entry.recurring && (
                          <span className="reschedule__note">{t('views:reschedule.repeats')}</span>
                        )}
                        {entry.warnings.map((warning) => (
                          <span
                            key={`${warning.taskId}>${warning.dependencyId}`}
                            className="reschedule__note reschedule__note--warning"
                          >
                            {warning.taskId === entry.id
                              ? (dependencyConflictWords(warning.dependencyTitle, warning) ??
                                t('views:reschedule.waitsOn', {
                                  dependency: warning.dependencyTitle,
                                  date: formatIsoDateShort(warning.dependencyDue)
                                }))
                              : t('views:reschedule.waitedOnBy', { task: warning.taskTitle })}
                          </span>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
  )
}
