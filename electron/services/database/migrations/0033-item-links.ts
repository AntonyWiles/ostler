import type Database from 'better-sqlite3'
import { BRAND } from '@shared/brand'
import { extractItemLinks } from '@shared/item-links'
import type { Migration } from './types'

/**
 * N4.4a, links and backlinks (N34): which texts link to which items, so every
 * item can list what links to it. A row says that the text of one source (a
 * task's description, a comment, a decision, a Library item) links to one
 * target (a task, milestone, decision or Library item) in the same project.
 * Links to another project's items are not indexed (D5).
 *
 * The rows are derived from the texts: every save of a source replaces its
 * rows (`ItemLinkIndex`), and this migration fills them for the texts that
 * exist already. Removing a project removes them through `project_id`.
 */
export const itemLinks: Migration = {
  version: 33,
  name: 'item-links',
  up(db) {
    db.exec(`
      CREATE TABLE item_links (
        project_id TEXT NOT NULL,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('task', 'comment', 'decision', 'library')),
        source_id TEXT NOT NULL,
        target_kind TEXT NOT NULL CHECK (target_kind IN ('task', 'milestone', 'decision', 'library')),
        target_id TEXT NOT NULL,
        PRIMARY KEY (source_kind, source_id, target_kind, target_id)
      );
      CREATE INDEX idx_item_links_target ON item_links(target_kind, target_id);
      CREATE INDEX idx_item_links_project ON item_links(project_id);
    `)
    fillExistingLinks(db)
  }
}

/** The texts as they are at version 33, read once. */
function fillExistingLinks(db: Database.Database): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO item_links (project_id, source_kind, source_id, target_kind, target_id)
     VALUES (?, ?, ?, ?, ?)`
  )
  const fill = (kind: string, rows: { id: string; project_id: string; text: string }[]) => {
    for (const row of rows) {
      if (!row.text.includes('://')) continue
      for (const ref of extractItemLinks(row.text, BRAND.urlScheme)) {
        if (ref.projectId !== row.project_id) continue
        insert.run(row.project_id, kind, row.id, ref.kind, ref.id)
      }
    }
  }
  type Row = { id: string; project_id: string; text: string }
  fill(
    'task',
    db
      .prepare(
        "SELECT id, project_id, description AS text FROM planning_work_items WHERE description LIKE '%://%'"
      )
      .all() as Row[]
  )
  fill(
    'comment',
    db
      .prepare(
        "SELECT id, project_id, body AS text FROM planning_comments WHERE deleted_at IS NULL AND body LIKE '%://%'"
      )
      .all() as Row[]
  )
  fill(
    'decision',
    db
      .prepare(
        `SELECT id, project_id,
                context || char(10) || decision || char(10) || alternatives_considered || char(10) || consequences AS text
         FROM planning_decisions`
      )
      .all() as Row[]
  )
  fill(
    'library',
    db
      .prepare(
        "SELECT id, project_id, summary || char(10) || body AS text FROM library_items WHERE summary LIKE '%://%' OR body LIKE '%://%'"
      )
      .all() as Row[]
  )
}
