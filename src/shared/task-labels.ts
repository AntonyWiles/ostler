import type {
  EstimateUnit,
  PlanningColumnSettings,
  PlanningCustomColumn,
  PlanningPriority,
  PlanningWorkItemStatus
} from './ostler-api'
import { formatNumber } from './format'
import { t } from './i18n'

/*
 * The words the interface uses for a task's status and priority: the one
 * mapping from the stored values to the glossary. StatusBadge, PriorityIcon
 * and the Board's columns read from here, and main may use it for
 * notifications and exports. The words themselves are keys in
 * src/shared/locales (`tasks:status.*`, `tasks:priority.*`, P11.1); change
 * them there, not at a call site.
 */

/** Board order. */
export const TASK_STATUSES: readonly PlanningWorkItemStatus[] = [
  'backlog',
  'ready',
  'active',
  'blocked',
  'review',
  'done'
]

export const TASK_STATUS_LABELS: Record<PlanningWorkItemStatus, string> = {
  get backlog() {
    return t('tasks:status.backlog')
  },
  get ready() {
    return t('tasks:status.ready')
  },
  get active() {
    return t('tasks:status.active')
  },
  get blocked() {
    return t('tasks:status.blocked')
  },
  get review() {
    return t('tasks:status.review')
  },
  get done() {
    return t('tasks:status.done')
  }
}

/** One line on what belongs in each status (the Board's column hints). */
export const TASK_STATUS_HINTS: Record<PlanningWorkItemStatus, string> = {
  get backlog() {
    return t('tasks:statusHint.backlog')
  },
  get ready() {
    return t('tasks:statusHint.ready')
  },
  get active() {
    return t('tasks:statusHint.active')
  },
  get blocked() {
    return t('tasks:statusHint.blocked')
  },
  get review() {
    return t('tasks:statusHint.review')
  },
  get done() {
    return t('tasks:statusHint.done')
  }
}

/** Lowest first. */
export const TASK_PRIORITIES: readonly PlanningPriority[] = ['low', 'medium', 'high', 'critical']

export const TASK_PRIORITY_LABELS: Record<PlanningPriority, string> = {
  get low() {
    return t('tasks:priority.low')
  },
  get medium() {
    return t('tasks:priority.medium')
  },
  get high() {
    return t('tasks:priority.high')
  },
  get critical() {
    return t('tasks:priority.critical')
  }
}

/**
 * A status's word, for a project when its column settings are given (R2.4,
 * D34): the project's own name for the column, or the standard word when it
 * has none. The one function every surface that shows a project's status
 * words uses. Agents, the harness, the API's values and log lines never pass
 * settings, so they keep the standard words.
 */
export function taskStatusLabel(
  status: PlanningWorkItemStatus,
  columns?: Pick<PlanningColumnSettings, 'names'> | null
): string {
  const named = columns?.names[status]?.trim()
  return named || (TASK_STATUS_LABELS[status] ?? status)
}

/**
 * The custom column (MOP-26) a task is in: its `columnId` names one of the
 * project's columns that counts as the task's status. Anything else (no
 * column, a deleted one, or a status changed since by an agent or a rule)
 * is the status's own column.
 */
export function customColumnOf(
  item: { status: PlanningWorkItemStatus; columnId?: string | null },
  columns?: Pick<PlanningColumnSettings, 'custom'> | null
): PlanningCustomColumn | null {
  if (!item.columnId) return null
  return (
    columns?.custom?.find(
      (column) => column.id === item.columnId && column.countsAs === item.status
    ) ?? null
  )
}

/**
 * A task's status word for a project (MOP-26): the name of the custom column
 * it is in, or its status's word (`taskStatusLabel`). What the person sees
 * as the task's status everywhere a task's own status is shown.
 */
export function taskColumnLabel(
  item: { status: PlanningWorkItemStatus; columnId?: string | null },
  columns?: Pick<PlanningColumnSettings, 'names' | 'custom'> | null
): string {
  return customColumnOf(item, columns)?.name ?? taskStatusLabel(item.status, columns)
}

export function taskPriorityLabel(priority: PlanningPriority): string {
  return TASK_PRIORITY_LABELS[priority] ?? priority
}

/** The estimate field's unit, short: "pts" or "h". */
export const ESTIMATE_UNIT_SHORT: Record<EstimateUnit, string> = {
  get points() {
    return t('tasks:estimate.pointsShort')
  },
  get hours() {
    return t('tasks:estimate.hoursShort')
  }
}

/** An estimate in words: "1 point", "3 hours", "2.5 points". */
export function formatEstimate(estimate: number, unit: EstimateUnit): string {
  return t(unit === 'hours' ? 'tasks:estimate.hours' : 'tasks:estimate.points', {
    count: estimate,
    estimate: formatNumber(estimate)
  })
}
