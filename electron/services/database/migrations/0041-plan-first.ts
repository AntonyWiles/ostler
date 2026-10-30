import type { Migration } from './types'

/**
 * N9.3b, approve the plan (N61): a task's own Plan first choice ("default"
 * follows the project's Agents plan first, else "yes" or "no"), and every
 * version of a plan an agent sent, with the person's decision, kept with its
 * task. `project_id` lets removing a project remove its plans; a task in the
 * bin keeps them, and emptying the bin removes them with the task.
 */
export const planFirst: Migration = {
  version: 41,
  name: 'plan-first',
  up(db) {
    db.exec(`
      ALTER TABLE planning_work_items
        ADD COLUMN plan_first TEXT NOT NULL DEFAULT 'default'
        CHECK (plan_first IN ('default', 'yes', 'no'));
      CREATE TABLE task_plans (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        work_item_id TEXT REFERENCES planning_work_items(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        task_id TEXT,
        version INTEGER NOT NULL CHECK (version >= 1),
        steps TEXT NOT NULL DEFAULT '[]',
        files TEXT NOT NULL DEFAULT '[]',
        risks TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL
          CHECK (status IN ('pending', 'approved', 'changes-requested', 'cancelled')),
        changes_note TEXT,
        submitted_at TEXT NOT NULL,
        decided_at TEXT,
        changed_before_approval TEXT NOT NULL DEFAULT '[]',
        UNIQUE (session_id, version)
      );
      CREATE INDEX idx_task_plans_project ON task_plans(project_id);
      CREATE INDEX idx_task_plans_work_item ON task_plans(work_item_id);
    `)
  }
}
