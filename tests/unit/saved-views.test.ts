import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  migrateOstlerDatabase
} from '../../electron/services/database/migrations'
import { createMigratedDatabase } from '../helpers/database'

const OVERDUE = {
  filter: { match: 'all', conditions: [{ field: 'due', op: 'is', value: 'overdue' }] },
  query: '',
  options: { groupBy: 'status' }
} as const

describe('SavedViewsService', () => {
  let tempDir: string
  let databasePath: string
  let service: PlanningService
  const projectIds = ['project-one', 'project-two']

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-views-'))
    databasePath = await createMigratedDatabase(tempDir)
    service = new PlanningService(databasePath, () => projectIds)
  })

  afterEach(() => {
    service.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates, lists, renames, changes, deletes and restores views per project', () => {
    const views = service.views
    const overdue = views.create('project-one', {
      name: '  Overdue ',
      viewType: 'list',
      config: OVERDUE as never
    })
    const mine = views.create('project-one', {
      name: 'Mine',
      viewType: 'list',
      config: { filter: { match: 'all', conditions: [] }, query: 'logo', options: {} }
    })
    views.create('project-two', { name: 'Elsewhere', viewType: 'board', config: {} as never })
    expect(overdue).toMatchObject({ name: 'Overdue', position: 0, isDefault: false })
    expect(mine.position).toBe(1)

    service.close()
    service = new PlanningService(databasePath, () => projectIds)
    const again = service.views
    expect(again.list('project-one').map((view) => view.name)).toEqual(['Overdue', 'Mine'])
    expect(again.list('project-one', 'board')).toEqual([])
    expect(again.list().map((view) => view.name)).toEqual(['Overdue', 'Mine', 'Elsewhere'])

    const renamed = again.update(overdue.id, { name: 'Late' })
    expect(renamed.name).toBe('Late')
    expect(renamed.config).toEqual(OVERDUE)
    const changed = again.update(overdue.id, {
      config: { ...OVERDUE, query: 'invoice' } as never
    })
    expect(changed.config.query).toBe('invoice')

    const deleted = again.delete(overdue.id)
    expect(again.list('project-one').map((view) => view.id)).toEqual([mine.id])
    expect(again.restore(deleted).id).toBe(overdue.id)
    expect(again.list('project-one').map((view) => view.name)).toEqual(['Late', 'Mine'])
  })

  it('keeps a filter on a custom field (R2.2)', () => {
    const config = {
      filter: {
        match: 'all',
        conditions: [
          { field: 'custom', fieldId: 'field-1', op: 'between', value: [1, 5] },
          { field: 'custom', fieldId: 'field-2', op: 'is', value: ['option-a'] }
        ]
      },
      query: '',
      options: { groupBy: 'field:field-2', sort: [{ columnId: 'field:field-1', direction: 'asc' }] }
    }
    const view = service.views.create('project-one', {
      name: 'By room',
      viewType: 'list',
      config: config as never
    })
    service.close()
    service = new PlanningService(databasePath, () => projectIds)
    expect(service.views.list('project-one').find((v) => v.id === view.id)?.config).toEqual(config)
  })

  it('refuses bad input with plain messages', () => {
    const views = service.views
    expect(() =>
      views.create('project-one', { name: '', viewType: 'list', config: {} as never })
    ).toThrow('needs a name')
    expect(() =>
      views.create('project-one', { name: 'X', viewType: 'gantt' as never, config: {} as never })
    ).toThrow('board, list, calendar, timeline')
    expect(() =>
      views.create('project-one', {
        name: 'X',
        viewType: 'list',
        config: { filter: { conditions: [{ field: 'due', op: 'is', value: 'soon' }] } } as never
      })
    ).toThrow('Filter condition 1')
    expect(() =>
      views.create('unknown', { name: 'X', viewType: 'list', config: {} as never })
    ).toThrow('Project not found')
  })

  it('keeps one default view per project and type, which cannot be renamed or deleted', () => {
    const views = service.views
    expect(views.getDefault('project-one', 'timeline')).toBeNull()
    const first = views.setDefault('project-one', 'timeline', {
      filter: { match: 'all', conditions: [] },
      query: '',
      options: { zoom: 'week' }
    })
    const second = views.setDefault('project-one', 'timeline', {
      filter: { match: 'all', conditions: [] },
      query: '',
      options: { zoom: 'quarter' }
    })
    expect(second.id).toBe(first.id)
    expect(views.getDefault('project-one', 'timeline')?.config.options).toEqual({
      zoom: 'quarter'
    })
    expect(views.getDefault('project-two', 'timeline')).toBeNull()
    // Defaults are not offered as named views across projects.
    expect(views.list()).toEqual([])
    expect(() => views.update(first.id, { name: 'Mine' })).toThrow('keeps its name')
    expect(() => views.delete(first.id)).toThrow("can't be deleted")

    // "Set as default for this project" copies a saved view's configuration.
    const saved = views.create('project-one', {
      name: 'Overdue',
      viewType: 'timeline',
      config: OVERDUE as never
    })
    views.setDefault('project-one', 'timeline', saved.config)
    expect(views.getDefault('project-one', 'timeline')?.config).toEqual(OVERDUE)
    expect(views.get(saved.id).isDefault).toBe(false)
  })

  it('keeps views and a default for all projects apart from every project', () => {
    const views = service.views
    const shared = views.create(null, { name: 'Mine', viewType: 'board', config: OVERDUE as never })
    const second = views.create(null, { name: 'Late', viewType: 'board', config: {} as never })
    views.create('project-one', { name: 'Own', viewType: 'board', config: {} as never })
    expect(shared).toMatchObject({ projectId: null, position: 0 })
    expect(second.position).toBe(1)
    expect(views.listShared('board').map((view) => view.name)).toEqual(['Mine', 'Late'])
    expect(views.listShared('list')).toEqual([])
    // A project's list, and the every-project list (the command palette), leave them out.
    expect(views.list('project-one').map((view) => view.name)).toEqual(['Own'])
    expect(views.list().map((view) => view.name)).toEqual(['Own'])

    expect(views.getDefault(null, 'board')).toBeNull()
    views.setDefault(null, 'board', OVERDUE as never)
    views.setDefault(null, 'board', { ...OVERDUE, query: 'x' } as never)
    expect(views.getDefault(null, 'board')?.config.query).toBe('x')
    expect(views.getDefault('project-one', 'board')).toBeNull()
    expect(views.listShared('board')).toHaveLength(2)

    const removed = views.delete(shared.id)
    expect(views.restore(removed).projectId).toBeNull()
    expect(views.listShared('board')).toHaveLength(2)
  })

  it('resets a default: a project follows all projects, and all projects the standard', () => {
    const views = service.views
    views.setDefault('project-one', 'board', OVERDUE as never)
    views.setDefault(null, 'board', OVERDUE as never)
    expect(views.clearDefault('project-one', 'board')?.isDefault).toBe(true)
    expect(views.getDefault('project-one', 'board')).toBeNull()
    expect(views.clearDefault('project-one', 'board')).toBeNull()
    expect(views.getDefault(null, 'board')).not.toBeNull()
    views.clearDefault(null, 'board')
    expect(views.getDefault(null, 'board')).toBeNull()
    expect(() => views.clearDefault('nowhere', 'board')).toThrow('Project not found')
  })

  it('goes with its project when the project is removed (project_id column)', () => {
    const db = new Database(databasePath, { readonly: true })
    try {
      const columns = db.prepare('PRAGMA table_info(saved_views)').all() as { name: string }[]
      expect(columns.map((column) => column.name)).toContain('project_id')
      const index = db.prepare('PRAGMA table_info(search_index)').all() as { name: string }[]
      expect(index.map((column) => column.name)).toContain('project_id')
    } finally {
      db.close()
    }
  })
})

describe('board presets to saved views (migrations 6 and 7)', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-views-migration-'))
    dbPath = path.join(tempDir, 'ostler.db')
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const migrate = (upTo?: number) =>
    migrateOstlerDatabase(
      dbPath,
      { backupDir: path.join(tempDir, 'backups'), appVersion: '9.9.9' },
      upTo === undefined ? MIGRATIONS : MIGRATIONS.filter((migration) => migration.version <= upTo)
    )

  it('copies every preset into a board view, indexes existing work, and drops the old table', async () => {
    // A pre-P5.7 database, as P5.6 left it, with presets the old UI saved.
    await migrate(5)
    const before = new Database(dbPath)
    before.exec(`
      INSERT INTO planning_board_presets (id, project_id, name, criteria, created_at, updated_at) VALUES
        ('p1', 'proj', 'Critical release', '{"query":"release","priority":"critical","milestoneId":"m1"}', 1, 30),
        ('p2', 'proj', 'Unplanned', '{"query":"","priority":"all","milestoneId":"none"}', 2, 20),
        ('p3', 'proj', 'Everything', '{"query":"","priority":"all","milestoneId":"all"}', 3, 10),
        ('p4', 'other', 'Broken', 'not json', 4, 5);
      INSERT INTO planning_work_items (id, project_id, title, description, status, priority, origin, created_at, updated_at)
        VALUES ('t1', 'proj', 'Pick a palette', 'Teal and sand', 'ready', 'high', 'human', 1, 2);
      INSERT INTO planning_comments (id, project_id, work_item_id, author_kind, body, created_at, updated_at)
        VALUES ('c1', 'proj', 't1', 'human', 'We agreed the colour scheme', 3, 3),
               ('c2', 'proj', 't1', 'human', 'A deleted colour remark', 4, 4);
      UPDATE planning_comments SET deleted_at = 5 WHERE id = 'c2';
      INSERT INTO planning_decisions (id, project_id, title, context, decision, alternatives_considered,
        consequences, date, linked_work_item_ids, origin, created_at, updated_at)
        VALUES ('d1', 'proj', 'Palette', '', 'Teal colour scheme', '', '', '2026-10-01', '[]', 'human', 1, 1);
    `)
    before.close()

    const result = await migrate()
    expect(result).toMatchObject({ from: 5, to: LATEST_SCHEMA_VERSION })
    expect(result.backupPath).not.toBeNull()

    const db = new Database(dbPath, { readonly: true })
    try {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'planning_board_presets'").get()
      ).toBeUndefined()
      const views = (
        db.prepare('SELECT * FROM saved_views ORDER BY project_id, position').all() as {
          project_id: string
          name: string
          view_type: string
          config: string
          position: number
          is_default: number
        }[]
      ).map((row) => ({ ...row, config: JSON.parse(row.config) }))
      expect(views.map((view) => [view.project_id, view.name, view.position])).toEqual([
        ['other', 'Broken', 0],
        ['proj', 'Critical release', 0],
        ['proj', 'Unplanned', 1],
        ['proj', 'Everything', 2]
      ])
      expect(views.every((view) => view.view_type === 'board' && view.is_default === 0)).toBe(true)
      expect(views[1].config).toEqual({
        filter: {
          match: 'all',
          conditions: [
            { field: 'priority', op: 'is', value: ['critical'] },
            { field: 'milestone', op: 'is', value: ['m1'] }
          ]
        },
        query: 'release',
        options: {}
      })
      expect(views[2].config.filter.conditions).toEqual([
        { field: 'milestone', op: 'is', value: ['none'] }
      ])
      expect(views[3].config.filter.conditions).toEqual([])
      expect(views[0].config).toEqual({
        filter: { match: 'all', conditions: [] },
        query: '',
        options: {}
      })

      const indexed = db
        .prepare('SELECT entity_type, entity_id FROM search_index ORDER BY entity_type, entity_id')
        .all()
      expect(indexed).toEqual([
        { entity_type: 'comment', entity_id: 'c1' },
        { entity_type: 'decision', entity_id: 'd1' },
        { entity_type: 'task', entity_id: 't1' }
      ])
    } finally {
      db.close()
    }

    // The copied views read back through the service like any other.
    const planning = new PlanningService(dbPath, () => ['proj', 'other'])
    try {
      expect(planning.views.list('proj', 'board').map((view) => view.name)).toEqual([
        'Critical release',
        'Unplanned',
        'Everything'
      ])
      expect(
        planning.search
          .search('colour')
          .map((hit) => hit.id)
          .sort()
      ).toEqual(['c1', 'd1'])
    } finally {
      planning.close()
    }
  })
})
