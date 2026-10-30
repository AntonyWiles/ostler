import type { Migration } from './types'

/**
 * N6.3b, the shopping list (N46): what a project needs bought. An item has a
 * name, a quantity and unit, an estimate for the whole line (minor units, or
 * none), a supplier (a contact), a task and an order key. Buying it makes a
 * paid cost and the item points at it: the cost's date and amount are when it
 * was bought and the price paid, so the money is recorded once. Deleting the
 * task or the contact clears the link and keeps the item; deleting the cost
 * unticks the item. `project_id` lets removing a project remove its list.
 */
export const shoppingList: Migration = {
  version: 51,
  name: 'shopping-list',
  up(db) {
    db.exec(`
      CREATE TABLE shopping_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 200),
        quantity REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
        unit TEXT NOT NULL DEFAULT '',
        estimate INTEGER CHECK (estimate IS NULL OR estimate >= 0),
        contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
        work_item_id TEXT REFERENCES planning_work_items(id) ON DELETE SET NULL,
        order_key TEXT NOT NULL,
        cost_id TEXT UNIQUE REFERENCES costs(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_shopping_items_project ON shopping_items(project_id, order_key);
      CREATE INDEX idx_shopping_items_contact ON shopping_items(contact_id);
      CREATE INDEX idx_shopping_items_work_item ON shopping_items(work_item_id);
    `)
  }
}
