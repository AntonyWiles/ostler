import type Database from 'better-sqlite3'
import type {
  ItemLinkInfo,
  ItemLinkRef,
  LinkedFromEntry,
  LinkSourceKind,
  LinkTargetKind,
  PlanningWorkItemStatus
} from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { extractItemLinks, LINK_SOURCE_KINDS } from '@shared/item-links'

interface SourceText {
  projectId: string
  text: string
}

interface LinkRow {
  source_kind: LinkSourceKind
  source_id: string
  project_id: string
  title: string | null
  work_item_id: string | null
}

/** At most this many links are looked up in one call: more than any text holds. */
export const MAX_RESOLVE = 500

export function isLinkSourceKind(value: unknown): value is LinkSourceKind {
  return typeof value === 'string' && (LINK_SOURCE_KINDS as readonly string[]).includes(value)
}

/**
 * The link index (N4.4a, N34): which texts link to which items in the same
 * project. Rows are derived from the texts, never written by hand: the search
 * service and the Library repository call `reindex` and `remove` at the same
 * write points as their own indexes, inside the same transaction, so every
 * surface that saves a text (the app, the automation API, rules, imports)
 * keeps it right without knowing it exists.
 */
export class ItemLinkIndex {
  constructor(private readonly db: Database.Database) {}

  /** Re-reads one source's links and replaces its rows. Other kinds of record are ignored. */
  reindex(kind: string, id: string): void {
    if (!isLinkSourceKind(kind)) return
    this.db.prepare('DELETE FROM item_links WHERE source_kind = ? AND source_id = ?').run(kind, id)
    const source = this.sourceText(kind, id)
    if (!source || !source.text.includes('://')) return
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO item_links (project_id, source_kind, source_id, target_kind, target_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const ref of extractItemLinks(source.text, BRAND.urlScheme)) {
      // Within a project only (D5): a link to another project's item still opens, unindexed.
      if (ref.projectId !== source.projectId) continue
      insert.run(source.projectId, kind, id, ref.kind, ref.id)
    }
  }

  /** Takes a source out of the index; a task takes its comments with it (call before deleting it). */
  remove(kind: string, id: string): void {
    if (!isLinkSourceKind(kind)) return
    if (kind === 'task') {
      this.db
        .prepare(
          `DELETE FROM item_links WHERE source_kind = 'comment'
           AND source_id IN (SELECT id FROM planning_comments WHERE work_item_id = ?)`
        )
        .run(id)
    }
    this.db.prepare('DELETE FROM item_links WHERE source_kind = ? AND source_id = ?').run(kind, id)
  }

  /** The text a source's links are read from: the same columns the migration reads. */
  private sourceText(kind: LinkSourceKind, id: string): SourceText | null {
    const row = this.db.prepare(SOURCE_TEXT[kind]).get(id) as
      { project_id: string; text: string } | undefined
    return row ? { projectId: row.project_id, text: row.text } : null
  }

  /**
   * What links to an item, oldest source first. Texts that are gone (a
   * deleted comment, a binned task and its comments) are left out.
   */
  linkedFrom(kind: LinkTargetKind, id: string): LinkedFromEntry[] {
    return this.read('l.target_id = ?', kind, id).map(toEntry)
  }

  /** What links to each of a project's items of one kind, in one query: lists with `linkedFrom`. */
  linkedFromInProject(projectId: string, kind: LinkTargetKind): Map<string, LinkedFromEntry[]> {
    const byTarget = new Map<string, LinkedFromEntry[]>()
    for (const row of this.read('l.project_id = ?', kind, projectId)) {
      byTarget.set(row.target_id, [...(byTarget.get(row.target_id) ?? []), toEntry(row)])
    }
    return byTarget
  }

  private read(
    where: string,
    kind: LinkTargetKind,
    value: string
  ): (LinkRow & { title: string; target_id: string })[] {
    const rows = this.db
      .prepare(
        `SELECT l.source_kind, l.source_id, l.project_id, l.target_id,
                CASE l.source_kind
                  WHEN 'task' THEN t.title
                  WHEN 'comment' THEN ct.title
                  WHEN 'decision' THEN d.title
                  WHEN 'library' THEN li.title
                END AS title,
                CASE l.source_kind
                  WHEN 'task' THEN t.id
                  WHEN 'comment' THEN ct.id
                  ELSE NULL
                END AS work_item_id
         FROM item_links l
         LEFT JOIN planning_work_items t
           ON l.source_kind = 'task' AND t.id = l.source_id AND t.deleted_at IS NULL
         LEFT JOIN planning_comments c
           ON l.source_kind = 'comment' AND c.id = l.source_id AND c.deleted_at IS NULL
         LEFT JOIN planning_work_items ct ON ct.id = c.work_item_id AND ct.deleted_at IS NULL
         LEFT JOIN planning_decisions d ON l.source_kind = 'decision' AND d.id = l.source_id
         LEFT JOIN library_items li ON l.source_kind = 'library' AND li.id = l.source_id
         WHERE l.target_kind = ? AND ${where}
           AND NOT (l.source_kind = 'task' AND l.source_id = l.target_id AND l.target_kind = 'task')
         ORDER BY l.source_kind, l.source_id`
      )
      .all(kind, value) as (LinkRow & { target_id: string })[]
    return rows.filter(
      (row): row is LinkRow & { title: string; target_id: string } => row.title !== null
    )
  }

  /**
   * The current titles of linked items, in one query per kind, for the
   * projects given. An item that is gone, or in a project not given, reads as
   * deleted.
   */
  resolve(refs: readonly ItemLinkRef[], projectIds: readonly string[]): ItemLinkInfo[] {
    const known = new Set(projectIds)
    const found = new Map<
      string,
      { projectId: string; title: string; status?: PlanningWorkItemStatus }
    >()
    const byKind = new Map<LinkTargetKind, string[]>()
    for (const ref of refs.slice(0, MAX_RESOLVE)) {
      if (!known.has(ref.projectId)) continue
      byKind.set(ref.kind, [...(byKind.get(ref.kind) ?? []), ref.id])
    }
    for (const [kind, ids] of byKind) {
      const marks = ids.map(() => '?').join(', ')
      const rows = this.db.prepare(TITLES[kind](marks)).all(...ids) as {
        id: string
        project_id: string
        title: string
        status?: PlanningWorkItemStatus
      }[]
      for (const row of rows) {
        found.set(`${kind}:${row.id}`, {
          projectId: row.project_id,
          title: row.title,
          ...(kind === 'task' && row.status ? { status: row.status } : {})
        })
      }
    }
    return refs.slice(0, MAX_RESOLVE).map((ref) => {
      const item = found.get(`${ref.kind}:${ref.id}`)
      // The id must be in the project the link names: a link cannot borrow another project's item.
      if (!item || item.projectId !== ref.projectId || !known.has(ref.projectId)) {
        return { ...ref, exists: false, title: null }
      }
      return {
        ...ref,
        exists: true,
        title: item.title,
        ...(item.status ? { status: item.status } : {})
      }
    })
  }
}

function toEntry(row: LinkRow & { title: string }): LinkedFromEntry {
  return {
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    projectId: row.project_id,
    title: row.title,
    workItemId: row.work_item_id
  }
}

const SOURCE_TEXT: Record<LinkSourceKind, string> = {
  task: 'SELECT project_id, description AS text FROM planning_work_items WHERE id = ?',
  comment:
    'SELECT project_id, body AS text FROM planning_comments WHERE id = ? AND deleted_at IS NULL',
  decision: `SELECT project_id,
      context || char(10) || decision || char(10) || alternatives_considered || char(10) || consequences AS text
    FROM planning_decisions WHERE id = ?`,
  library: 'SELECT project_id, summary || char(10) || body AS text FROM library_items WHERE id = ?'
}

const TITLES: Record<LinkTargetKind, (marks: string) => string> = {
  task: (marks) =>
    `SELECT id, project_id, title, status FROM planning_work_items WHERE id IN (${marks}) AND deleted_at IS NULL`,
  milestone: (marks) =>
    `SELECT id, project_id, name AS title FROM planning_milestones WHERE id IN (${marks})`,
  decision: (marks) =>
    `SELECT id, project_id, title FROM planning_decisions WHERE id IN (${marks})`,
  library: (marks) => `SELECT id, project_id, title FROM library_items WHERE id IN (${marks})`
}
