import type { Migration } from './types'

/**
 * N9.6b, playbooks (N64): a task template may be a playbook, a template for
 * agents that Run playbook makes and queues in one step. The mark lets the
 * Task templates list show playbooks apart; a playbook's agent part (model,
 * effort, plan first and extra instructions) lives in the template's body.
 * Every existing template is an ordinary one.
 */
export const playbooks: Migration = {
  version: 55,
  name: 'playbooks',
  up(db) {
    db.exec(`
      ALTER TABLE planning_task_templates ADD COLUMN playbook INTEGER NOT NULL DEFAULT 0
        CHECK (playbook IN (0, 1));
    `)
  }
}
