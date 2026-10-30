import type Database from 'better-sqlite3'
import type { HomeChecklistItem, WatchedProject } from '@shared/ostler-api'
import { availableNowSql } from './home-task-row'

interface ItemRow {
  work_item_id: string
  project_id: string
  criterion_text: string
  due_date: string
  assignee_id: string | null
  title: string
}

export interface ChecklistItemsQuery {
  /** The person's local date, `YYYY-MM-DD`. */
  today: string
  /** Whose items; null matches nobody's. */
  personId: string | null
  /** The last due date to include, or null for every date. */
  through: string | null
  /** Also items assigned to nobody that are overdue or due today (Home's Today). */
  nobodyThroughToday: boolean
}

/**
 * Dated checklist items (N2.2, N17) across projects, in one query: unticked
 * items of open tasks that are not hidden (not done, archived, deleted, in
 * Someday or shown from a later day), following the item's person rather
 * than the task's. Ordered by date, then task and item.
 */
export function queryChecklistItems(
  db: Database.Database,
  projects: WatchedProject[],
  query: ChecklistItemsQuery
): HomeChecklistItem[] {
  if (projects.length === 0) return []
  const byId = new Map(projects.map((project) => [project.id, project]))
  const rows = db
    .prepare(
      `SELECT d.work_item_id, d.project_id, d.criterion_text, d.due_date, d.assignee_id, w.title
       FROM planning_checklist_details d
       JOIN planning_work_items w ON w.id = d.work_item_id
       LEFT JOIN planning_checklist_checks c
         ON c.work_item_id = d.work_item_id AND c.criterion_text = d.criterion_text
       WHERE d.project_id IN (${projects.map(() => '?').join(', ')})
         AND d.due_date IS NOT NULL AND (? IS NULL OR d.due_date <= ?)
         AND c.work_item_id IS NULL
         AND w.archived_at IS NULL AND w.deleted_at IS NULL AND w.status <> 'done'
         AND ${availableNowSql('w')}
         AND (d.assignee_id = ? OR (? = 1 AND d.assignee_id IS NULL AND d.due_date <= ?))
       ORDER BY d.due_date, w.title, d.criterion_text`
    )
    .all(
      ...projects.map((project) => project.id),
      query.through,
      query.through,
      query.today,
      query.personId,
      query.nobodyThroughToday ? 1 : 0,
      query.today
    ) as ItemRow[]
  return rows.map((row) => {
    const project = byId.get(row.project_id)!
    return {
      workItemId: row.work_item_id,
      projectId: row.project_id,
      projectName: project.name,
      projectColor: project.color,
      taskTitle: row.title,
      text: row.criterion_text,
      dueDate: row.due_date,
      assigneeId: row.assignee_id,
      overdue: row.due_date < query.today
    }
  })
}
