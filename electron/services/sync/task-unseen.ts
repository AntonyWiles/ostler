import type Database from 'better-sqlite3'
import { NOW_MS, quote, tableShape } from '../change-history/table-shape'

/**
 * New and changed marks (MOP-82). A task gets a row in `task_unseen` when it arrives or changes
 * through anything but the person's own hand on this device: another device or person (sync),
 * an agent, the automation API or a background job. The person's own change, and opening the
 * task, clear it. Kept apart from the sync capture's other triggers, which it rides on: they
 * already know, on the desktop and the phone alike, whether a write is the person's.
 */

/** The task columns a person would call a change; ordering, queue and rating bookkeeping are not. */
export const UNSEEN_COLUMNS: readonly string[] = [
  'title',
  'description',
  'status',
  'column_id',
  'priority',
  'labels',
  'acceptance_criteria',
  'target_date',
  'start_date',
  'estimate',
  'milestone_id',
  'iteration_id',
  'assignee_id',
  'type_id',
  'blocked_reason',
  'resolution',
  'archived_at',
  'deleted_at'
]

/**
 * The TEMP triggers, given SQL expressions for "changes from another device are being applied"
 * and for the actor ('human' for the person's own call). Nothing when the table is missing.
 */
export function taskUnseenTriggers(db: Database.Database, applying: string, actor: string): string {
  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_unseen'")
    .get()
  const shape = tableShape(db, 'planning_work_items')
  if (!hasTable || !shape) return ''
  const changed = UNSEEN_COLUMNS.filter((column) => shape.columns.includes(column))
    .map((column) => `OLD.${quote(column)} IS NOT NEW.${quote(column)}`)
    .join(' OR ')
  const other = `(${applying} OR ${actor} IS NOT 'human')`
  const mark = (kind: 'new' | 'changed') =>
    `INSERT INTO main.task_unseen (work_item_id, project_id, kind, at)
     VALUES (NEW.id, NEW.project_id, '${kind}', ${NOW_MS})
     ON CONFLICT (work_item_id) DO UPDATE SET at = excluded.at, project_id = excluded.project_id;`
  return `
    CREATE TEMP TRIGGER IF NOT EXISTS ostler_unseen_insert AFTER INSERT ON main.planning_work_items
    WHEN ${other} BEGIN ${mark('new')} END;
    CREATE TEMP TRIGGER IF NOT EXISTS ostler_unseen_update AFTER UPDATE ON main.planning_work_items
    WHEN ${other} AND (${changed || '0'}) BEGIN ${mark('changed')} END;
    CREATE TEMP TRIGGER IF NOT EXISTS ostler_unseen_own AFTER UPDATE ON main.planning_work_items
    WHEN NOT ${other} AND (${changed || '0'})
    BEGIN DELETE FROM main.task_unseen WHERE work_item_id = NEW.id; END;
    CREATE TEMP TRIGGER IF NOT EXISTS ostler_unseen_delete AFTER DELETE ON main.planning_work_items
    BEGIN DELETE FROM main.task_unseen WHERE work_item_id = OLD.id; END;
  `
}

export type UnseenKind = 'new' | 'changed'

/** The project's marked tasks: task id to whether it is new or changed. */
export function unseenTasks(db: Database.Database, projectId: string): Record<string, UnseenKind> {
  const rows = db
    .prepare('SELECT work_item_id, kind FROM task_unseen WHERE project_id = ?')
    .all(projectId) as { work_item_id: string; kind: UnseenKind }[]
  return Object.fromEntries(rows.map((row) => [row.work_item_id, row.kind]))
}

/** Clears the marks on these tasks (opened). */
export function markTasksSeen(db: Database.Database, taskIds: readonly string[]): void {
  const remove = db.prepare('DELETE FROM task_unseen WHERE work_item_id = ?')
  for (const id of taskIds) remove.run(id)
}

/** Clears every mark in the project. */
export function markProjectSeen(db: Database.Database, projectId: string): void {
  db.prepare('DELETE FROM task_unseen WHERE project_id = ?').run(projectId)
}
