import type Database from 'better-sqlite3'
import type {
  LibraryAiAccess,
  LibraryAttachedBy,
  LibraryFileInfo,
  LibraryItem,
  LibraryItemKind,
  LibraryQuery,
  LibraryRevision,
  LibraryTextLocation
} from '@shared/ostler-api'
import { ftsMatchExpression, likePattern, searchTerms } from './search-terms'
import { ItemLinkIndex } from '../item-link-index'
import { firstMatchOffset, locationAt } from '../library-text-location'

/** Revisions kept per item; older ones are pruned on every save. */
export const LIBRARY_REVISIONS_KEPT = 20

interface LibraryItemRow {
  id: string
  project_id: string
  kind: LibraryItemKind
  title: string
  summary: string
  body: string
  url: string | null
  file_json: string | null
  sha256: string | null
  ai_access: LibraryAiAccess
  is_primary_brief: number
  tags_json: string
  revision: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

interface LibraryRevisionRow {
  item_id: string
  revision: number
  title: string
  summary: string
  body: string
  created_at: string
}

export interface LibraryLinkRow {
  library_item_id: string
  work_item_id: string
  revision: number
  created_at: string
  attached_by?: LibraryAttachedBy
  work_item_title?: string
  work_item_code?: string
}

/** One Library match for cross-project search. */
export interface LibrarySearchEntry {
  itemId: string
  projectId: string
  title: string
  /** The item's text, for a snippet made outside SQLite (the LIKE fallback). */
  text: string
  /** FTS5's snippet with marked matches, or null in the fallback. */
  snippet: string | null
  score: number
  /** For a file divided into pages, slides or sheets: where its first match is. */
  location?: LibraryTextLocation
}

/** Text the search index holds for one item. */
export interface LibrarySearchDocument {
  itemId: string
  projectId: string
  title: string
  summary: string
  body: string
  tags: string[]
  extractedText: string
}

/**
 * SQL for the Project Library. Every table carries `project_id` so project
 * removal discovers it. `library_search` is maintained explicitly by the
 * service (no triggers, no external content) so a purge can delete it by
 * `project_id` like any other table.
 */
export class LibraryRepository {
  private readonly ftsAvailable: boolean

  /** The file must already be migrated (`migrateOstlerDatabase`); this class contains no schema. */
  /** Which texts link to which items (N4.4a): a Library item's text is a source. */
  private readonly links: ItemLinkIndex

  constructor(private readonly db: Database.Database) {
    this.ftsAvailable = this.detectFullTextSearch()
    this.links = new ItemLinkIndex(db)
  }

  get hasFullTextSearch(): boolean {
    return this.ftsAvailable
  }

  /** FTS5 is optional: the baseline migration creates `library_search` only where SQLite has it. */
  private detectFullTextSearch(): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'library_search'")
        .get()
    )
  }

  // ─── Items ────────────────────────────────────────────────────────────────

  getItem(itemId: string): LibraryItem | null {
    const row = this.db.prepare('SELECT * FROM library_items WHERE id = ?').get(itemId) as
      LibraryItemRow | undefined
    return row ? toItem(row) : null
  }

  listItems(projectId: string, query: LibraryQuery, matchingIds: string[] | null): LibraryItem[] {
    const where = ['project_id = ?']
    const params: unknown[] = [projectId]
    if (!query.includeArchived) where.push('archived_at IS NULL')
    if (query.kind) {
      where.push('kind = ?')
      params.push(query.kind)
    }
    if (query.access) {
      where.push('ai_access = ?')
      params.push(query.access)
    }
    if (matchingIds) {
      if (matchingIds.length === 0) return []
      where.push(`id IN (${matchingIds.map(() => '?').join(', ')})`)
      params.push(...matchingIds)
    }
    const rows = this.db
      .prepare(`SELECT * FROM library_items WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`)
      .all(...params) as LibraryItemRow[]
    const items = rows.map(toItem)
    return query.tag ? items.filter((item) => item.tags.includes(query.tag!)) : items
  }

  findUnarchivedBySha256(projectId: string, sha256: string): LibraryItem | null {
    const row = this.db
      .prepare(
        `SELECT * FROM library_items
         WHERE project_id = ? AND sha256 = ? AND archived_at IS NULL
         ORDER BY created_at ASC LIMIT 1`
      )
      .get(projectId, sha256) as LibraryItemRow | undefined
    return row ? toItem(row) : null
  }

  insertItem(item: LibraryItem): void {
    this.db
      .prepare(
        `INSERT INTO library_items (
           id, project_id, kind, title, summary, body, url, file_json, sha256,
           ai_access, is_primary_brief, tags_json, revision, created_at, updated_at, archived_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.projectId,
        item.kind,
        item.title,
        item.summary,
        item.body,
        item.url,
        item.file ? JSON.stringify(item.file) : null,
        item.file?.sha256 ?? null,
        item.aiAccess,
        item.isPrimaryBrief ? 1 : 0,
        JSON.stringify(item.tags),
        item.revision,
        item.createdAt,
        item.updatedAt,
        item.archivedAt
      )
  }

  /** Replaces an item's file details only: no revision, no change to when it was updated. */
  saveFileInfo(itemId: string, file: LibraryFileInfo): void {
    this.db
      .prepare('UPDATE library_items SET file_json = ? WHERE id = ?')
      .run(JSON.stringify(file), itemId)
  }

  /** Every document with a file, in every project, oldest first: for the background text pass. */
  listDocumentFiles(): LibraryItem[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM library_items
           WHERE kind = 'document' AND file_json IS NOT NULL
           ORDER BY created_at ASC, id ASC`
        )
        .all() as LibraryItemRow[]
    ).map(toItem)
  }

  /** Writes every mutable column of an existing item. */
  saveItem(item: LibraryItem): void {
    this.db
      .prepare(
        `UPDATE library_items SET
           title = ?, summary = ?, body = ?, url = ?, ai_access = ?, is_primary_brief = ?,
           tags_json = ?, revision = ?, updated_at = ?, archived_at = ?
         WHERE id = ?`
      )
      .run(
        item.title,
        item.summary,
        item.body,
        item.url,
        item.aiAccess,
        item.isPrimaryBrief ? 1 : 0,
        JSON.stringify(item.tags),
        item.revision,
        item.updatedAt,
        item.archivedAt,
        item.id
      )
  }

  clearPrimaryBrief(projectId: string): void {
    this.db
      .prepare(
        'UPDATE library_items SET is_primary_brief = 0 WHERE project_id = ? AND is_primary_brief = 1'
      )
      .run(projectId)
  }

  setPrimaryBriefFlag(itemId: string): void {
    this.db.prepare('UPDATE library_items SET is_primary_brief = 1 WHERE id = ?').run(itemId)
  }

  /** Whether the project has a primary brief that is not archived. */
  hasPrimaryBrief(projectId: string): boolean {
    return (
      this.db
        .prepare(
          'SELECT 1 FROM library_items WHERE project_id = ? AND is_primary_brief = 1 AND archived_at IS NULL LIMIT 1'
        )
        .get(projectId) !== undefined
    )
  }

  deleteItem(itemId: string): void {
    this.db.prepare('DELETE FROM library_items WHERE id = ?').run(itemId)
  }

  // ─── Revisions ────────────────────────────────────────────────────────────

  insertRevision(item: LibraryItem): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO library_item_revisions
           (item_id, project_id, revision, title, summary, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.projectId,
        item.revision,
        item.title,
        item.summary,
        item.body,
        item.updatedAt
      )
    this.db
      .prepare('DELETE FROM library_item_revisions WHERE item_id = ? AND revision <= ?')
      .run(item.id, item.revision - LIBRARY_REVISIONS_KEPT)
  }

  listRevisions(itemId: string): LibraryRevision[] {
    const rows = this.db
      .prepare('SELECT * FROM library_item_revisions WHERE item_id = ? ORDER BY revision DESC')
      .all(itemId) as LibraryRevisionRow[]
    return rows.map(toRevision)
  }

  getRevision(itemId: string, revision: number): LibraryRevision | null {
    const row = this.db
      .prepare('SELECT * FROM library_item_revisions WHERE item_id = ? AND revision = ?')
      .get(itemId, revision) as LibraryRevisionRow | undefined
    return row ? toRevision(row) : null
  }

  // ─── Work item links ──────────────────────────────────────────────────────

  /** The owning project of a planning work item, or null when it does not exist. */
  workItemProjectId(workItemId: string): string | null {
    const row = this.db
      .prepare('SELECT project_id FROM planning_work_items WHERE id = ?')
      .get(workItemId) as { project_id: string } | undefined
    return row?.project_id ?? null
  }

  upsertSource(projectId: string, itemId: string, workItemId: string, revision: number): void {
    this.db
      .prepare(
        `INSERT INTO library_work_item_sources
           (library_item_id, work_item_id, project_id, revision, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(library_item_id, work_item_id) DO UPDATE SET revision = excluded.revision`
      )
      .run(itemId, workItemId, projectId, revision, new Date().toISOString())
  }

  deleteSource(itemId: string, workItemId: string): void {
    this.db
      .prepare(
        'DELETE FROM library_work_item_sources WHERE library_item_id = ? AND work_item_id = ?'
      )
      .run(itemId, workItemId)
  }

  upsertAttachment(
    projectId: string,
    itemId: string,
    workItemId: string,
    attachedBy: LibraryAttachedBy,
    revision: number
  ): void {
    this.db
      .prepare(
        `INSERT INTO library_work_item_attachments
           (library_item_id, work_item_id, project_id, attached_by, revision, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(library_item_id, work_item_id) DO UPDATE SET
           attached_by = excluded.attached_by, revision = excluded.revision`
      )
      .run(itemId, workItemId, projectId, attachedBy, revision, new Date().toISOString())
  }

  deleteAttachment(itemId: string, workItemId: string): void {
    this.db
      .prepare(
        'DELETE FROM library_work_item_attachments WHERE library_item_id = ? AND work_item_id = ?'
      )
      .run(itemId, workItemId)
  }

  countAttachments(workItemId: string): number {
    return (
      this.db
        .prepare(
          'SELECT COUNT(*) AS count FROM library_work_item_attachments WHERE work_item_id = ?'
        )
        .get(workItemId) as { count: number }
    ).count
  }

  hasAttachment(itemId: string, workItemId: string): boolean {
    return !!this.db
      .prepare(
        'SELECT 1 FROM library_work_item_attachments WHERE library_item_id = ? AND work_item_id = ?'
      )
      .get(itemId, workItemId)
  }

  listLinksForWorkItem(
    table: 'library_work_item_sources' | 'library_work_item_attachments',
    projectId: string,
    workItemId: string
  ): LibraryLinkRow[] {
    return this.db
      .prepare(
        `SELECT * FROM ${table} WHERE project_id = ? AND work_item_id = ? ORDER BY created_at ASC`
      )
      .all(projectId, workItemId) as LibraryLinkRow[]
  }

  /** Work items with at least one source edited since it was linked. */
  /** Attachment counts per work item, for the board's "N attached" chip. */
  countAttachmentsByWorkItem(projectId: string): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT work_item_id AS id, COUNT(*) AS count
         FROM library_work_item_attachments
         WHERE project_id = ?
         GROUP BY work_item_id`
      )
      .all(projectId) as { id: string; count: number }[]
    return Object.fromEntries(rows.map((row) => [row.id, row.count]))
  }

  listWorkItemIdsWithChangedSources(projectId: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT link.work_item_id AS id
           FROM library_work_item_sources link
           JOIN library_items item ON item.id = link.library_item_id
           WHERE link.project_id = ? AND item.revision > link.revision`
        )
        .all(projectId) as { id: string }[]
    ).map((row) => row.id)
  }

  listLinksForItem(
    table: 'library_work_item_sources' | 'library_work_item_attachments',
    projectId: string,
    itemId: string
  ): LibraryLinkRow[] {
    return this.db
      .prepare(
        `SELECT link.*, work.title AS work_item_title, work.task_code AS work_item_code
         FROM ${table} link
         JOIN planning_work_items work ON work.id = link.work_item_id
         WHERE link.project_id = ? AND link.library_item_id = ?
         ORDER BY link.created_at ASC`
      )
      .all(projectId, itemId) as LibraryLinkRow[]
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  /** Writes an item into search and, from its saved text, the link index (N4.4a). */
  indexItem(document: LibrarySearchDocument): void {
    this.links.reindex('library', document.itemId)
    if (!this.ftsAvailable) return
    this.db.prepare('DELETE FROM library_search WHERE item_id = ?').run(document.itemId)
    this.db
      .prepare(
        `INSERT INTO library_search
           (item_id, project_id, title, summary, body, tags, extracted_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        document.itemId,
        document.projectId,
        document.title,
        document.summary,
        document.body,
        document.tags.join(' '),
        document.extractedText
      )
  }

  unindexItem(itemId: string): void {
    this.links.remove('library', itemId)
    if (!this.ftsAvailable) return
    this.db.prepare('DELETE FROM library_search WHERE item_id = ?').run(itemId)
  }

  /** Item ids matching `search`, best first. */
  search(projectId: string, search: string): string[] {
    const terms = searchTerms(search)
    if (terms.length === 0) return []
    if (this.ftsAvailable) {
      const rows = this.db
        .prepare(
          `SELECT item_id FROM library_search
           WHERE library_search MATCH ? AND project_id = ?
           ORDER BY rank LIMIT 500`
        )
        .all(ftsMatchExpression(terms), projectId) as { item_id: string }[]
      return rows.map((row) => row.item_id)
    }
    return this.likeSearch([projectId], terms, true, 500).map((row) => row.id)
  }

  /**
   * Cross-project search for the search page and palette (P5.7): matches with
   * a bm25 score (title first) and the raw snippet, whose matches are wrapped
   * in `open` and `close`. Archived items only when asked.
   */
  searchEntries(
    projectIds: string[],
    search: string,
    options: { includeArchived: boolean; limit: number; open: string; close: string }
  ): LibrarySearchEntry[] {
    const terms = searchTerms(search)
    if (terms.length === 0 || projectIds.length === 0) return []
    const inProjects = `(${projectIds.map(() => '?').join(', ')})`
    if (!this.ftsAvailable) {
      return this.likeSearch(projectIds, terms, options.includeArchived, options.limit).map(
        (row) => ({
          itemId: row.id,
          projectId: row.project_id,
          title: row.title,
          text: [row.summary, row.body].filter(Boolean).join('\n'),
          snippet: null,
          score: row.score
        })
      )
    }
    const rows = this.db
      .prepare(
        `SELECT library_search.item_id AS item_id, library_search.project_id AS project_id,
                item.title AS title, item.file_json AS file_json, library_search.rowid AS row_id,
                bm25(library_search, 0, 0, 10.0, 2.0, 1.0, 2.0, 1.0) AS score
         FROM library_search
         JOIN library_items item ON item.id = library_search.item_id
         WHERE library_search MATCH ? AND library_search.project_id IN ${inProjects}
           ${options.includeArchived ? '' : 'AND item.archived_at IS NULL'}
         ORDER BY score LIMIT ?`
      )
      .all(ftsMatchExpression(terms), ...projectIds, options.limit) as {
      item_id: string
      project_id: string
      title: string
      file_json: string | null
      row_id: number
      score: number
    }[]
    // Snippets only for the rows kept: in the ranking query, FTS5 would make
    // one for every match before sorting, which is slow over long file text.
    const snippetOf = this.db.prepare(
      `SELECT snippet(library_search, -1, ?, ?, '…', 16) AS snippet FROM library_search
       WHERE library_search MATCH ? AND rowid = ?`
    )
    const snippet = (rowId: number) =>
      (
        snippetOf.get(options.open, options.close, ftsMatchExpression(terms), rowId) as
          { snippet: string } | undefined
      )?.snippet ?? ''
    return rows.map((row) => {
      const entry: LibrarySearchEntry = {
        itemId: row.item_id,
        projectId: row.project_id,
        title: row.title,
        text: '',
        snippet: null,
        score: row.score
      }
      const sections = row.file_json
        ? (JSON.parse(row.file_json) as LibraryFileInfo).textSections
        : undefined
      if (!sections) return { ...entry, snippet: snippet(row.row_id) }
      // A file in pages, slides or sheets: the passage and its place both come
      // from the first match in the file's text, so they always agree.
      const text = (
        this.db
          .prepare('SELECT extracted_text FROM library_search WHERE rowid = ?')
          .get(row.row_id) as { extracted_text: string } | undefined
      )?.extracted_text
      const offset = text ? firstMatchOffset(text, terms) : -1
      const location = text && offset !== -1 ? locationAt(text, sections, offset) : null
      if (!text || !location) return { ...entry, snippet: snippet(row.row_id) }
      return { ...entry, text, snippet: null, location }
    })
  }

  /**
   * The fallback without FTS5: every term must appear in the item's own text.
   * Extracted document text lives in files, so it is not searchable here. A
   * title hit scores ten times a hit elsewhere, as bm25's weights do.
   */
  private likeSearch(
    projectIds: string[],
    terms: string[],
    includeArchived: boolean,
    limit: number
  ): (LibraryItemRow & { score: number })[] {
    const clauses = terms.map(
      () =>
        "(title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR tags_json LIKE ? ESCAPE '\\')"
    )
    const params = terms.flatMap((term) => {
      const pattern = likePattern(term)
      return [pattern, pattern, pattern, pattern]
    })
    const rows = this.db
      .prepare(
        `SELECT * FROM library_items
         WHERE project_id IN (${projectIds.map(() => '?').join(', ')})
           ${includeArchived ? '' : 'AND archived_at IS NULL'}
           AND ${clauses.join(' AND ')}
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all(...projectIds, ...params, limit) as LibraryItemRow[]
    return rows.map((row) => ({
      ...row,
      score: -terms.reduce(
        (sum, term) =>
          sum +
          (row.title.toLowerCase().includes(term.toLowerCase()) ? 10 : 0) +
          (`${row.summary}\n${row.body}`.toLowerCase().includes(term.toLowerCase()) ? 1 : 0),
        0
      )
    }))
  }
}

function toItem(row: LibraryItemRow): LibraryItem {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    body: row.body,
    url: row.url,
    file: row.file_json ? (JSON.parse(row.file_json) as LibraryFileInfo) : null,
    aiAccess: row.ai_access,
    isPrimaryBrief: row.is_primary_brief === 1,
    tags: JSON.parse(row.tags_json) as string[],
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  }
}

function toRevision(row: LibraryRevisionRow): LibraryRevision {
  return {
    itemId: row.item_id,
    revision: row.revision,
    title: row.title,
    summary: row.summary,
    body: row.body,
    createdAt: row.created_at
  }
}
