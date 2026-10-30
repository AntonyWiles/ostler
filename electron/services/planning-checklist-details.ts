import type Database from 'better-sqlite3'
import type { PlanningChecklistDetail } from '@shared/ostler-api'

interface DetailRow {
  work_item_id: string
  criterion_text: string
  due_date: string | null
  assignee_id: string | null
}

/**
 * Checklist items' due dates and people (N2.2, N17), stored beside the ticks
 * and keyed the same way: by task and item text (D21). Owned by
 * `PlanningService`, which validates and calls these inside its own writes.
 */
export class PlanningChecklistDetails {
  constructor(private readonly db: Database.Database) {}

  /** One task's details, by item text. */
  forWorkItem(workItemId: string): Map<string, PlanningChecklistDetail> {
    const rows = this.db
      .prepare(
        `SELECT work_item_id, criterion_text, due_date, assignee_id
         FROM planning_checklist_details WHERE work_item_id = ?`
      )
      .all(workItemId) as DetailRow[]
    return new Map(rows.map((row) => [row.criterion_text, toDetail(row)]))
  }

  /** Every task's details in a project, in one query: task id to (text to detail). */
  forProject(projectId: string): Map<string, Map<string, PlanningChecklistDetail>> {
    const rows = this.db
      .prepare(
        `SELECT work_item_id, criterion_text, due_date, assignee_id
         FROM planning_checklist_details WHERE project_id = ?`
      )
      .all(projectId) as DetailRow[]
    const byItem = new Map<string, Map<string, PlanningChecklistDetail>>()
    for (const row of rows) {
      const details = byItem.get(row.work_item_id) ?? new Map<string, PlanningChecklistDetail>()
      details.set(row.criterion_text, toDetail(row))
      byItem.set(row.work_item_id, details)
    }
    return byItem
  }

  /** Writes one item's date and person; both empty removes its row. */
  set(
    workItemId: string,
    projectId: string,
    text: string,
    dueDate: string | null,
    assigneeId: string | null
  ): void {
    if (dueDate === null && assigneeId === null) {
      this.db
        .prepare(
          'DELETE FROM planning_checklist_details WHERE work_item_id = ? AND criterion_text = ?'
        )
        .run(workItemId, text)
      return
    }
    this.db
      .prepare(
        `INSERT INTO planning_checklist_details
           (work_item_id, project_id, criterion_text, due_date, assignee_id)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (work_item_id, criterion_text)
         DO UPDATE SET due_date = excluded.due_date, assignee_id = excluded.assignee_id`
      )
      .run(workItemId, projectId, text, dueDate, assigneeId)
  }

  /**
   * Carries renamed items' details to their new texts. Two passes through a
   * placeholder, so a swap of two texts cannot collide.
   */
  rename(workItemId: string, moves: [from: string, to: string][]): void {
    const move = this.db.prepare(
      `UPDATE OR IGNORE planning_checklist_details SET criterion_text = ?
       WHERE work_item_id = ? AND criterion_text = ?`
    )
    // A placeholder no item can hold: items are trimmed, never start with NUL.
    const hold = (index: number) => `\u0000rename:${index}`
    moves.forEach(([from], index) => move.run(hold(index), workItemId, from))
    moves.forEach(([, to], index) => move.run(to, workItemId, hold(index)))
  }

  /** Removes the details of items whose text left the list. */
  deleteNotIn(workItemId: string, criteria: string[]): void {
    const keep = new Set(criteria)
    const rows = this.db
      .prepare('SELECT criterion_text FROM planning_checklist_details WHERE work_item_id = ?')
      .all(workItemId) as Pick<DetailRow, 'criterion_text'>[]
    const remove = this.db.prepare(
      'DELETE FROM planning_checklist_details WHERE work_item_id = ? AND criterion_text = ?'
    )
    for (const row of rows)
      if (!keep.has(row.criterion_text)) remove.run(workItemId, row.criterion_text)
  }
}

/** The details in list order, only for texts still on the list. */
export function detailsInOrder(
  criteria: string[],
  details: Map<string, PlanningChecklistDetail> | undefined
): PlanningChecklistDetail[] {
  if (!details || details.size === 0) return []
  return criteria.flatMap((text) => {
    const detail = details.get(text)
    return detail ? [detail] : []
  })
}

function toDetail(row: DetailRow): PlanningChecklistDetail {
  return { text: row.criterion_text, dueDate: row.due_date, assigneeId: row.assignee_id }
}
