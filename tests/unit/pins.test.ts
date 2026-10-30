import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { LibraryService } from '../../electron/services/library-service'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import { MIGRATIONS, migrateOstlerDatabase } from '../../electron/services/database/migrations'
import { createMigratedDatabase } from '../helpers/database'
import { PIN_SIDEBAR_MAX } from '../../src/shared/ostler-api'

const P1 = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P2 = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'
const human = { kind: 'human' as const }

describe('pins (N5.2a)', () => {
  let tempDir: string
  let dbPath: string
  let planning: PlanningService
  let library: LibraryService
  let projects: string[]

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-pins-'))
    dbPath = await createMigratedDatabase(tempDir)
    projects = [P1, P2]
    planning = new PlanningService(dbPath, () => projects)
    library = new LibraryService(dbPath, tempDir)
  })

  afterEach(() => {
    planning.close()
    library.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const task = (title: string, projectId = P1) =>
    planning.createWorkItem(projectId, { title }, human)
  const pins = () => planning.pins

  it('pins every kind with its current title, and lists the sidebar in order', () => {
    const t1 = task('Fix the header')
    const milestone = planning.createMilestone(P1, { name: 'Launch' })
    const decision = planning.createDecision(P1, { title: 'Use the new supplier', decision: 'Yes' })
    const link = library.createItem(P1, {
      kind: 'link',
      title: 'Shop admin',
      url: 'https://shop.example.com/admin'
    })
    const view = planning.views.create(P1, {
      name: 'Blocked',
      viewType: 'list',
      config: { filter: { match: 'all', conditions: [] }, query: '', options: {} }
    })
    pins().create({ place: 'sidebar', kind: 'task', targetId: t1.id })
    pins().create({ place: 'sidebar', kind: 'milestone', targetId: milestone.id })
    pins().create({ place: 'sidebar', kind: 'decision', targetId: decision.id })
    pins().create({ place: 'sidebar', kind: 'library', targetId: link.id })
    pins().create({ place: 'sidebar', kind: 'saved-view', targetId: view.id })
    pins().create({ place: 'sidebar', kind: 'project-view', targetId: 'board', projectId: P1 })

    const listed = pins().list({ place: 'sidebar' })
    expect(listed.map((pin) => [pin.kind, pin.title, pin.exists])).toEqual([
      ['task', 'Fix the header', true],
      ['milestone', 'Launch', true],
      ['decision', 'Use the new supplier', true],
      ['library', 'Shop admin', true],
      ['saved-view', 'Blocked', true],
      ['project-view', null, true]
    ])
    expect(listed[3]).toMatchObject({ libraryKind: 'link', url: 'https://shop.example.com/admin' })
    expect(listed[4]).toMatchObject({ viewType: 'list' })
    expect(listed[0]).toMatchObject({ status: t1.status, projectId: P1 })

    // Titles are read when listed, never stored.
    planning.updateWorkItem(t1.id, { title: 'Fix the footer' }, human)
    expect(pins().list({ place: 'sidebar' })[0].title).toBe('Fix the footer')
  })

  it('keeps one pin per place and target', () => {
    const t1 = task('One')
    const first = pins().create({ place: 'sidebar', kind: 'task', targetId: t1.id })
    const again = pins().create({ place: 'sidebar', kind: 'task', targetId: t1.id })
    expect(again.id).toBe(first.id)
    const overview = pins().create({ place: 'overview', kind: 'task', targetId: t1.id })
    expect(overview.id).not.toBe(first.id)
    expect(pins().list({ place: 'sidebar' })).toHaveLength(1)
    expect(pins().list({ place: 'overview', projectId: P1 })).toHaveLength(1)
    expect(pins().list({ place: 'overview', projectId: P2 })).toHaveLength(0)
  })

  it('refuses a 21st sidebar pin but not a 21st shortcut', () => {
    const tasks = Array.from({ length: PIN_SIDEBAR_MAX + 1 }, (_, i) => task(`T${i}`))
    for (const item of tasks.slice(0, PIN_SIDEBAR_MAX))
      pins().create({ place: 'sidebar', kind: 'task', targetId: item.id })
    expect(() =>
      pins().create({ place: 'sidebar', kind: 'task', targetId: tasks[PIN_SIDEBAR_MAX].id })
    ).toThrow(/at most 20/)
    for (const item of tasks) pins().create({ place: 'overview', kind: 'task', targetId: item.id })
    expect(pins().list({ place: 'overview', projectId: P1 })).toHaveLength(PIN_SIDEBAR_MAX + 1)
  })

  it('moves pins by order key, before, after or to the end', () => {
    const [a, b, c] = ['A', 'B', 'C'].map((title) =>
      pins().create({ place: 'sidebar', kind: 'task', targetId: task(title).id })
    )
    const titles = () =>
      pins()
        .list({ place: 'sidebar' })
        .map((pin) => pin.title)
    expect(titles()).toEqual(['A', 'B', 'C'])
    pins().move(c.id, { beforeId: a.id })
    expect(titles()).toEqual(['C', 'A', 'B'])
    pins().move(c.id, { afterId: a.id })
    expect(titles()).toEqual(['A', 'C', 'B'])
    pins().move(a.id, {})
    expect(titles()).toEqual(['C', 'B', 'A'])
    expect(() => pins().move(a.id, { beforeId: b.id, afterId: c.id })).toThrow()
    // Overview pins keep their own order.
    const shortcut = pins().create({ place: 'overview', kind: 'task', targetId: task('D').id })
    expect(() => pins().move(shortcut.id, { beforeId: a.id })).toThrow(/same place/)
  })

  it('leaves out a deleted target, shows an archived one, and unpinning never touches the item', () => {
    const kept = task('Kept')
    const gone = task('Gone')
    const doc = library.createItem(P1, { kind: 'note', title: 'Notes' })
    const keptPin = pins().create({ place: 'sidebar', kind: 'task', targetId: kept.id })
    pins().create({ place: 'sidebar', kind: 'task', targetId: gone.id })
    pins().create({ place: 'sidebar', kind: 'library', targetId: doc.id })

    planning.archiveWorkItem(kept.id, human)
    planning.deleteWorkItem(gone.id, human)
    library.archiveItem(P1, doc.id)
    const listed = pins().list({ place: 'sidebar' })
    expect(listed.map((pin) => [pin.exists, pin.archived, pin.title])).toEqual([
      [true, true, 'Kept'],
      [true, true, 'Notes']
    ])
    // A task in the recycle bin is left out too, and restoring it brings its pin back.
    const binned = task('Binned')
    pins().create({ place: 'sidebar', kind: 'task', targetId: binned.id })
    const sidebarTitles = () =>
      pins()
        .list({ place: 'sidebar' })
        .map((pin) => pin.title)
    planning.moveWorkItemToBin(binned.id, human)
    expect(sidebarTitles()).toEqual(['Kept', 'Notes'])
    planning.restoreWorkItem(binned.id, human)
    expect(sidebarTitles()).toEqual(['Kept', 'Notes', 'Binned'])
    planning.moveWorkItemToBin(binned.id, human)

    const removed = pins().delete(keptPin.id)
    expect(planning.getWorkItem(kept.id).title).toBe('Kept')
    expect(pins().list({ place: 'sidebar' })).toHaveLength(1)
    // Undo puts it back where it was.
    pins().restore(removed)
    expect(pins().list({ place: 'sidebar' })[0].id).toBe(keptPin.id)
  })

  it('refuses targets that do not exist or are in another project', () => {
    const other = task('Elsewhere', P2)
    expect(() => pins().create({ place: 'sidebar', kind: 'task', targetId: 'nope' })).toThrow()
    expect(() =>
      pins().create({ place: 'overview', kind: 'task', targetId: other.id, projectId: P1 })
    ).toThrow()
    expect(() =>
      pins().create({ place: 'sidebar', kind: 'project-view', targetId: 'Bad View', projectId: P1 })
    ).toThrow()
    expect(() =>
      pins().create({ place: 'nowhere' as never, kind: 'task', targetId: other.id })
    ).toThrow()
  })

  it('removing a project removes its pins and leaves the others', () => {
    pins().create({ place: 'sidebar', kind: 'task', targetId: task('Mine').id })
    pins().create({ place: 'overview', kind: 'task', targetId: task('Mine too').id })
    pins().create({ place: 'sidebar', kind: 'task', targetId: task('Other', P2).id })
    deleteProjectRows(planning.database, P1)
    projects = [P2]
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT project_id FROM pins').all()).toEqual([{ project_id: P2 }])
    } finally {
      db.close()
    }
  })
})

describe('the pins migration (N5.2a)', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-pins-migration-'))
    dbPath = path.join(tempDir, 'ostler.db')
  })

  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  const migrate = (migrations = MIGRATIONS) =>
    migrateOstlerDatabase(
      dbPath,
      { backupDir: path.join(tempDir, 'backups'), appVersion: 'test' },
      migrations
    )

  it('adds pins to a version 33 database, keeping its tasks, one per place and target', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 33))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Kept', 'ready', 'medium', 'human', 1, 1)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(33)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT title FROM planning_work_items').all()).toEqual([{ title: 'Kept' }])
      const insert = db.prepare(
        "INSERT INTO pins (id, place, project_id, kind, target_id, order_key, created_at) VALUES (?, ?, 'p1', 'task', 't1', 'V', 1)"
      )
      insert.run('a', 'sidebar')
      insert.run('b', 'overview')
      expect(() => insert.run('c', 'sidebar')).toThrow(/UNIQUE/)
      expect(() => insert.run('d', 'elsewhere')).toThrow(/CHECK/)
    } finally {
      db.close()
    }
  })
})
