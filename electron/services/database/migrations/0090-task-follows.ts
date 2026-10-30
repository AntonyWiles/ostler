import type { Migration } from './types'

/**
 * Following (team-leaders plan, D8): the tasks a person follows, to hear when someone else changes
 * them. An explicit unfollow keeps its row with `following = 0`, so an automatic follow (creating,
 * being assigned, commenting) does not bring it back. Personal: it travels only between the
 * person's own devices. No foreign key: a row may arrive before its task on a device.
 */
export const taskFollows: Migration = {
  version: 90,
  name: 'task-follows',
  up(db) {
    db.exec(`
      CREATE TABLE task_follows (
        work_item_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        followed_at INTEGER NOT NULL,
        following INTEGER NOT NULL DEFAULT 1
      );
    `)
  }
}
