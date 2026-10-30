import type { Migration } from './types'

/**
 * Sign-offs (team-leaders plan, D9): someone asks a named person to sign a task, decision or
 * milestone off. Only that person answers. The item can be one of three tables, so there is no
 * foreign key: the planning service deletes an item's sign-offs with the item.
 */
export const signOffs: Migration = {
  version: 91,
  name: 'sign-offs',
  up(db) {
    db.exec(`
      CREATE TABLE planning_sign_offs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        item_kind TEXT NOT NULL CHECK (item_kind IN ('task', 'decision', 'milestone')),
        item_id TEXT NOT NULL,
        approver_person_id TEXT NOT NULL,
        requested_by_person_id TEXT,
        state TEXT NOT NULL CHECK (state IN ('waiting', 'approved', 'changes')),
        note TEXT NOT NULL DEFAULT '',
        requested_at INTEGER NOT NULL,
        answered_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_planning_sign_offs_item ON planning_sign_offs(item_kind, item_id);
      CREATE INDEX idx_planning_sign_offs_approver ON planning_sign_offs(approver_person_id, state);
    `)
  }
}
