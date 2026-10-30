import { useMemo, useState } from 'react'
import type { LinkableProjectGoal, PersonalGoalView } from '@shared/ostler-api'
import { linkMismatch } from '@shared/goal-measures'
import { groupProjectsByArea } from '@shared/project-areas'
import { t } from '@shared/i18n'
import { useAreas, useProjectList } from '../../context/OstlerContext'
import {
  Button,
  Dialog,
  InlineAlert,
  Select,
  TextArea,
  TextField,
  type SelectOption
} from '../../ui'

/** New goal, or Edit: a title and an outcome. The measure has its own dialog (N5.6a's). */
export function PersonalGoalDialog({
  goal,
  onClose,
  onSave
}: {
  /** The goal being edited; null for a new one. */
  goal: Pick<PersonalGoalView, 'id' | 'title' | 'outcome'> | null
  onClose: () => void
  onSave: (title: string, outcome: string) => Promise<string | null>
}) {
  const [title, setTitle] = useState(goal?.title ?? '')
  const [outcome, setOutcome] = useState(goal?.outcome ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const formId = `personal-goal-${goal?.id ?? 'new'}`

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={goal ? t('views:goals.editTitle') : t('views:goals.newTitle')}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('views:goals.cancel')}
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy}>
            {goal ? t('views:goals.save') : t('views:goals.create')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault()
          setBusy(true)
          void onSave(title, outcome).then((failure) => {
            setBusy(false)
            if (failure === null) onClose()
            else setError(failure)
          })
        }}
      >
        {error && (
          <InlineAlert tone="danger" onDismiss={() => setError(null)}>
            {error}
          </InlineAlert>
        )}
        <TextField
          label={t('views:goals.goalTitle')}
          data-autofocus
          value={title}
          maxLength={160}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
        <TextArea
          label={t('views:goals.outcome')}
          hint={t('views:goals.outcomeHint')}
          rows={3}
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
        />
      </form>
    </Dialog>
  )
}

/**
 * Add a project goal (N5.6b): one across projects, grouped by area, whose
 * measure has the goal's unit and direction. One that counts towards another
 * goal of one's own says so; choosing it moves it here.
 */
export function AddProjectGoalDialog({
  goal,
  goals,
  candidates,
  onClose,
  onAdd
}: {
  goal: PersonalGoalView
  /** Every goal of one's own, to name the one a candidate counts towards now. */
  goals: readonly PersonalGoalView[]
  candidates: readonly LinkableProjectGoal[]
  onClose: () => void
  onAdd: (candidate: LinkableProjectGoal) => Promise<boolean>
}) {
  const projects = useProjectList()
  const areas = useAreas()
  const options = useMemo<SelectOption[]>(() => {
    const linked = new Set(goal.links.map((link) => link.goalId))
    const fitting = candidates.filter(
      (candidate) =>
        !linked.has(candidate.goalId) && linkMismatch(goal.measure, candidate.measure) === null
    )
    const titles = new Map(goals.map((entry) => [entry.id, entry.title]))
    const grouped = groupProjectsByArea(
      projects.filter((project) => fitting.some((candidate) => candidate.projectId === project.id)),
      areas
    )
    return grouped.flatMap((group) =>
      group.projects.flatMap((project) =>
        fitting
          .filter((candidate) => candidate.projectId === project.id)
          .map((candidate) => {
            const elsewhere = candidate.personalGoalId ? titles.get(candidate.personalGoalId) : null
            return {
              value: candidate.goalId,
              label: `${candidate.title} · ${project.name}${
                elsewhere ? ` (${t('views:goals.pickMoves', { goal: elsewhere })})` : ''
              }`,
              ...(areas.length > 0 ? { group: group.area?.name ?? t('projects:areas.noArea') } : {})
            }
          })
      )
    )
  }, [goal, goals, candidates, projects, areas])
  const [chosen, setChosen] = useState(options[0]?.value ?? '')
  const [busy, setBusy] = useState(false)
  const unit = goal.measure?.unit.trim() || t('views:goals.noUnit')
  const formId = `add-project-goal-${goal.id}`

  return (
    <Dialog
      open
      onClose={onClose}
      canDismiss={!busy}
      closeOnBackdrop={false}
      title={t('views:goals.pickTitle', { title: goal.title })}
      description={
        !goal.measure
          ? t('views:goals.pickNeedsMeasure')
          : options.length === 0
            ? t('views:goals.pickNone', { unit })
            : t('views:goals.pickBody', { unit })
      }
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('views:goals.cancel')}
          </Button>
          {options.length > 0 && (
            <Button variant="primary" type="submit" form={formId} loading={busy}>
              {t('views:goals.pickAdd')}
            </Button>
          )}
        </>
      }
    >
      {options.length > 0 && (
        <form
          id={formId}
          className="dialog-form"
          onSubmit={(event) => {
            event.preventDefault()
            const candidate = candidates.find((entry) => entry.goalId === chosen)
            if (!candidate) return
            setBusy(true)
            void onAdd(candidate).then((added) => {
              setBusy(false)
              if (added) onClose()
            })
          }}
        >
          <Select
            label={t('views:goals.pickLabel')}
            value={chosen}
            options={options}
            onChange={(event) => setChosen(event.target.value)}
          />
        </form>
      )}
    </Dialog>
  )
}
