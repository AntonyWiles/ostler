import type { Migration } from './types'

/**
 * N2.4, links between tasks (N19): "relates to", "duplicates" and "copied
 * from", stored apart from `planning_dependencies` so nothing that schedules
 * work can read them. A row points from one task to another in the same
 * project: from the duplicate to its original, from the copy to the task it
 * was copied from; "relates to" reads the same either way. One link per pair
 * and kind, whichever way round, and deleting either task removes it.
 */
export const taskLinks: Migration = {
  version: 26,
  name: 'task-links',
  up(db) {
    db.exec(`
      CREATE TABLE planning_task_links (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        from_work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        to_work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('relates', 'duplicates', 'copied-from')),
        created_at INTEGER NOT NULL,
        CHECK (from_work_item_id <> to_work_item_id)
      );
      CREATE UNIQUE INDEX idx_planning_task_links_pair ON planning_task_links(
        kind,
        min(from_work_item_id, to_work_item_id),
        max(from_work_item_id, to_work_item_id)
      );
      CREATE INDEX idx_planning_task_links_project ON planning_task_links(project_id);
      CREATE INDEX idx_planning_task_links_from ON planning_task_links(from_work_item_id);
      CREATE INDEX idx_planning_task_links_to ON planning_task_links(to_work_item_id);
    `)
  }
}
