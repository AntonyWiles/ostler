import type { PlanningWorkItemStatus } from '@shared/ostler-api'
import { taskColumnLabel } from '@shared/task-labels'
import { useProjectColumns } from '../context/ColumnsContext'
import {
  Ban,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Eye,
  Icon,
  type LucideIcon
} from './icons'
import { cx } from './cx'
import './StatusBadge.css'

/** Status icons. */
export const STATUS_ICONS: Record<PlanningWorkItemStatus, LucideIcon> = {
  backlog: CircleDashed,
  ready: Circle,
  active: CircleDot,
  blocked: Ban,
  review: Eye,
  done: CircleCheck
}

export interface StatusBadgeProps {
  status: PlanningWorkItemStatus
  /** Icon only; the word moves to the accessible name. */
  iconOnly?: boolean
  /** The task's project, for its column names (R2.4); defaults to the surrounding project. */
  projectId?: string | null
  /** The project's own column the task is in (MOP-26): its name shows instead of the status's. */
  columnId?: string | null
  className?: string
}

/** A task's status: its icon and its project's word for it, both from one source. */
export function StatusBadge({
  status,
  iconOnly = false,
  className,
  projectId,
  columnId
}: StatusBadgeProps) {
  const label = taskColumnLabel({ status, columnId }, useProjectColumns(projectId))
  return (
    <span
      className={cx('ui-status-badge', `ui-status-badge--${status}`, className)}
      {...(iconOnly ? { role: 'img', 'aria-label': label, title: label } : {})}
    >
      <Icon icon={STATUS_ICONS[status]} />
      {!iconOnly && <span>{label}</span>}
    </span>
  )
}
