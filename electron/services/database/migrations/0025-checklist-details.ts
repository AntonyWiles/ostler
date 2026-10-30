import type { Migration } from './types'

/**
 * N2.2, checklist items with dates and people (N17): an item's optional due
 * date and person, stored beside its tick and keyed the same way, by the task
 * and the item's text (D21). A row exists only while one of the two is set;
 * rows for texts that leave the list are deleted by the same write that
 * changes it, and a rename carries its row to the new text.
 */
export const checklistDetails: Migration = {
  version: 25,
  name: 'checklist-details',
  up(db) {
    db.exec(`
      CREATE TABLE planning_checklist_details (
        work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        criterion_text TEXT NOT NULL,
        due_date TEXT,
        assignee_id TEXT REFERENCES people(id) ON DELETE SET NULL,
        PRIMARY KEY (work_item_id, criterion_text)
      );
      CREATE INDEX idx_planning_checklist_details_project
        ON planning_checklist_details(project_id);
      CREATE INDEX idx_planning_checklist_details_due
        ON planning_checklist_details(due_date) WHERE due_date IS NOT NULL;
    `)
  }
}
