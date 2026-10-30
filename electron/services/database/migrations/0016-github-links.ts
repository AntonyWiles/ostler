import type { Migration } from './types'

/**
 * R4.4, GitHub links (D40): issues and pull requests on tasks.
 *
 * A link is the task, its project, the repository (`owner`, `repo`), the
 * number and whether it is an issue or a pull request. `title`, `state` and
 * `fetched_at` are the cache from the last fetch, which happens only when
 * the person opens the task, presses Refresh or imports. A task links an
 * issue once. Links go with their task (cascade), and the project removal
 * service clears them with the project.
 */
export const githubLinks: Migration = {
  version: 16,
  name: 'github-links',
  up(db) {
    db.exec(`
      CREATE TABLE planning_github_links (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL REFERENCES planning_work_items(id) ON DELETE CASCADE,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        number INTEGER NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        state TEXT,
        fetched_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX idx_planning_github_links_task
        ON planning_github_links(work_item_id, owner COLLATE NOCASE, repo COLLATE NOCASE, number);
      CREATE INDEX idx_planning_github_links_project
        ON planning_github_links(project_id, owner COLLATE NOCASE, repo COLLATE NOCASE, number);
    `)
  }
}
