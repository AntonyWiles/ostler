import type { PlanningPriority } from '@shared/ostler-api'
import { taskPriorityLabel } from '@shared/task-labels'
import { ArrowDown, ArrowUp, Icon, Minus, TriangleAlert, type LucideIcon } from './icons'
import { cx } from './cx'
import './PriorityIcon.css'
import { t } from '@shared/i18n'

/** Priority icons. */
export const PRIORITY_ICONS: Record<PlanningPriority, LucideIcon> = {
  low: ArrowDown,
  medium: Minus,
  high: ArrowUp,
  critical: TriangleAlert
}

export interface PriorityIconProps {
  priority: PlanningPriority
  /** Show the word beside the icon. Without it, the word is the accessible name and tooltip. */
  showLabel?: boolean
  className?: string
}

/** A task's priority: icon plus word (or tooltip), never colour alone. */
export function PriorityIcon({ priority, showLabel = false, className }: PriorityIconProps) {
  const label = t('common:priorityIcon.priority', {
    taskPriorityLabel: taskPriorityLabel(priority)
  })
  return (
    <span
      className={cx('ui-priority', `ui-priority--${priority}`, className)}
      {...(showLabel ? {} : { role: 'img', 'aria-label': label, title: label })}
    >
      <Icon icon={PRIORITY_ICONS[priority]} />
      {showLabel && <span>{taskPriorityLabel(priority)}</span>}
    </span>
  )
}
