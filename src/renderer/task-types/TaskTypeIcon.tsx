import { memo } from 'react'
import type { PlanningTaskType } from '@shared/ostler-api'
import { Icon } from '../ui/icons'
import { taskTypeGlyph } from './task-type-icons'
import { t } from '@shared/i18n'
import './TaskTypeIcon.css'

/** A task's type icon by its id, or nothing for none or a type that is gone. */
export function TaskTypeIconFor({
  typeId,
  types
}: {
  typeId: string | null | undefined
  types: ReadonlyMap<string, PlanningTaskType>
}) {
  const type = typeId ? types.get(typeId) : undefined
  return type ? <TaskTypeIcon type={type} /> : null
}

/**
 * A task's type as its icon (N2.7a), in the type's colour, named for screen
 * readers and in a tooltip ("Type: Bug"), so the type is never colour alone.
 */
export const TaskTypeIcon = memo(function TaskTypeIcon({
  type,
  className
}: {
  type: Pick<PlanningTaskType, 'name' | 'icon' | 'color'>
  className?: string
}) {
  const label = t('tasks:taskTypes.typeIs', { name: type.name })
  return (
    <span
      className={['task-type-icon', className ?? ''].filter(Boolean).join(' ')}
      style={{ color: type.color }}
      title={label}
    >
      <Icon icon={taskTypeGlyph(type.icon)} label={label} />
    </span>
  )
})
