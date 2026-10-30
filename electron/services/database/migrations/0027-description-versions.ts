import type { Migration } from './types'

/**
 * N2.6, description history (N21): the text a task's description had before
 * a change, one row per sitting (`src/shared/planning/sitting.ts`), with who
 * changed it as activity stores an actor. Activity keeps saying only
 * "description changed"; the text lives here. The newest 50 per task are
 * kept, deleting a task for good removes them, and they never travel in CSV,
 * the project file or a template.
 */
export const descriptionVersions: Migration = {
  version: 27,
  name: 'description-versions',
  up(db) {
    db.exec(`
      CREATE TABLE planning_description_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        actor_kind TEXT NOT NULL,
        actor_person_id TEXT,
        rule_name TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL
      );
      CREATE INDEX idx_planning_description_versions_task
        ON planning_description_versions(work_item_id, ended_at);
      CREATE INDEX idx_planning_description_versions_project
        ON planning_description_versions(project_id);
    `)
  }
}
