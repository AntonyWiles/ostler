import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { Migration } from './types'

/**
 * P5.7, search and saved views:
 *
 * - `search_index`, an FTS5 table of tasks, goals, milestones, decisions and
 *   comments, kept by `SearchService` at each entity's write point. Like
 *   `library_search`, it exists only where SQLite has FTS5; without it search
 *   falls back to LIKE over the planning tables. Backfilled here.
 * - `saved_views`: a view type and its configuration. `is_default` marks the
 *   one view per project and view type that holds what the view opens with.
 * - Board presets are copied in as board views. Migration 7 drops their table.
 *
 * Self-contained on purpose: a migration must not change when the code it
 * would import does, so the document text is built here as `SearchService`
 * built it when this shipped.
 */
export const searchAndSavedViews: Migration = {
  version: 6,
  name: 'search-and-saved-views',
  up(db) {
    db.exec(`
      CREATE TABLE saved_views (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT NOT NULL,
        view_type TEXT NOT NULL,
        config TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_saved_views_project ON saved_views(project_id, view_type, position);
      CREATE UNIQUE INDEX idx_saved_views_default
        ON saved_views(project_id, view_type) WHERE is_default = 1;
    `)
    copyBoardPresets(db)
    try {
      db.exec(`
        CREATE VIRTUAL TABLE search_index USING fts5(
          entity_type UNINDEXED,
          entity_id UNINDEXED,
          project_id UNINDEXED,
          title,
          body
        );
      `)
    } catch (error) {
      console.warn('Full-text search unavailable; search falls back to LIKE:', error)
      return
    }
    backfillSearchIndex(db)
  }
}

interface PresetRow {
  id: string
  project_id: string
  name: string
  criteria: string
  created_at: number
  updated_at: number
}

/** A preset's { query, priority, milestoneId } as a board view's filter and search text. */
function presetConfig(criteria: string): string {
  let parsed: { query?: unknown; priority?: unknown; milestoneId?: unknown } = {}
  try {
    parsed = JSON.parse(criteria) as typeof parsed
  } catch {
    // An unreadable preset keeps its name with no filter.
  }
  const conditions: { field: string; op: string; value: string[] }[] = []
  if (typeof parsed.priority === 'string' && parsed.priority !== 'all')
    conditions.push({ field: 'priority', op: 'is', value: [parsed.priority] })
  if (typeof parsed.milestoneId === 'string' && parsed.milestoneId && parsed.milestoneId !== 'all')
    conditions.push({ field: 'milestone', op: 'is', value: [parsed.milestoneId] })
  return JSON.stringify({
    filter: { match: 'all', conditions },
    query: typeof parsed.query === 'string' ? parsed.query : '',
    options: {}
  })
}

function copyBoardPresets(db: Database.Database): void {
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'planning_board_presets'")
    .get()
  if (!exists) return
  const rows = db
    .prepare('SELECT * FROM planning_board_presets ORDER BY project_id, updated_at DESC')
    .all() as PresetRow[]
  const insert = db.prepare(
    `INSERT INTO saved_views
       (id, project_id, name, view_type, config, position, is_default, created_at, updated_at)
     VALUES (?, ?, ?, 'board', ?, ?, 0, ?, ?)`
  )
  const positions = new Map<string, number>()
  for (const row of rows) {
    const position = positions.get(row.project_id) ?? 0
    positions.set(row.project_id, position + 1)
    insert.run(
      uuidv4(),
      row.project_id,
      row.name,
      presetConfig(row.criteria),
      position,
      row.created_at,
      row.updated_at
    )
  }
}

function list(json: string): string[] {
  try {
    const value = JSON.parse(json) as unknown
    return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

const lines = (...parts: string[]) => parts.filter((part) => part.trim() !== '').join('\n')

function backfillSearchIndex(db: Database.Database): void {
  const insert = db.prepare(
    'INSERT INTO search_index (entity_type, entity_id, project_id, title, body) VALUES (?, ?, ?, ?, ?)'
  )
  for (const row of db
    .prepare(
      'SELECT id, project_id, title, description, labels, acceptance_criteria FROM planning_work_items'
    )
    .all() as {
    id: string
    project_id: string
    title: string
    description: string
    labels: string
    acceptance_criteria: string
  }[])
    insert.run(
      'task',
      row.id,
      row.project_id,
      row.title,
      lines(row.description, ...list(row.acceptance_criteria), ...list(row.labels))
    )
  for (const row of db
    .prepare('SELECT id, project_id, title, outcome FROM planning_goals')
    .all() as {
    id: string
    project_id: string
    title: string
    outcome: string
  }[])
    insert.run('goal', row.id, row.project_id, row.title, row.outcome)
  for (const row of db
    .prepare('SELECT id, project_id, name, outcome, success_criteria FROM planning_milestones')
    .all() as {
    id: string
    project_id: string
    name: string
    outcome: string
    success_criteria: string
  }[])
    insert.run(
      'milestone',
      row.id,
      row.project_id,
      row.name,
      lines(row.outcome, ...list(row.success_criteria))
    )
  for (const row of db
    .prepare(
      'SELECT id, project_id, title, context, decision, alternatives_considered, consequences FROM planning_decisions'
    )
    .all() as {
    id: string
    project_id: string
    title: string
    context: string
    decision: string
    alternatives_considered: string
    consequences: string
  }[])
    insert.run(
      'decision',
      row.id,
      row.project_id,
      row.title,
      lines(row.context, row.decision, row.alternatives_considered, row.consequences)
    )
  for (const row of db
    .prepare('SELECT id, project_id, body FROM planning_comments WHERE deleted_at IS NULL')
    .all() as { id: string; project_id: string; body: string }[])
    insert.run('comment', row.id, row.project_id, '', row.body)
}
