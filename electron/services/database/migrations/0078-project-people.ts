import type { Migration } from './types'

/**
 * People in two places: the address book (`project_id` null), offered in every project, and a
 * project's own people (`project_id` set), offered only there. A project's people go with it when
 * it is removed (`deleteProjectRows` clears every table with a `project_id`): a demo's people
 * leave with the demo. Everyone from before this migration is in the address book.
 */
export const projectPeople: Migration = {
  version: 78,
  name: 'project-people',
  up(db) {
    db.exec(`
      ALTER TABLE people ADD COLUMN project_id TEXT;
      CREATE INDEX idx_people_project ON people(project_id) WHERE project_id IS NOT NULL;
    `)
  }
}
