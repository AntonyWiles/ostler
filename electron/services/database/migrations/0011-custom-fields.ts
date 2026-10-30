import type { Migration } from './types'

/**
 * R2.2, custom fields (D32): a project's own task fields and their values.
 *
 * `planning_fields` holds the definitions: a name, a type that never
 * changes, choice options (each with an id, so renaming one never touches a
 * value) and a position. `planning_field_values` holds one row per task and
 * field, or one per ticked option of a Choices field, typed into a text or a
 * number column, so filtering and sorting by a field is an indexed lookup on
 * `(field_id, value)`. Both go with their task or field (cascade), and the
 * project removal service clears them with the project.
 */
export const customFields: Migration = {
  version: 11,
  name: 'custom-fields',
  up(db) {
    db.exec(`
      CREATE TABLE planning_fields (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        options TEXT NOT NULL DEFAULT '[]',
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_planning_fields_project ON planning_fields(project_id, position);

      CREATE TABLE planning_field_values (
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        field_id TEXT NOT NULL REFERENCES planning_fields(id) ON DELETE CASCADE,
        text_value TEXT,
        number_value REAL
      );
      CREATE INDEX idx_planning_field_values_project ON planning_field_values(project_id);
      CREATE INDEX idx_planning_field_values_item ON planning_field_values(work_item_id, field_id);
      CREATE INDEX idx_planning_field_values_text ON planning_field_values(field_id, text_value);
      CREATE INDEX idx_planning_field_values_number ON planning_field_values(field_id, number_value);
    `)
  }
}
