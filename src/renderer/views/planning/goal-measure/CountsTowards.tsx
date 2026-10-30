import { useEffect, useState } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import type { GoalCountsTowards, PersonalGoalView, PlanningGoal } from '@shared/ostler-api'
import { linkMismatch } from '@shared/goal-measures'
import { t } from '@shared/i18n'
import { goalsPath } from '../../../navigation/paths'
import { Button, Dialog, Icon, InlineAlert, Select } from '../../../ui'
import { Target } from '../../../ui/icons'

/**
 * "Counts towards Save £5,000" under a project goal (N5.6b), linking to the
 * goal of one's own in Goals. A link whose units or directions no longer
 * match says it does not count.
 */
export function CountsTowardsLine({ link }: { link: GoalCountsTowards }) {
  const inRouter = useInRouterContext()
  const words = link.counts
    ? t('tasks:countsTowards.line', { goal: link.title })
    : t('tasks:countsTowards.lineNotCounting', { goal: link.title })
  return (
    <p className="goal-counts-towards">
      <Icon icon={Target} />
      {inRouter ? (
        <Link
          to={goalsPath(link.personalGoalId)}
          aria-label={t('tasks:countsTowards.open', { goal: link.title })}
        >
          {words}
        </Link>
      ) : (
        <span>{words}</span>
      )}
    </p>
  )
}

/**
 * Counts towards… (N5.6b): picks a goal of one's own with the project goal's
 * unit and direction, or Nothing. Removing a link never changes either
 * goal's check-ins.
 */
export function CountsTowardsDialog({
  goal,
  current,
  onClose,
  onSave
}: {
  goal: PlanningGoal
  current: GoalCountsTowards | null
  onClose: () => void
  onSave: (personalGoalId: string | null, title: string | null) => Promise<boolean>
}) {
  const [goals, setGoals] = useState<PersonalGoalView[] | null>(null)
  const [chosen, setChosen] = useState(current?.personalGoalId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void window.ostlerAPI.listPersonalGoals().then((result) => {
      if (result.ok) setGoals(result.value)
      else setError(result.error)
    })
  }, [])
  const measure = goal.measure ?? null
  const fitting = (goals ?? []).filter(
    (candidate) =>
      candidate.status === 'active' && linkMismatch(candidate.measure, measure) === null
  )
  const unit = measure?.unit.trim() || t('tasks:countsTowards.noUnit')
  const formId = `counts-towards-${goal.id}`
  const options = [
    { value: '', label: t('tasks:countsTowards.nothing') },
    ...fitting.map((candidate) => ({ value: candidate.id, label: candidate.title })),
    // The goal it counts towards now stays choosable even when it no longer fits.
    ...(current && !fitting.some((candidate) => candidate.id === current.personalGoalId)
      ? [{ value: current.personalGoalId, label: current.title }]
      : [])
  ]
  const canChoose = measure !== null && (fitting.length > 0 || current !== null)

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={t('tasks:countsTowards.dialogTitle', { title: goal.title })}
      description={
        !measure
          ? t('tasks:countsTowards.dialogNeedsMeasure')
          : goals !== null && fitting.length === 0
            ? t('tasks:countsTowards.dialogNone', { unit })
            : t('tasks:countsTowards.dialogBody', { unit })
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('tasks:countsTowards.cancel')}
          </Button>
          {canChoose && (
            <Button variant="primary" type="submit" form={formId} loading={busy}>
              {t('tasks:countsTowards.save')}
            </Button>
          )}
        </>
      }
    >
      {error && (
        <InlineAlert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}
      {canChoose && (
        <form
          id={formId}
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault()
            const title = options.find((option) => option.value === chosen)?.label ?? null
            setBusy(true)
            void onSave(chosen || null, chosen ? title : null).then((saved) => {
              setBusy(false)
              if (saved) onClose()
            })
          }}
        >
          <Select
            label={t('tasks:countsTowards.label')}
            value={chosen}
            options={options}
            onChange={(event) => setChosen(event.target.value)}
          />
        </form>
      )}
    </Dialog>
  )
}
