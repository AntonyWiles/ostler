import type { Migration } from './types'

/**
 * N6.3a, budgets and costs (N46): a project's budget (an amount in minor
 * units, or none) and currency (ISO 4217), and its costs, each planned or
 * paid, in whole minor units so every sum is exact. A cost may name a task
 * and a milestone; deleting either keeps the cost and clears the link.
 * `project_id` lets removing a project remove both.
 */
export const budgetsAndCosts: Migration = {
  version: 38,
  name: 'budgets-and-costs',
  up(db) {
    db.exec(`
      CREATE TABLE project_budgets (
        project_id TEXT PRIMARY KEY,
        amount INTEGER CHECK (amount IS NULL OR amount >= 0),
        currency TEXT NOT NULL CHECK (length(currency) = 3),
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE costs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        date TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount >= 0),
        description TEXT NOT NULL CHECK (length(description) <= 200),
        category TEXT NOT NULL DEFAULT '',
        work_item_id TEXT REFERENCES planning_work_items(id) ON DELETE SET NULL,
        milestone_id TEXT REFERENCES planning_milestones(id) ON DELETE SET NULL,
        state TEXT NOT NULL CHECK (state IN ('planned', 'paid')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_costs_project ON costs(project_id, date);
      CREATE INDEX idx_costs_work_item ON costs(work_item_id);
      CREATE INDEX idx_costs_milestone ON costs(milestone_id);
    `)
  }
}
