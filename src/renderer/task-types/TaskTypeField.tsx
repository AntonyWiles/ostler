import type { PlanningTaskType } from '@shared/ostler-api'
import { Select, type SelectOption } from '../ui'
import { t } from '@shared/i18n'

/** The options a Type field offers: no type, then the project's types in order. */
export function taskTypeOptions(types: readonly PlanningTaskType[]): SelectOption[] {
  return [
    { value: '', label: t('tasks:taskTypes.noType') },
    ...types.map((type) => ({ value: type.id, label: type.name }))
  ]
}

/**
 * The Type field (N2.7a) for the task drawer, New task and quick add. Absent
 * while the project has no types, so such a project looks as it always did.
 */
export function TaskTypeField({
  types,
  value,
  onChange,
  size,
  error,
  className
}: {
  types: readonly PlanningTaskType[]
  /** The type's id, or '' for none. */
  value: string
  onChange: (value: string) => void
  size?: 'sm' | 'md'
  error?: string
  className?: string
}) {
  if (types.length === 0) return null
  return (
    <Select
      label={t('tasks:taskTypes.field')}
      size={size}
      className={className}
      value={types.some((type) => type.id === value) ? value : ''}
      error={error}
      onChange={(event) => onChange(event.target.value)}
      options={taskTypeOptions(types)}
    />
  )
}
