import type { Migration } from './types'

/**
 * P5.1, task essentials: people, a task's
 * assignee, start date and estimate, the checklist's ticks and label colours.
 */
export const taskEssentials: Migration = {
  version: 3,
  name: 'task-essentials',
  up(db) {
    db.exec(`
      -- Global, not project-scoped: one list of people for every project (D5).
      CREATE TABLE people (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        initials TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL,
        is_me INTEGER NOT NULL DEFAULT 0,
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      -- At most one person is Me.
      CREATE UNIQUE INDEX idx_people_single_me ON people(is_me) WHERE is_me = 1;

      ALTER TABLE planning_work_items
        ADD COLUMN assignee_id TEXT REFERENCES people(id) ON DELETE SET NULL;
      ALTER TABLE planning_work_items ADD COLUMN start_date TEXT;
      ALTER TABLE planning_work_items ADD COLUMN estimate REAL;
      CREATE INDEX idx_planning_work_items_assignee ON planning_work_items(assignee_id);

      -- A ticked checklist item, keyed by its text (the criteria stay a
      -- string list, D21). Rows for texts that leave the list are deleted by
      -- the same write that changes it.
      CREATE TABLE planning_checklist_checks (
        work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        criterion_text TEXT NOT NULL,
        checked_at INTEGER NOT NULL,
        PRIMARY KEY (work_item_id, criterion_text)
      );

      -- A label's chosen colour. Labels themselves live on the tasks; one
      -- without a row here gets a stable default colour.
      CREATE TABLE planning_labels (
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        PRIMARY KEY (project_id, name)
      );
    `)
  }
}
