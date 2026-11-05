import type { Migration } from './types'

/**
 * New and changed marks (MOP-82): the tasks someone or something else made or changed on this
 * device's copy since the person last opened them. Kept per device and never synced: each device
 * shows what is new to it. Filled by TEMP triggers (`task-unseen.ts`); empty after the upgrade,
 * so every task that was already there counts as seen.
 */
export const taskUnseen: Migration = {
  version: 94,
  name: 'task-unseen',
  up(db) {
    db.exec(`
      CREATE TABLE task_unseen (
        work_item_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('new', 'changed')),
        at INTEGER NOT NULL
      );
      CREATE INDEX idx_task_unseen_project ON task_unseen(project_id);
    `)
  }
}
