import type { PlanningWorkItem } from '@shared/ostler-api'
import { SCORE_STEPS, type ScoreField } from '@shared/planning/idea-scores'
import { t } from '@shared/i18n'
import { Select } from '../../../ui'

/**
 * Impact and Effort in the drawer's details (N1.1b): a choice of None or 1
 * to 5 each, saved as soon as it is picked through the one inline update,
 * like a cell edited in the List.
 */
export function TaskScoreFields({
  item,
  onSave
}: {
  item: PlanningWorkItem
  onSave: (patch: Partial<Record<ScoreField, number | null>>) => void
}) {
  const options = [
    { value: '', label: t('tasks:ideas.none') },
    ...SCORE_STEPS.map((step) => ({ value: String(step), label: String(step) }))
  ]
  const field = (name: ScoreField) => (
    <Select
      size="sm"
      label={t(`tasks:ideas.${name}`)}
      hint={name === 'impact' ? t('tasks:ideas.scoreHint') : undefined}
      value={item[name] == null ? '' : String(item[name])}
      options={options}
      onChange={(event) => {
        const value = event.target.value === '' ? null : Number(event.target.value)
        if (value !== (item[name] ?? null)) onSave({ [name]: value })
      }}
    />
  )
  return (
    <>
      {field('impact')}
      {field('effort')}
    </>
  )
}
