import type { Migration } from './types'

/**
 * N6.5, contacts (N48): the people a project involves who do no work in it,
 * the plumber, the client, the florist. A contact is shared by every project,
 * like a person, so it has no `project_id`; phones (each with a label) and
 * emails are JSON lists. A task names a contact with a role, once per task,
 * contact and role; `project_id` lets removing a project remove its links,
 * and deleting either the task or the contact removes them too.
 */
export const contacts: Migration = {
  version: 40,
  name: 'contacts',
  up(db) {
    db.exec(`
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        organisation TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT '',
        phones TEXT NOT NULL DEFAULT '[]',
        emails TEXT NOT NULL DEFAULT '[]',
        website TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_contacts_name ON contacts(name COLLATE NOCASE);
      CREATE TABLE task_contacts (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('asked-for-it', 'supplier', 'other')),
        created_at INTEGER NOT NULL,
        UNIQUE (work_item_id, contact_id, role)
      );
      CREATE INDEX idx_task_contacts_project ON task_contacts(project_id);
      CREATE INDEX idx_task_contacts_contact ON task_contacts(contact_id);
    `)
  }
}
