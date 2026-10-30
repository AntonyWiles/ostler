import type { Migration } from './types'

/**
 * N6.4, billable time (N47): a time entry is billable or not, and belongs to
 * at most one billing; a project's money settings (beside N6.3a's budget)
 * gain an hourly rate in minor units per hour (or none) and whether new time
 * is billable. A billing records a project's date range, when it was marked
 * and the totals at that moment, so a later rate change never alters it.
 * `project_id` lets removing a project remove its billings.
 */
export const billableTime: Migration = {
  version: 39,
  name: 'billable-time',
  up(db) {
    db.exec(`
      ALTER TABLE planning_time_entries ADD COLUMN billable INTEGER NOT NULL DEFAULT 0
        CHECK (billable IN (0, 1));
      ALTER TABLE planning_time_entries ADD COLUMN billing_id TEXT;
      CREATE INDEX idx_time_entries_billing ON planning_time_entries(billing_id);
      ALTER TABLE project_budgets ADD COLUMN hourly_rate INTEGER
        CHECK (hourly_rate IS NULL OR hourly_rate >= 0);
      ALTER TABLE project_budgets ADD COLUMN new_time_billable INTEGER NOT NULL DEFAULT 0
        CHECK (new_time_billable IN (0, 1));
      CREATE TABLE billings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        from_date TEXT NOT NULL,
        to_date TEXT NOT NULL,
        marked_at INTEGER NOT NULL,
        entry_count INTEGER NOT NULL,
        billable_seconds INTEGER NOT NULL,
        hourly_rate INTEGER,
        amount INTEGER,
        currency TEXT NOT NULL CHECK (length(currency) = 3)
      );
      CREATE INDEX idx_billings_project ON billings(project_id, marked_at);
    `)
  }
}
