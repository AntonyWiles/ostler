import type { Migration } from './types'

/**
 * N9.8b, smart commits (N66): links between tasks and the commits whose
 * messages name their IDs, one per task and commit. `kind` says whether the
 * message only mentions the task or says it fixes it; `offered_at` is set when
 * a new commit (never the first history import or the one-time reading)
 * fixes an open task, which puts Mark as done in the Inbox.
 *
 * `commit_link_scans` remembers which projects have had their stored commits
 * read once, so the existing `git_events` are linked on the first start after
 * this migration (the prefix that makes an ID lives in `config.json`, which a
 * migration cannot read). Both tables carry `project_id`, so removing a
 * project clears them.
 */
export const commitLinks: Migration = {
  version: 43,
  name: 'commit-links',
  up(db) {
    db.exec(`
      CREATE TABLE task_commit_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL,
        commit_hash TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('mention', 'fixes')),
        found_at INTEGER NOT NULL,
        offered_at INTEGER,
        UNIQUE (work_item_id, commit_hash)
      );
      CREATE INDEX idx_task_commit_links_project ON task_commit_links(project_id, offered_at);
      CREATE TABLE commit_link_scans (
        project_id TEXT PRIMARY KEY,
        scanned_at INTEGER NOT NULL
      );
    `)
  }
}
