import type Database from 'better-sqlite3'
import type {
  AssignedTask,
  AssignedTasksQuery,
  PlanningPriority,
  PlanningWorkItemStatus,
  WatchedProject,
  WorkloadTasksQuery
} from '@shared/ostler-api'
import {
  effectiveFilter,
  matchesFilter,
  type FilterableTask,
  type TaskFilter,
  type TaskFilterCondition
} from '@shared/task-filter'
import { isHiddenNow } from '@shared/planning/show-from'

interface AssignedTaskRow {
  id: string
  project_id: string
  title: string
  description: string
  status: PlanningWorkItemStatus
  column_id: string | null
  priority: PlanningPriority
  labels: string
  acceptance_criteria: string
  target_date: string | null
  start_date: string | null
  assignee_id: string | null
  milestone_id: string | null
  milestone_name: string | null
  estimate: number | null
  linked_harness_task_id: string | null
  created_at: number
  updated_at: number
  show_from?: string | null
  someday?: number
  in_triage?: number
}

function jsonList(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text)
    return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

/**
 * A condition SQL can answer as well as `matchesFilter` does: a status or
 * priority in (or not in) a list. Only under "all", where each condition
 * narrows the rows on its own.
 */
function sqlCondition(condition: TaskFilterCondition): { sql: string; params: string[] } | null {
  const column =
    condition.field === 'status' ? 'w.status' : condition.field === 'priority' ? 'w.priority' : null
  if (!column || !Array.isArray(condition.value) || condition.value.length === 0) return null
  if (condition.op !== 'is' && condition.op !== 'isNot') return null
  const values = condition.value.map(String)
  const marks = values.map(() => '?').join(', ')
  return { sql: `${column} ${condition.op === 'is' ? 'IN' : 'NOT IN'} (${marks})`, params: values }
}

/**
 * My work's one query (R3.1): every live task (not archived, not in the
 * recycle bin) assigned to `personId` in the enabled `projects`, with its
 * milestone's name, leaving out tasks hidden today (N1.1a: in Someday or
 * shown from a later day). The person, project, Hide done and status and priority
 * conditions are answered in SQL; the rest of the filter and the search words
 * through `matchesFilter`, the one filter rule every view uses.
 */
export function queryAssignedTasks(
  db: Database.Database,
  projects: readonly WatchedProject[],
  query: AssignedTasksQuery,
  meId: string | null
): AssignedTask[] {
  const scope = query.projectId
    ? projects.filter((project) => project.id === query.projectId)
    : projects
  if (scope.length === 0) return []
  const byId = new Map(scope.map((project) => [project.id, project]))
  const filter: TaskFilter = effectiveFilter(query.filter ?? { match: 'all', conditions: [] })

  const where = [
    `w.project_id IN (${scope.map(() => '?').join(', ')})`,
    'w.assignee_id = ?',
    'w.archived_at IS NULL',
    'w.deleted_at IS NULL'
  ]
  const params: unknown[] = [...scope.map((project) => project.id), query.personId]
  if (query.hideDone) where.push("w.status <> 'done'")
  const rest: TaskFilterCondition[] = []
  for (const condition of filter.conditions) {
    const sql = filter.match === 'all' ? sqlCondition(condition) : null
    if (sql) {
      where.push(sql.sql)
      params.push(...sql.params)
    } else rest.push(condition)
  }

  const rows = db
    .prepare(
      `SELECT w.id, w.project_id, w.title, w.description, w.status, w.column_id, w.priority, w.labels,
              w.acceptance_criteria, w.target_date, w.start_date, w.assignee_id, w.milestone_id,
              m.name AS milestone_name, w.estimate, w.linked_harness_task_id, w.created_at,
              w.updated_at, w.show_from, w.someday, w.in_triage
       FROM planning_work_items w
       LEFT JOIN planning_milestones m ON m.id = w.milestone_id
       WHERE ${where.join(' AND ')}
       ORDER BY w.target_date IS NULL, w.target_date, w.title`
    )
    .all(...params) as AssignedTaskRow[]

  const words = query.query?.trim() ?? ''
  const remaining: TaskFilter = { match: filter.match, conditions: rest }
  const search: TaskFilter = {
    match: 'all',
    conditions: words ? [{ field: 'text', op: 'contains', value: words }] : []
  }
  const context = { today: query.today, meId }
  const result: AssignedTask[] = []
  for (const row of rows) {
    const shown = {
      showFrom: row.show_from ?? null,
      someday: Boolean(row.someday),
      inTriage: Boolean(row.in_triage)
    }
    if (isHiddenNow(shown, query.today)) continue
    const labels = jsonList(row.labels)
    if (remaining.conditions.length > 0 || search.conditions.length > 0) {
      const candidate: FilterableTask = {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        labels,
        acceptanceCriteria: jsonList(row.acceptance_criteria),
        checkedCriteria: [],
        milestoneId: row.milestone_id,
        targetDate: row.target_date,
        startDate: row.start_date,
        assigneeId: row.assignee_id,
        estimate: row.estimate,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...shown
      }
      if (!matchesFilter(candidate, remaining, context)) continue
      if (!matchesFilter(candidate, search, context)) continue
    }
    result.push(toAssignedTask(row, labels, byId.get(row.project_id)!))
  }
  return result
}

function toAssignedTask(
  row: AssignedTaskRow,
  labels: string[],
  project: WatchedProject
): AssignedTask {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: project.name,
    projectColor: project.color,
    estimateUnit: project.estimateUnit ?? 'points',
    title: row.title,
    status: row.status,
    columnId: row.column_id,
    priority: row.priority,
    targetDate: row.target_date,
    startDate: row.start_date,
    assigneeId: row.assignee_id,
    milestoneId: row.milestone_id,
    milestoneName: row.milestone_name,
    estimate: row.estimate,
    labels,
    linked: row.linked_harness_task_id !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/**
 * Workload's one query (R3.2, D36): every live, unfinished task in the
 * enabled `projects` (or the chosen ones), for everyone and nobody, that can
 * count in a week up to `through`: undated tasks, and dated ones that start
 * (or are due, with no start) by then. Overdue work is in, since it counts
 * in the current week.
 */
export function queryWorkloadTasks(
  db: Database.Database,
  projects: readonly WatchedProject[],
  query: WorkloadTasksQuery
): AssignedTask[] {
  const scope = query.projectIds
    ? projects.filter((project) => query.projectIds!.includes(project.id))
    : projects
  if (scope.length === 0) return []
  const byId = new Map(scope.map((project) => [project.id, project]))
  const rows = db
    .prepare(
      `SELECT w.id, w.project_id, w.title, w.description, w.status, w.column_id, w.priority, w.labels,
              w.acceptance_criteria, w.target_date, w.start_date, w.assignee_id, w.milestone_id,
              m.name AS milestone_name, w.estimate, w.linked_harness_task_id, w.created_at,
              w.updated_at
       FROM planning_work_items w
       LEFT JOIN planning_milestones m ON m.id = w.milestone_id
       WHERE w.project_id IN (${scope.map(() => '?').join(', ')})
         AND w.archived_at IS NULL AND w.deleted_at IS NULL AND w.status <> 'done'
         AND w.in_triage = 0
         AND (COALESCE(w.start_date, w.target_date) IS NULL
              OR COALESCE(w.start_date, w.target_date) <= ?)
       ORDER BY w.target_date IS NULL, w.target_date, w.title`
    )
    .all(...scope.map((project) => project.id), query.through) as AssignedTaskRow[]
  return rows.map((row) => toAssignedTask(row, jsonList(row.labels), byId.get(row.project_id)!))
}
