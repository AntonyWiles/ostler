import type { Migration } from './types'

/**
 * Writing back, my tasks (docs/plans/integrations/overview.md, phase 6): the
 * open tasks assigned to Me copied into one Microsoft To Do or Google Tasks
 * list, and ticking one off there marking it done here. `task_list_target`
 * is that list (one row at most); `task_list_items` maps each copied task to
 * its item there. An empty `remote_id` is an item deleted there: it is not
 * made again until the task changes.
 */
export const taskListItems: Migration = {
  version: 67,
  name: 'task-list-items',
  up(db) {
    db.exec(`
      CREATE TABLE task_list_target (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        account_id TEXT NOT NULL,
        remote_list TEXT NOT NULL,
        name TEXT NOT NULL,
        synced_at INTEGER,
        failed_at INTEGER,
        failure TEXT
      );
      CREATE TABLE task_list_items (
        work_item_id TEXT PRIMARY KEY,
        remote_id TEXT NOT NULL,
        hash TEXT NOT NULL,
        remote_done INTEGER NOT NULL DEFAULT 0,
        synced_at INTEGER NOT NULL
      );
    `)
  }
}
