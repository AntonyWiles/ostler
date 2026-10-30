import type { Migration } from './types'

/**
 * P5.6, Home, Inbox, reminders and recurring tasks: a task's repeat rule, its
 * reminders, and the read and archived
 * state of Inbox items. The Inbox items themselves are derived.
 */
export const homeInboxReminders: Migration = {
  version: 5,
  name: 'home-inbox-reminders',
  up(db) {
    db.exec(`
      -- The repeat rule lives on the latest occurrence and moves to the next
      -- one when this one is done. rule is JSON: { every, interval, weekdays?,
      -- monthDay? }. remaining counts the occurrences still to come (null: no
      -- limit).
      CREATE TABLE planning_recurrences (
        work_item_id TEXT PRIMARY KEY REFERENCES planning_work_items(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        rule TEXT NOT NULL,
        ends_on TEXT,
        remaining INTEGER
      );
      CREATE INDEX idx_planning_recurrences_project ON planning_recurrences(project_id);

      -- The next occurrence a done task made, so Done, Ready, Done makes one.
      ALTER TABLE planning_work_items ADD COLUMN recurred_to_id TEXT;

      -- remind_at is an instant (ms). A due reminder is planned from the due
      -- date and the reminder time in local time; a custom one is chosen.
      CREATE TABLE reminders (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        remind_at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        delivered_at INTEGER,
        dismissed_at INTEGER
      );
      CREATE INDEX idx_reminders_pending ON reminders(delivered_at, remind_at);
      CREATE INDEX idx_reminders_item ON reminders(work_item_id);
      CREATE INDEX idx_reminders_project ON reminders(project_id);

      -- Personal and cross-project: keyed by the derived item's key, such as
      -- reminder:<id> or question:<projectId>:<id>.
      CREATE TABLE inbox_state (
        item_key TEXT PRIMARY KEY,
        read_at INTEGER,
        archived_at INTEGER
      );
    `)
  }
}
