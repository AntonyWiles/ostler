import type {
  MyDayTask,
  PlanningPriority,
  PlanningWorkItemStatus,
  WatchedProject
} from '@shared/ostler-api'
import type { FilterableTask } from '@shared/task-filter'

/**
 * The task columns Home reads (Today, Upcoming and My day), shared by
 * `home-service.ts` and `my-day-service.ts` so every Home list reads a task
 * the same way.
 */
const COLUMNS = [
  'id',
  'project_id',
  'title',
  'status',
  'priority',
  'target_date',
  'start_date',
  'assignee_id',
  'milestone_id',
  'estimate',
  'created_at',
  'updated_at',
  'linked_harness_task_id',
  'show_from',
  'someday',
  'in_triage',
  'subproject_id'
]

/** The `SELECT` list, each column after `alias.` when an alias is given. */
export function homeTaskColumns(alias?: string): string {
  return COLUMNS.map((column) => (alias ? `${alias}.${column}` : column)).join(', ')
}

/**
 * `hiddenReason`'s rule (`@shared/planning/show-from`) in SQL: the task is not
 * in To triage, not in Someday, and its show-from date is not after today.
 * Takes one parameter, today's `YYYY-MM-DD`. Every Home query that keeps only
 * available tasks uses this, so SQL and the shared rule cannot drift apart.
 */
export function availableNowSql(alias?: string): string {
  const c = alias ? `${alias}.` : ''
  return `${c}in_triage = 0 AND ${c}someday = 0 AND (${c}show_from IS NULL OR ${c}show_from <= ?)`
}

export interface HomeTaskRow {
  id: string
  project_id: string
  title: string
  status: PlanningWorkItemStatus
  priority: PlanningPriority
  target_date: string | null
  start_date: string | null
  assignee_id: string | null
  milestone_id: string | null
  estimate: number | null
  created_at: number
  updated_at: number
  linked_harness_task_id: string | null
  show_from: string | null
  someday: number
  in_triage: number
  subproject_id: string | null
}

/** A row as Home lists it, with its project's name, colour and estimate unit. */
export function toHomeTask(row: HomeTaskRow, project: WatchedProject): MyDayTask {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: project.name,
    projectColor: project.color,
    subprojectId: row.subproject_id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    targetDate: row.target_date,
    assigneeId: row.assignee_id,
    linked: row.linked_harness_task_id !== null,
    estimate: row.estimate,
    estimateUnit: project.estimateUnit ?? 'points'
  }
}

/** Only the columns Home's filters read; the rest are empty. */
export function filterable(row: HomeTaskRow): FilterableTask {
  return {
    id: row.id,
    title: row.title,
    description: '',
    status: row.status,
    priority: row.priority,
    labels: [],
    acceptanceCriteria: [],
    checkedCriteria: [],
    milestoneId: row.milestone_id,
    targetDate: row.target_date,
    startDate: row.start_date,
    assigneeId: row.assignee_id,
    estimate: row.estimate,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    showFrom: row.show_from,
    someday: Boolean(row.someday),
    inTriage: Boolean(row.in_triage)
  }
}
