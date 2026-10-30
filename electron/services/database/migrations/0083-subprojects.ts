import type { Migration } from './types'

/**
 * Sub-projects, shown as workstreams: named parts of one project (a team, a
 * stream of work). Each is a row of `planning_subprojects` with its project's
 * `project_id`, so everything the project shares reaches it with no sharing
 * code. Only tasks and milestones say which part they belong to, through
 * `subproject_id` (null for the whole project); deleting a sub-project
 * clears it on both. The service keeps a task's or milestone's sub-project
 * in the same project.
 */
export const subprojects: Migration = {
  version: 83,
  name: 'subprojects',
  up(db) {
    db.exec(`
      CREATE TABLE planning_subprojects (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL,
        icon TEXT,
        lead_id TEXT REFERENCES people(id) ON DELETE SET NULL,
        members TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        position INTEGER NOT NULL,
        archived_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_planning_subprojects_project
        ON planning_subprojects(project_id, position);
      ALTER TABLE planning_work_items
        ADD COLUMN subproject_id TEXT REFERENCES planning_subprojects(id) ON DELETE SET NULL;
      CREATE INDEX idx_planning_work_items_subproject
        ON planning_work_items(subproject_id) WHERE subproject_id IS NOT NULL;
      ALTER TABLE planning_milestones
        ADD COLUMN subproject_id TEXT REFERENCES planning_subprojects(id) ON DELETE SET NULL;
      CREATE INDEX idx_planning_milestones_subproject
        ON planning_milestones(subproject_id) WHERE subproject_id IS NOT NULL;
    `)
  }
}
