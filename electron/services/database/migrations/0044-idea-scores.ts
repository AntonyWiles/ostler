import type { Migration } from './types'

/**
 * N1.1b, ideas and scores (N10): `impact` and `effort` on tasks, whole
 * numbers from 1 to 5 or null. Ideas are tasks in Someday; the Someday view
 * sorts and grids them by these two scores. Scores are optional everywhere.
 */
export const ideaScores: Migration = {
  version: 44,
  name: 'idea-scores',
  up(db) {
    db.exec(`
      ALTER TABLE planning_work_items ADD COLUMN impact INTEGER;
      ALTER TABLE planning_work_items ADD COLUMN effort INTEGER;
    `)
  }
}
