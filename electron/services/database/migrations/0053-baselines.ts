import type { Migration } from './types'

/**
 * N7.4, baselines (N52): a named, dated snapshot of every live task's and
 * milestone's dates, at most ten per project (the service keeps the limit).
 * An entry is the item's dates as they were: a task's start and due date, a
 * milestone's target date in `due_date`. Entries name their item by id with
 * no foreign key, so deleting a task or milestone keeps them: the baseline is
 * history. Both tables carry `project_id`, so removing a project removes them.
 */
export const baselines: Migration = {
  version: 53,
  name: 'baselines',
  up(db) {
    db.exec(`
      CREATE TABLE planning_baselines (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 80),
        saved_at INTEGER NOT NULL
      );
      CREATE INDEX idx_planning_baselines_project ON planning_baselines(project_id, saved_at);
      CREATE TABLE planning_baseline_entries (
        baseline_id TEXT NOT NULL REFERENCES planning_baselines(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('task', 'milestone')),
        item_id TEXT NOT NULL,
        start_date TEXT,
        due_date TEXT,
        PRIMARY KEY (baseline_id, kind, item_id)
      );
      CREATE INDEX idx_planning_baseline_entries_project ON planning_baseline_entries(project_id);
    `)
  }
}
