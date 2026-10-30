import type { Migration } from './types'

/**
 * R6.2, rules (D45): "when this happens, do that", per project.
 *
 * A rule has a name, an on/off switch, one trigger, its conditions and its
 * actions (each stored as JSON, checked by `src/shared/planning/rules.ts`),
 * and when it last ran and how often. A run of rules that a change set off
 * is kept in `planning_rule_runs` with what it changed, so undoing the
 * change undoes the run. `planning_rule_due_runs` remembers which due dates
 * a due-date rule has already looked at, so it runs once per task per due
 * date. "Notify me" leaves a row in `planning_rule_notices`, an Inbox item.
 *
 * What a rule did shows in a task's history as "by rule <name>":
 * `rule_name` on status rows and comments, and the change rows' metadata.
 * Rules, runs and notices are cleared with their project through
 * `project_id`; runs and notices go with their task (cascade).
 */
export const rules: Migration = {
  version: 18,
  name: 'rules',
  up(db) {
    db.exec(`
      CREATE TABLE planning_rules (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        trigger TEXT NOT NULL,
        conditions TEXT NOT NULL DEFAULT '[]',
        actions TEXT NOT NULL,
        last_run_at INTEGER,
        run_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_planning_rules_project ON planning_rules(project_id, created_at);
      CREATE TABLE planning_rule_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        steps TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        undone_at INTEGER
      );
      CREATE INDEX idx_planning_rule_runs_project ON planning_rule_runs(project_id, created_at);
      CREATE TABLE planning_rule_due_runs (
        rule_id TEXT NOT NULL REFERENCES planning_rules(id) ON DELETE CASCADE,
        work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        due_date TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (rule_id, work_item_id, due_date)
      );
      CREATE TABLE planning_rule_notices (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        rule_name TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        delivered_at INTEGER
      );
      CREATE INDEX idx_planning_rule_notices_project ON planning_rule_notices(project_id, created_at);
      ALTER TABLE planning_status_history ADD COLUMN rule_name TEXT;
      ALTER TABLE planning_comments ADD COLUMN rule_name TEXT;
    `)
  }
}
