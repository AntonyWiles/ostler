import type { PlanningIteration } from '@shared/ostler-api'
import { openIterations } from '@shared/planning/iterations'
import { Select, type SelectOption } from '../ui'
import { iterationStatusLabel } from './iteration-words'
import { t } from '@shared/i18n'

/**
 * The options an Iteration field offers: no iteration, every unfinished
 * iteration in date order, and the value it holds when that one is finished.
 */
export function iterationOptions(
  iterations: readonly PlanningIteration[],
  value: string | null
): SelectOption[] {
  const shown = openIterations(iterations)
  const held = iterations.find((iteration) => iteration.id === value)
  if (held && !shown.includes(held)) shown.push(held)
  return [
    { value: '', label: t('tasks:iterations.noIteration') },
    ...shown.map((iteration) => ({
      value: iteration.id,
      label:
        iteration.status === 'planned'
          ? iteration.name
          : t('tasks:iterations.optionWithStatus', {
              name: iteration.name,
              status: iterationStatusLabel(iteration.status)
            })
    }))
  ]
}

/**
 * The Iteration field (R6.1) for the task drawer and New task. Absent while
 * the project has no iterations, so such a project looks as it always did.
 */
export function IterationField({
  iterations,
  value,
  onChange,
  size,
  error,
  className
}: {
  iterations: readonly PlanningIteration[]
  /** The iteration's id, or '' for none. */
  value: string
  onChange: (value: string) => void
  size?: 'sm' | 'md'
  error?: string
  className?: string
}) {
  if (iterations.length === 0 && !value) return null
  return (
    <Select
      label={t('tasks:iterations.field')}
      size={size}
      className={className}
      value={value}
      error={error}
      onChange={(event) => onChange(event.target.value)}
      options={iterationOptions(iterations, value || null)}
    />
  )
}
