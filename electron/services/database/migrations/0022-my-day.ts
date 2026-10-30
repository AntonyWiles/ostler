import type { Migration } from './types'

/**
 * N1.4, Plan my day (N12): the tasks a person picked for a day, in their order.
 *
 * `day` is the person's local date (`YYYY-MM-DD`), taken from the renderer.
 * A task is in a day's list at most once (the primary key). `order_key` is a
 * manual order key (`src/shared/planning/order-key.ts`), separate from the
 * task's own place on the Board. `released_at` is set when the person lets an
 * unfinished entry go the next morning, so it is not offered again. Entries
 * are personal planning, not project data: they do not travel in the project
 * file, and removing a project removes them through `project_id`.
 */
export const myDay: Migration = {
  version: 22,
  name: 'my-day',
  up(db) {
    db.exec(`
      CREATE TABLE my_day_entries (
        day TEXT NOT NULL,
        work_item_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        order_key TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        released_at INTEGER,
        PRIMARY KEY (day, work_item_id)
      );
      CREATE INDEX idx_my_day_entries_project ON my_day_entries(project_id, day);
    `)
  }
}
