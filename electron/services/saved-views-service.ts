import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  CreateSavedViewInput,
  SavedView,
  SavedViewConfig,
  SavedViewType,
  UpdateSavedViewInput
} from '@shared/ostler-api'
import {
  DEFAULT_VIEW_NAME,
  parseSavedViewConfig,
  parseSavedViewName,
  parseSavedViewType
} from '@shared/saved-views'
import { t } from '@shared/i18n'

interface SavedViewRow {
  id: string
  project_id: string | null
  name: string
  view_type: SavedViewType
  config: string
  position: number
  is_default: number
  created_at: number
  updated_at: number
}

export { DEFAULT_VIEW_NAME }

/**
 * Saved views (P5.7): a Board, List, Calendar or Timeline with its filter,
 * search text and options, per project. One view per project and type is the
 * default: what that view opens with, kept as the person changes it. The
 * desktop app and the automation API both write through here, so both are
 * checked the same way.
 *
 * A view with no project (`projectId` null) is for all projects: a named one
 * is offered in every project's Views, and the default one is what a project
 * opens with until it keeps a default of its own (the Board's Customise
 * board). The automation API stays per project and never sees them.
 */
export class SavedViewsService {
  constructor(
    private readonly db: Database.Database,
    private readonly getProjectIds: () => string[]
  ) {}

  private requireProject(projectId: string): void {
    if (typeof projectId !== 'string' || !this.getProjectIds().includes(projectId))
      throw new Error('Project not found')
  }

  /** A project, or null for all projects. */
  private requireOwner(projectId: string | null): void {
    if (projectId !== null) this.requireProject(projectId)
  }

  /** The named views for all projects, in order, of one type or every type. */
  listShared(viewType?: SavedViewType): SavedView[] {
    const params: unknown[] = []
    let where = 'project_id IS NULL AND is_default = 0'
    if (viewType !== undefined) {
      where += ' AND view_type = ?'
      params.push(parseSavedViewType(viewType))
    }
    const rows = this.db
      .prepare(`SELECT * FROM saved_views WHERE ${where} ORDER BY view_type, position, created_at`)
      .all(...params) as SavedViewRow[]
    return rows.map(toView)
  }

  /**
   * A project's views, in order: each type's default first, then the named
   * views by position. With no project, every project's named views (for the
   * command palette).
   */
  list(projectId?: string, viewType?: SavedViewType): SavedView[] {
    const where: string[] = []
    const params: unknown[] = []
    if (projectId !== undefined) {
      this.requireProject(projectId)
      where.push('project_id = ?')
      params.push(projectId)
    } else {
      const ids = this.getProjectIds()
      if (ids.length === 0) return []
      where.push(`project_id IN (${ids.map(() => '?').join(', ')})`, 'is_default = 0')
      params.push(...ids)
    }
    if (viewType !== undefined) {
      where.push('view_type = ?')
      params.push(parseSavedViewType(viewType))
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM saved_views WHERE ${where.join(' AND ')}
         ORDER BY project_id, view_type, is_default DESC, position, created_at`
      )
      .all(...params) as SavedViewRow[]
    return rows.map(toView)
  }

  get(viewId: string): SavedView {
    const row = this.db.prepare('SELECT * FROM saved_views WHERE id = ?').get(viewId) as
      SavedViewRow | undefined
    if (!row || (row.project_id !== null && !this.getProjectIds().includes(row.project_id)))
      throw new Error('Saved view not found')
    return toView(row)
  }

  /** A named view in a project, or for all projects (null). */
  create(projectId: string | null, input: CreateSavedViewInput): SavedView {
    this.requireOwner(projectId)
    if (!input || typeof input !== 'object') throw new Error('Send { name, viewType, config }')
    const viewType = parseSavedViewType(input.viewType)
    const name = parseSavedViewName(input.name)
    const config = parseSavedViewConfig(input.config)
    const now = Date.now()
    const { next } = this.db
      .prepare(
        `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM saved_views
         WHERE project_id IS ? AND view_type = ? AND is_default = 0`
      )
      .get(projectId, viewType) as { next: number }
    const view: SavedView = {
      id: uuidv4(),
      projectId,
      name,
      viewType,
      config,
      position: next,
      isDefault: false,
      createdAt: now,
      updatedAt: now
    }
    this.insert(view)
    return view
  }

  update(viewId: string, updates: UpdateSavedViewInput): SavedView {
    const current = this.get(viewId)
    if (!updates || typeof updates !== 'object')
      throw new Error('Send { name?, config?, position? }')
    if (current.isDefault && updates.name !== undefined)
      throw new Error(t('errors:savedViewsService.defaultViewKeepsName'))
    let position = current.position
    if (updates.position !== undefined) {
      if (!Number.isInteger(updates.position) || updates.position < 0)
        throw new Error('A position must be a whole number, 0 or more')
      position = updates.position
    }
    const view: SavedView = {
      ...current,
      name: updates.name === undefined ? current.name : parseSavedViewName(updates.name),
      config: updates.config === undefined ? current.config : parseSavedViewConfig(updates.config),
      position,
      updatedAt: Date.now()
    }
    this.db
      .prepare(
        'UPDATE saved_views SET name = ?, config = ?, position = ?, updated_at = ? WHERE id = ?'
      )
      .run(view.name, JSON.stringify(view.config), view.position, view.updatedAt, view.id)
    return view
  }

  /** Returns what it removed, so the desktop app can offer undo (`restore`). */
  delete(viewId: string): SavedView {
    const view = this.get(viewId)
    if (view.isDefault)
      throw new Error("The default view can't be deleted; change it or set another view as default")
    this.db.prepare('DELETE FROM saved_views WHERE id = ?').run(viewId)
    return view
  }

  /** Puts a deleted view back as it was, with its id. */
  restore(view: SavedView): SavedView {
    if (!view || typeof view !== 'object' || typeof view.id !== 'string')
      throw new Error(t('errors:savedViewsService.nothingRestore'))
    if (view.projectId !== null && typeof view.projectId !== 'string')
      throw new Error('Nothing to restore')
    this.requireOwner(view.projectId)
    const exists = this.db.prepare('SELECT 1 FROM saved_views WHERE id = ?').get(view.id)
    if (exists) return this.get(view.id)
    const restored: SavedView = {
      id: view.id,
      projectId: view.projectId,
      name: parseSavedViewName(view.name),
      viewType: parseSavedViewType(view.viewType),
      config: parseSavedViewConfig(view.config),
      position: Number.isInteger(view.position) && view.position >= 0 ? view.position : 0,
      isDefault: false,
      createdAt: Number.isFinite(view.createdAt) ? view.createdAt : Date.now(),
      updatedAt: Date.now()
    }
    this.insert(restored)
    return restored
  }

  /**
   * The view a project's Board, List, Calendar or Timeline opens with, if one
   * was kept; with null, the default for all projects.
   */
  getDefault(projectId: string | null, viewType: SavedViewType): SavedView | null {
    this.requireOwner(projectId)
    const row = this.db
      .prepare(
        'SELECT * FROM saved_views WHERE project_id IS ? AND view_type = ? AND is_default = 1'
      )
      .get(projectId, parseSavedViewType(viewType)) as SavedViewRow | undefined
    return row ? toView(row) : null
  }

  /**
   * Writes the default view's configuration, creating it the first time:
   * where a view keeps its state as it changes, and what "Set as default for
   * this project" copies a saved view into.
   */
  setDefault(
    projectId: string | null,
    viewType: SavedViewType,
    config: SavedViewConfig
  ): SavedView {
    const current = this.getDefault(projectId, viewType)
    if (current) return this.update(current.id, { config })
    const now = Date.now()
    const view: SavedView = {
      id: uuidv4(),
      projectId,
      name: DEFAULT_VIEW_NAME,
      viewType: parseSavedViewType(viewType),
      config: parseSavedViewConfig(config),
      position: 0,
      isDefault: true,
      createdAt: now,
      updatedAt: now
    }
    this.insert(view)
    return view
  }

  /**
   * Removes a default view ("Reset to default"): a project's then opens with
   * the default for all projects, and that one with the standard settings.
   * Returns what it removed, or null when there was none.
   */
  clearDefault(projectId: string | null, viewType: SavedViewType): SavedView | null {
    const current = this.getDefault(projectId, viewType)
    if (current) this.db.prepare('DELETE FROM saved_views WHERE id = ?').run(current.id)
    return current
  }

  private insert(view: SavedView): void {
    this.db
      .prepare(
        `INSERT INTO saved_views
           (id, project_id, name, view_type, config, position, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        view.id,
        view.projectId,
        view.name,
        view.viewType,
        JSON.stringify(view.config),
        view.position,
        view.isDefault ? 1 : 0,
        view.createdAt,
        view.updatedAt
      )
  }
}

function toView(row: SavedViewRow): SavedView {
  let config: SavedViewConfig
  try {
    config = parseSavedViewConfig(JSON.parse(row.config))
  } catch {
    config = parseSavedViewConfig({})
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    viewType: row.view_type,
    config,
    position: row.position,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
