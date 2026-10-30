import type { Migration } from './types'

/**
 * N2.7b, fields and charts by task type (N22): each task type can choose the
 * custom fields its tasks show and a task template new tasks of that type
 * start from. `field_ids` is a JSON list of field ids, or null for "every
 * field", so existing types look as they did. `template_id` names a task
 * template of the project or of every project, or null. The services remove
 * a reference when its field or template is deleted.
 */
export const taskTypeFields: Migration = {
  version: 46,
  name: 'task-type-fields',
  up(db) {
    db.exec(`
      ALTER TABLE planning_task_types ADD COLUMN field_ids TEXT;
      ALTER TABLE planning_task_types ADD COLUMN template_id TEXT;
    `)
  }
}
