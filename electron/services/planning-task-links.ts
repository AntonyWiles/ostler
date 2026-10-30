import type Database from 'better-sqlite3'
import type { PlanningLinkKind, PlanningTaskLink, PlanningWorkItemStatus } from '@shared/ostler-api'
import { linkRole } from '@shared/planning/links'

/** A stored link: from the duplicate or copy to its original; either way for "relates". */
export interface TaskLinkRow {
  id: string
  projectId: string
  fromWorkItemId: string
  toWorkItemId: string
  kind: PlanningLinkKind
  createdAt: number
}

interface LinkRow {
  id: string
  project_id: string
  from_work_item_id: string
  to_work_item_id: string
  kind: PlanningLinkKind
  created_at: number
}

interface ViewRow extends LinkRow {
  other_id: string
  other_title: string
  other_status: PlanningWorkItemStatus
  other_archived_at: number | null
  other_deleted_at: number | null
}

/**
 * Links between tasks besides waits-on (N2.4, N19), in their own table so no
 * scheduling code can read them. Owned by `PlanningService`, which validates,
 * records activity and calls these inside its own writes.
 */
export class PlanningTaskLinks {
  constructor(private readonly db: Database.Database) {}

  /** One task's links, read from its end, with the other task's title and state, in one query. */
  forWorkItem(workItemId: string): PlanningTaskLink[] {
    const rows = this.db
      .prepare(
        `SELECT l.*, o.id AS other_id, o.title AS other_title, o.status AS other_status,
                o.archived_at AS other_archived_at, o.deleted_at AS other_deleted_at
         FROM planning_task_links l
         JOIN planning_work_items o
           ON o.id = CASE WHEN l.from_work_item_id = ? THEN l.to_work_item_id ELSE l.from_work_item_id END
         WHERE l.from_work_item_id = ? OR l.to_work_item_id = ?
         ORDER BY l.created_at, l.id`
      )
      .all(workItemId, workItemId, workItemId) as ViewRow[]
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      kind: row.kind,
      role: linkRole(row.kind, row.from_work_item_id === workItemId),
      workItemId,
      otherWorkItemId: row.other_id,
      otherTitle: row.other_title,
      otherStatus: row.other_status,
      otherClosed: row.other_archived_at !== null || row.other_deleted_at !== null,
      createdAt: row.created_at
    }))
  }

  /** Every link in a project, as stored: for the project file. */
  forProject(projectId: string): TaskLinkRow[] {
    const rows = this.db
      .prepare('SELECT * FROM planning_task_links WHERE project_id = ? ORDER BY created_at, id')
      .all(projectId) as LinkRow[]
    return rows.map(toRow)
  }

  get(linkId: string): TaskLinkRow | null {
    const row = this.db.prepare('SELECT * FROM planning_task_links WHERE id = ?').get(linkId) as
      LinkRow | undefined
    return row ? toRow(row) : null
  }

  /** Whether the two tasks already have a link of this kind, whichever way round. */
  exists(kind: PlanningLinkKind, a: string, b: string): boolean {
    return (
      this.db
        .prepare(
          `SELECT 1 FROM planning_task_links WHERE kind = ?
           AND ((from_work_item_id = ? AND to_work_item_id = ?)
             OR (from_work_item_id = ? AND to_work_item_id = ?))`
        )
        .get(kind, a, b, b, a) !== undefined
    )
  }

  insert(link: TaskLinkRow): void {
    this.db
      .prepare(
        `INSERT INTO planning_task_links
           (id, project_id, from_work_item_id, to_work_item_id, kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        link.id,
        link.projectId,
        link.fromWorkItemId,
        link.toWorkItemId,
        link.kind,
        link.createdAt
      )
  }

  delete(linkId: string): void {
    this.db.prepare('DELETE FROM planning_task_links WHERE id = ?').run(linkId)
  }
}

function toRow(row: LinkRow): TaskLinkRow {
  return {
    id: row.id,
    projectId: row.project_id,
    fromWorkItemId: row.from_work_item_id,
    toWorkItemId: row.to_work_item_id,
    kind: row.kind,
    createdAt: row.created_at
  }
}
