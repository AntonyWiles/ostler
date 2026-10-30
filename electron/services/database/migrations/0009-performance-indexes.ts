import type { Migration } from './types'

/**
 * P9.1, performance: two indexes that
 * `EXPLAIN QUERY PLAN` on the scale dataset showed missing.
 *
 * - Every task list (the Board, List, Calendar and Timeline's load, reports,
 *   Home's project cards) reads a project's tasks newest first. The project
 *   index is (project_id, status, updated_at), so that order needed a temporary
 *   sort; on a 5,000-task project the read went from 9.9 ms to 6.3 ms.
 * - A project's ticked checklist items were read by scanning every project's.
 */
export const performanceIndexes: Migration = {
  version: 9,
  name: 'performance-indexes',
  up(db) {
    db.exec(`
      CREATE INDEX idx_planning_work_items_project_updated
        ON planning_work_items(project_id, updated_at);
      CREATE INDEX idx_planning_checklist_checks_project
        ON planning_checklist_checks(project_id);
    `)
  }
}
