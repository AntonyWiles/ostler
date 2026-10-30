import type { PlanningSubproject } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { Chip, Select, type SelectOption } from '../../ui'

/**
 * The pieces every surface shares for showing and changing a task's or milestone's workstream
 * (sub-project): the choices, the select and the chip. They read the name and colour from the
 * project's sub-projects, never from the task, so a rename shows everywhere at once.
 */

/** The sub-projects people can still move work into: not archived, in the project's order. */
export function liveSubprojects(
  subprojects: readonly PlanningSubproject[] | undefined
): PlanningSubproject[] {
  return (subprojects ?? []).filter((sub) => sub.archivedAt === null)
}

/**
 * How many of `items` a view can show: those in the workstream open now, or all of them for the
 * whole project. The total in "12 of 30 tasks", so a workstream never counts the project's.
 */
export function countInScope(
  items: readonly { subprojectId?: string | null }[],
  scope: Pick<PlanningSubproject, 'id'> | null | undefined
): number {
  return scope ? items.filter((item) => item.subprojectId === scope.id).length : items.length
}

/**
 * The workstreams to group tasks by, in the project's order: the live ones, and an archived one
 * only while some of `items` is still in it, so no task lands under "No workstream" wrongly.
 */
export function groupableSubprojects(
  subprojects: readonly PlanningSubproject[] | undefined,
  items: readonly { subprojectId?: string | null }[]
): PlanningSubproject[] {
  const used = new Set(items.map((item) => item.subprojectId))
  return (subprojects ?? []).filter((sub) => sub.archivedAt === null || used.has(sub.id))
}

/**
 * The choices for a workstream select: None, then the live sub-projects in order. A task that
 * sits in an archived one still shows it, "(archived)", so the select tells the truth.
 */
export function subprojectOptions(
  subprojects: readonly PlanningSubproject[] | undefined,
  currentId: string | null | undefined
): SelectOption[] {
  const current = (subprojects ?? []).find((sub) => sub.id === currentId && sub.archivedAt !== null)
  return [
    { value: '', label: t('tasks:subprojects.none') },
    ...liveSubprojects(subprojects).map((sub) => ({ value: sub.id, label: sub.name })),
    ...(current
      ? [
          {
            value: current.id,
            label: t('tasks:subprojects.archivedName', { name: current.name }),
            disabled: true
          }
        ]
      : [])
  ]
}

/**
 * The Workstream select for the task drawer and the milestone editor. Absent while the project
 * has no live workstream, unless the record already has one.
 */
export function SubprojectField({
  subprojects,
  value,
  onChange,
  size = 'sm',
  error,
  className
}: {
  subprojects: readonly PlanningSubproject[] | undefined
  /** The sub-project's id, or '' for none. */
  value: string
  onChange: (value: string) => void
  size?: 'sm' | 'md'
  error?: string
  className?: string
}) {
  if (liveSubprojects(subprojects).length === 0 && !value) return null
  return (
    <Select
      label={t('tasks:subprojects.field')}
      size={size}
      className={className}
      value={value}
      error={error}
      onChange={(event) => onChange(event.target.value)}
      options={subprojectOptions(subprojects, value)}
    />
  )
}

/** A small chip naming a workstream, with its colour dot: the card's and the milestone's. */
export function SubprojectChip({
  subprojects,
  subprojectId,
  className
}: {
  subprojects: readonly PlanningSubproject[] | undefined
  subprojectId: string | null | undefined
  className?: string
}) {
  const sub = subprojectId ? (subprojects ?? []).find((s) => s.id === subprojectId) : undefined
  if (!sub) return null
  const title = t('tasks:subprojects.chipTitle', { name: sub.name })
  return (
    <span className={className} title={title}>
      <Chip color={sub.color}>
        {sub.archivedAt === null
          ? sub.name
          : t('tasks:subprojects.archivedName', { name: sub.name })}
      </Chip>
    </span>
  )
}
