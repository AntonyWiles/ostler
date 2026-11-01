import type Database from 'better-sqlite3'
import type {
  PlanningResolution,
  SearchEntityType,
  SearchOptions,
  SearchResult,
  SearchSnippetPart
} from '@shared/ostler-api'
import { SEARCH_ENTITY_TYPES } from '@shared/ostler-api'
import { LibraryRepository } from './database/library-repository'
import { ItemLinkIndex } from './item-link-index'
import { ftsMatchExpression, searchTerms } from './database/search-terms'
import { t } from '@shared/i18n'
import { parseTaskKey, taskKey } from '@shared/task-key'

/** The planning records `search_index` holds. */
export type IndexedEntityType = Exclude<SearchEntityType, 'library'>

/** Marks around a match in FTS5's snippets; control characters no text contains. */
const OPEN = '\u0001'
const CLOSE = '\u0002'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const SNIPPET_RADIUS = 60

interface IndexDocument {
  projectId: string
  title: string
  body: string
}

/** A contact's stored phones (N6.5) as their numbers. */
function phoneNumbers(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed
          .map((entry) =>
            entry && typeof entry === 'object' ? (entry as { number?: unknown }).number : null
          )
          .filter((number): number is string => typeof number === 'string')
      : []
  } catch {
    return []
  }
}

function jsonList(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

const lines = (...parts: string[]) => parts.filter((part) => part.trim() !== '').join('\n')

/**
 * Content search across tasks, goals, milestones, decisions and comments
 * (P5.7), merged with the Library's own index. The planning service calls
 * `indexEntity` and `removeEntity` at each entity's single write point, inside
 * the same transaction, so every surface that writes through it (the app,
 * the automation API, housekeeping purges, later imports) keeps the index
 * right without knowing it exists.
 *
 * Without FTS5 there is no `search_index`: indexing does nothing and search
 * reads the planning tables with LIKE, as the Library does.
 */
export class SearchService {
  private readonly ftsAvailable: boolean
  private readonly library: LibraryRepository
  /** Which texts link to which items (N4.4a), kept with the search index. */
  readonly links: ItemLinkIndex

  constructor(
    private readonly db: Database.Database,
    private readonly getProjectIds: () => string[],
    /** A project's task prefix (N9.8a): a typed ID finds its task first. */
    private readonly getTaskPrefix: (projectId: string) => string | null = () => null,
    /**
     * False reads the tables directly (the LIKE fallback) even when `search_index` exists: the
     * phone's copy of the database has the table but never writes to it.
     */
    useIndex = true
  ) {
    this.ftsAvailable =
      useIndex &&
      Boolean(
        db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'search_index'")
          .get()
      )
    this.library = new LibraryRepository(db)
    this.links = new ItemLinkIndex(db)
  }

  get hasFullTextSearch(): boolean {
    return this.ftsAvailable
  }

  // ─── Writing ──────────────────────────────────────────────────────────────

  /** Writes one record's current text into the index, or removes it when it is gone. */
  indexEntity(type: IndexedEntityType, id: string): void {
    // The link index (N4.4a) is kept at the same write points, with or without FTS5.
    this.links.reindex(type, id)
    if (!this.ftsAvailable) return
    this.db
      .prepare('DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?')
      .run(type, id)
    const document = this.document(type, id)
    if (!document) return
    this.db
      .prepare(
        'INSERT INTO search_index (entity_type, entity_id, project_id, title, body) VALUES (?, ?, ?, ?, ?)'
      )
      .run(type, id, document.projectId, document.title, document.body)
  }

  /**
   * Takes a record out of the index. A task takes its comments with it, so
   * call this before the task's row is deleted (its comments cascade).
   */
  removeEntity(type: IndexedEntityType, id: string): void {
    this.links.remove(type, id)
    if (!this.ftsAvailable) return
    if (type === 'task') {
      const comments = this.db
        .prepare('SELECT id FROM planning_comments WHERE work_item_id = ?')
        .all(id) as { id: string }[]
      const remove = this.db.prepare(
        "DELETE FROM search_index WHERE entity_type = 'comment' AND entity_id = ?"
      )
      for (const comment of comments) remove.run(comment.id)
    }
    this.db
      .prepare('DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?')
      .run(type, id)
  }

  /** The text a record is found by: the same columns the LIKE fallback reads. */
  private document(type: IndexedEntityType, id: string): IndexDocument | null {
    switch (type) {
      case 'task': {
        const row = this.db
          .prepare(
            'SELECT project_id, title, description, labels, acceptance_criteria FROM planning_work_items WHERE id = ?'
          )
          .get(id) as
          | {
              project_id: string
              title: string
              description: string
              labels: string
              acceptance_criteria: string
            }
          | undefined
        return row
          ? {
              projectId: row.project_id,
              title: row.title,
              body: lines(
                row.description,
                ...jsonList(row.acceptance_criteria),
                ...jsonList(row.labels),
                ...this.textFieldValues(id)
              )
            }
          : null
      }
      case 'goal': {
        const row = this.db
          .prepare('SELECT project_id, title, outcome FROM planning_goals WHERE id = ?')
          .get(id) as { project_id: string; title: string; outcome: string } | undefined
        return row ? { projectId: row.project_id, title: row.title, body: row.outcome } : null
      }
      case 'milestone': {
        const row = this.db
          .prepare(
            'SELECT project_id, name, outcome, success_criteria FROM planning_milestones WHERE id = ?'
          )
          .get(id) as
          | { project_id: string; name: string; outcome: string; success_criteria: string }
          | undefined
        return row
          ? {
              projectId: row.project_id,
              title: row.name,
              body: lines(row.outcome, ...jsonList(row.success_criteria))
            }
          : null
      }
      case 'decision': {
        const row = this.db
          .prepare(
            'SELECT project_id, title, context, decision, alternatives_considered, consequences FROM planning_decisions WHERE id = ?'
          )
          .get(id) as
          | {
              project_id: string
              title: string
              context: string
              decision: string
              alternatives_considered: string
              consequences: string
            }
          | undefined
        return row
          ? {
              projectId: row.project_id,
              title: row.title,
              body: lines(row.context, row.decision, row.alternatives_considered, row.consequences)
            }
          : null
      }
      case 'contact': {
        // Contacts (N6.5) belong to no project: '' in the index's project column.
        const row = this.db
          .prepare(
            'SELECT name, organisation, role, phones, emails, notes FROM contacts WHERE id = ?'
          )
          .get(id) as
          | {
              name: string
              organisation: string
              role: string
              phones: string
              emails: string
              notes: string
            }
          | undefined
        return row
          ? {
              projectId: '',
              title: row.name,
              body: lines(
                row.organisation,
                row.role,
                ...jsonList(row.emails),
                ...phoneNumbers(row.phones),
                row.notes
              )
            }
          : null
      }
      case 'comment': {
        // A deleted comment is not found; restoring it indexes it again.
        const row = this.db
          .prepare(
            'SELECT project_id, body FROM planning_comments WHERE id = ? AND deleted_at IS NULL'
          )
          .get(id) as { project_id: string; body: string } | undefined
        return row ? { projectId: row.project_id, title: '', body: row.body } : null
      }
    }
  }

  /** A task's Text custom field values (R2.2): found like its description. */
  private textFieldValues(workItemId: string): string[] {
    return (
      this.db
        .prepare(
          `SELECT v.text_value FROM planning_field_values v
           JOIN planning_fields f ON f.id = v.field_id
           WHERE v.work_item_id = ? AND f.type = 'text' AND v.text_value IS NOT NULL
           ORDER BY f.position`
        )
        .all(workItemId) as { text_value: string }[]
    ).map((row) => row.text_value)
  }

  // ─── Searching ────────────────────────────────────────────────────────────

  /**
   * Matches for `query`, best first: bm25 with the title weighted ten times
   * the body, so a title match ranks above a body match, and Library items
   * merged in by the same score. Archived and binned items are left out
   * unless asked for. Never throws on what a person typed.
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const terms = searchTerms(typeof query === 'string' ? query : '')
    if (terms.length === 0) return []
    const known = this.getProjectIds()
    const projectIds = options.projectId ? known.filter((id) => id === options.projectId) : known
    const types = (options.types?.length ? options.types : SEARCH_ENTITY_TYPES).filter((type) =>
      SEARCH_ENTITY_TYPES.includes(type)
    )
    // Contacts (N6.5) belong to no project: found only when no project is chosen.
    const withContacts = !options.projectId && types.includes('contact')
    if (projectIds.length === 0 && !withContacts) return []
    const limit = Math.min(Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT)), MAX_LIMIT)
    const includeArchived = options.includeArchived === true
    const planningTypes =
      projectIds.length === 0
        ? []
        : types.filter(
            (type): type is IndexedEntityType => type !== 'library' && type !== 'contact'
          )

    try {
      const results: SearchResult[] = []
      // A task's ID (N9.8a), "SHOP-12", "shop-12" or "shop 12": that task first.
      const byKey = types.includes('task')
        ? this.taskByKey(query, projectIds, includeArchived)
        : null
      if (withContacts) results.push(...this.searchContacts(terms, limit))
      if (planningTypes.length > 0)
        results.push(
          ...(this.ftsAvailable
            ? this.searchIndex(terms, projectIds, planningTypes, includeArchived, limit)
            : this.searchTables(terms, projectIds, planningTypes, includeArchived, limit))
        )
      if (types.includes('library') && projectIds.length > 0) {
        for (const entry of this.library.searchEntries(projectIds, query, {
          includeArchived,
          limit,
          open: OPEN,
          close: CLOSE
        })) {
          results.push({
            type: 'library',
            id: entry.itemId,
            projectId: entry.projectId,
            title: entry.title,
            snippet:
              entry.snippet === null ? likeSnippet(entry.text, terms) : toParts(entry.snippet),
            workItemId: null,
            ...(entry.location ? { location: entry.location } : {}),
            score: entry.score
          })
        }
      }
      const sorted = results
        .filter((result) => !(byKey && result.type === 'task' && result.id === byKey.id))
        .sort((a, b) => a.score - b.score)
      return this.withTaskKeys([...(byKey ? [byKey] : []), ...sorted].slice(0, limit))
    } catch (error) {
      console.error('Search failed:', error)
      throw new Error(t('errors:searchService.searchCouldntReadTry'))
    }
  }

  /**
   * Contacts (N6.5) matching the words, scored as the other types are: bm25
   * over the index, or the LIKE fallback's title-ten, body-one.
   */
  private searchContacts(terms: string[], limit: number): SearchResult[] {
    if (this.ftsAvailable) {
      const rows = this.db
        .prepare(
          `SELECT entity_id, title,
                  snippet(search_index, 4, ?, ?, '…', 16) AS body_snippet,
                  bm25(search_index, 0, 0, 0, 10.0, 1.0) AS score
           FROM search_index
           WHERE search_index MATCH ? AND entity_type = 'contact'
           ORDER BY score LIMIT ?`
        )
        .all(OPEN, CLOSE, ftsMatchExpression(terms), limit) as {
        entity_id: string
        title: string
        body_snippet: string
        score: number
      }[]
      return rows.map((row) => ({
        type: 'contact',
        id: row.entity_id,
        projectId: '',
        title: row.title,
        snippet: row.body_snippet.includes(OPEN) ? toParts(row.body_snippet) : [],
        workItemId: null,
        score: row.score
      }))
    }
    const results: SearchResult[] = []
    const ids = this.db.prepare('SELECT id FROM contacts').all() as { id: string }[]
    for (const { id } of ids) {
      const document = this.document('contact', id)
      if (!document) continue
      const score = likeScore(document, terms)
      if (score === null) continue
      results.push({
        type: 'contact',
        id,
        projectId: '',
        title: document.title,
        snippet: likeSnippet(document.body, terms),
        workItemId: null,
        score
      })
    }
    return results.sort((a, b) => a.score - b.score).slice(0, limit)
  }

  /** The visibility rule, one clause per type, over `search_index`'s row. */
  private visibleClause(includeArchived: boolean): string {
    const live = (alias: string) =>
      includeArchived ? '' : `AND ${alias}.archived_at IS NULL AND ${alias}.deleted_at IS NULL`
    const kept = (alias: string) => (includeArchived ? '' : `AND ${alias}.status <> 'archived'`)
    return `(
      (search_index.entity_type = 'task' AND EXISTS (
        SELECT 1 FROM planning_work_items w WHERE w.id = search_index.entity_id ${live('w')}))
      OR (search_index.entity_type = 'comment' AND EXISTS (
        SELECT 1 FROM planning_comments c JOIN planning_work_items w ON w.id = c.work_item_id
        WHERE c.id = search_index.entity_id AND c.deleted_at IS NULL ${live('w')}))
      OR (search_index.entity_type = 'goal' AND EXISTS (
        SELECT 1 FROM planning_goals g WHERE g.id = search_index.entity_id ${kept('g')}))
      OR (search_index.entity_type = 'milestone' AND EXISTS (
        SELECT 1 FROM planning_milestones m WHERE m.id = search_index.entity_id ${kept('m')}))
      OR (search_index.entity_type = 'decision' AND EXISTS (
        SELECT 1 FROM planning_decisions d WHERE d.id = search_index.entity_id))
    )`
  }

  private searchIndex(
    terms: string[],
    projectIds: string[],
    types: IndexedEntityType[],
    includeArchived: boolean,
    limit: number
  ): SearchResult[] {
    const rows = this.db
      .prepare(
        `SELECT entity_type, entity_id, project_id, title,
                snippet(search_index, 4, ?, ?, '…', 16) AS body_snippet,
                bm25(search_index, 0, 0, 0, 10.0, 1.0) AS score
         FROM search_index
         WHERE search_index MATCH ?
           AND project_id IN (${projectIds.map(() => '?').join(', ')})
           AND entity_type IN (${types.map(() => '?').join(', ')})
           AND ${this.visibleClause(includeArchived)}
         ORDER BY score LIMIT ?`
      )
      .all(OPEN, CLOSE, ftsMatchExpression(terms), ...projectIds, ...types, limit) as {
      entity_type: IndexedEntityType
      entity_id: string
      project_id: string
      title: string
      body_snippet: string
      score: number
    }[]
    return rows.map((row) => {
      const owner = this.owner(row.entity_type, row.entity_id)
      return {
        type: row.entity_type,
        id: row.entity_id,
        projectId: row.project_id,
        title: owner?.title ?? row.title,
        snippet: row.body_snippet.includes(OPEN) ? toParts(row.body_snippet) : [],
        workItemId: owner?.workItemId ?? null,
        ...(owner?.resolution ? { resolution: owner.resolution } : {}),
        score: row.score
      }
    })
  }

  /**
   * The task whose ID (N9.8a) is the whole query, in one of `projectIds`, as
   * a result that sorts before every other; null when the query is not an
   * ID, or no task visible here has it.
   */
  private taskByKey(
    query: string,
    projectIds: string[],
    includeArchived: boolean
  ): SearchResult | null {
    const parsed = parseTaskKey(query)
    if (!parsed) return null
    const projectId = projectIds.find((id) => this.getTaskPrefix(id) === parsed.prefix)
    if (!projectId) return null
    const row = this.db
      .prepare(
        `SELECT id, title, resolution, archived_at, deleted_at FROM planning_work_items
         WHERE project_id = ? AND number = ?`
      )
      .get(projectId, parsed.number) as
      | {
          id: string
          title: string
          resolution: PlanningResolution | null
          archived_at: number | null
          deleted_at: number | null
        }
      | undefined
    if (!row) return null
    if (!includeArchived && (row.archived_at !== null || row.deleted_at !== null)) return null
    return {
      type: 'task',
      id: row.id,
      projectId,
      title: row.title,
      snippet: [],
      workItemId: row.id,
      ...(row.resolution ? { resolution: row.resolution } : {}),
      score: Number.NEGATIVE_INFINITY
    }
  }

  /**
   * Each task result with its ID (N9.8a), so a list of results can show it,
   * and marked when it waits in To triage (N4.3a).
   */
  private withTaskKeys(results: SearchResult[]): SearchResult[] {
    const read = this.db.prepare(
      'SELECT number, in_triage, subproject_id FROM planning_work_items WHERE id = ?'
    )
    return results.map((result) => {
      if (result.type !== 'task') return result
      const row = read.get(result.id) as
        { number: number | null; in_triage: number; subproject_id: string | null } | undefined
      const key = taskKey(this.getTaskPrefix(result.projectId), row?.number)
      return {
        ...result,
        ...(key ? { key } : {}),
        ...(row?.subproject_id ? { subprojectId: row.subproject_id } : {}),
        ...(row?.in_triage ? { inTriage: true as const } : {})
      }
    })
  }

  /** The task a task or comment opens in, and the title a comment is shown under. */
  private owner(
    type: IndexedEntityType,
    id: string
  ): { workItemId: string; title: string; resolution?: PlanningResolution } | null {
    if (type === 'task') {
      const row = this.db
        .prepare('SELECT title, resolution FROM planning_work_items WHERE id = ?')
        .get(id) as { title: string; resolution: PlanningResolution | null } | undefined
      if (!row) return null
      // A won't-do task (N1.2) is still a record: found, and marked.
      return row.resolution
        ? { workItemId: id, title: row.title, resolution: row.resolution }
        : { workItemId: id, title: row.title }
    }
    if (type === 'comment') {
      const row = this.db
        .prepare(
          `SELECT w.id AS id, w.title AS title FROM planning_comments c
           JOIN planning_work_items w ON w.id = c.work_item_id WHERE c.id = ?`
        )
        .get(id) as { id: string; title: string } | undefined
      return row ? { workItemId: row.id, title: row.title } : null
    }
    return null
  }

  /**
   * The LIKE fallback: the same records, the same visibility and the same
   * text as the index (`document`), every term somewhere in the title or the
   * body. Scored like bm25's weights: a title hit counts ten, a body hit one.
   */
  private searchTables(
    terms: string[],
    projectIds: string[],
    types: IndexedEntityType[],
    includeArchived: boolean,
    limit: number
  ): SearchResult[] {
    const inProjects = `project_id IN (${projectIds.map(() => '?').join(', ')})`
    const live = includeArchived ? '' : 'AND archived_at IS NULL AND deleted_at IS NULL'
    const kept = includeArchived ? '' : "AND status <> 'archived'"
    const sources: Record<IndexedEntityType, string> = {
      task: `SELECT id FROM planning_work_items WHERE ${inProjects} ${live}`,
      goal: `SELECT id FROM planning_goals WHERE ${inProjects} ${kept}`,
      milestone: `SELECT id FROM planning_milestones WHERE ${inProjects} ${kept}`,
      decision: `SELECT id FROM planning_decisions WHERE ${inProjects}`,
      comment: `SELECT c.id FROM planning_comments c JOIN planning_work_items w ON w.id = c.work_item_id
                WHERE c.${inProjects} AND c.deleted_at IS NULL
                ${includeArchived ? '' : 'AND w.archived_at IS NULL AND w.deleted_at IS NULL'}`,
      // Searched on their own (`searchContacts`), never here.
      contact: 'SELECT id FROM contacts WHERE 0'
    }
    // A coarse SQL pass narrows the candidates; `document` decides.
    const results: SearchResult[] = []
    for (const type of types) {
      const ids = this.db.prepare(sources[type]).all(...projectIds) as { id: string }[]
      for (const { id } of ids) {
        const document = this.document(type, id)
        if (!document) continue
        const title = document.title.toLowerCase()
        const body = document.body.toLowerCase()
        let score = 0
        let all = true
        for (const term of terms.map((value) => value.toLowerCase())) {
          const inTitle = title.includes(term)
          const inBody = body.includes(term)
          if (!inTitle && !inBody) {
            all = false
            break
          }
          score -= (inTitle ? 10 : 0) + (inBody ? 1 : 0)
        }
        if (!all) continue
        const owner = this.owner(type, id)
        results.push({
          type,
          id,
          projectId: document.projectId,
          title: owner?.title ?? document.title,
          snippet: likeSnippet(document.body, terms),
          workItemId: owner?.workItemId ?? null,
          ...(owner?.resolution ? { resolution: owner.resolution } : {}),
          score
        })
      }
    }
    return results.sort((a, b) => a.score - b.score).slice(0, limit)
  }
}

/** The LIKE fallback's score: every term in the title (ten) or the body (one); null when one is missing. */
function likeScore(document: IndexDocument, terms: string[]): number | null {
  const title = document.title.toLowerCase()
  const body = document.body.toLowerCase()
  let score = 0
  for (const term of terms.map((value) => value.toLowerCase())) {
    const inTitle = title.includes(term)
    const inBody = body.includes(term)
    if (!inTitle && !inBody) return null
    score -= (inTitle ? 10 : 0) + (inBody ? 1 : 0)
  }
  return score
}

/** FTS5's marked snippet as parts. */
function toParts(marked: string): SearchSnippetPart[] {
  const parts: SearchSnippetPart[] = []
  let rest = marked
  while (rest) {
    const start = rest.indexOf(OPEN)
    if (start === -1) {
      parts.push({ text: rest, match: false })
      break
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), match: false })
    const end = rest.indexOf(CLOSE, start)
    const stop = end === -1 ? rest.length : end
    parts.push({ text: rest.slice(start + 1, stop), match: true })
    rest = end === -1 ? '' : rest.slice(end + 1)
  }
  return parts.filter((part) => part.text !== '')
}

/**
 * A snippet made outside SQLite: the text around the first match, every
 * term's occurrences marked. Empty when no term is in the text.
 */
export function likeSnippet(text: string, terms: string[]): SearchSnippetPart[] {
  const flat = text.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  const needles = terms.map((term) => term.toLowerCase()).filter(Boolean)
  const first = Math.min(
    ...needles.map((needle) => lower.indexOf(needle)).filter((index) => index >= 0)
  )
  if (!Number.isFinite(first)) return []
  const from = Math.max(0, first - SNIPPET_RADIUS)
  const to = Math.min(flat.length, first + SNIPPET_RADIUS * 2)
  const window = flat.slice(from, to)
  const windowLower = window.toLowerCase()
  const parts: SearchSnippetPart[] = []
  if (from > 0) parts.push({ text: '…', match: false })
  let at = 0
  while (at < window.length) {
    let next = -1
    let length = 0
    for (const needle of needles) {
      const index = windowLower.indexOf(needle, at)
      if (index !== -1 && (next === -1 || index < next)) {
        next = index
        length = needle.length
      }
    }
    if (next === -1) {
      parts.push({ text: window.slice(at), match: false })
      break
    }
    if (next > at) parts.push({ text: window.slice(at, next), match: false })
    parts.push({ text: window.slice(next, next + length), match: true })
    at = next + length
  }
  if (to < flat.length) parts.push({ text: '…', match: false })
  return parts
}
