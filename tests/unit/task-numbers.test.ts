import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore, CONFIG_MIGRATIONS } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { deleteWorkItemForever } from '../../electron/services/planning-deletion'
import { takeTaskNumber } from '../../electron/services/sync/task-numbers'
import { MIGRATIONS, migrateOstlerDatabase } from '../../electron/services/database/migrations'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/**
 * Task numbers (N9.8a): migration 42 numbers what is there, `createWorkItem`
 * numbers what comes after, and a number is never given twice.
 */

const tempDir = useTempDir('ostler-task-numbers-')
let store: ConfigStore
let planning: PlanningService
let projectId: string

const prefixOf = (id: string) => store.getProjects().find((p) => p.id === id)?.taskPrefix ?? null

beforeEach(async () => {
  const databasePath = await createMigratedDatabase(tempDir())
  store = new ConfigStore(path.join(tempDir(), 'config.json'))
  projectId = store.registerProject({ name: 'Online shop', folder: null }).id
  planning = new PlanningService(
    databasePath,
    () => store.getProjects().map((p) => p.id),
    undefined,
    prefixOf
  )
})

afterEach(() => {
  planning.close()
})

const actor = () => planning.humanActor()
const make = (title: string, extra: Record<string, unknown> = {}) =>
  planning.createWorkItem(projectId, { title, ...extra }, actor())

describe('task numbers', () => {
  it('gives each new task, subtasks too, the next number and its ID', () => {
    const first = make('Fix the login')
    const second = make('Write the copy')
    const sub = make('Check the form', { parentWorkItemId: first.id })
    expect([first.number, second.number, sub.number]).toEqual([1, 2, 3])
    expect(first.key).toBe('OS-1')
    expect(planning.listWorkItems(projectId).map((item) => item.key)).toEqual([
      'OS-1',
      'OS-2',
      'OS-3'
    ])
  })

  it('numbers each project on its own', () => {
    const other = store.registerProject({ name: 'Garden', folder: null }).id
    make('One')
    const there = planning.createWorkItem(other, { title: 'Dig' }, actor())
    expect(there.number).toBe(1)
    expect(there.key).toBe('GAR-1')
  })

  it('numbers tasks from every surface that makes them through createWorkItem', () => {
    const many = planning.createWorkItemsTogether(
      projectId,
      [{ title: 'A' }, { title: 'B' }],
      actor()
    )
    const original = make('Original')
    const { workItem: copy } = planning.copyWorkItem(original.id, actor())
    const numbers = [...many, original, copy].map((item) => item.number)
    expect(numbers).toEqual([1, 2, 3, 4])
  })

  it('never reuses a number, even after a task is deleted for good', () => {
    make('One')
    const two = make('Two')
    planning.moveWorkItemToBin(two.id, actor())
    deleteWorkItemForever(planning, store.getProjects()[0], two.id, actor())
    expect(make('Three').number).toBe(3)
  })

  it('brings a task back from the bin with its old number', () => {
    const one = make('One')
    planning.moveWorkItemToBin(one.id, actor())
    make('Two')
    const restored = planning.restoreWorkItem(one.id, actor())
    expect(restored.number).toBe(1)
    expect(planning.nextTaskNumber(projectId)).toBe(3)
  })

  it('keeps a number a project file gives when it is free, and continues after it', () => {
    const kept = planning.createWorkItem(projectId, { title: 'Kept' }, actor(), 'human', null, {
      number: 40
    })
    const clash = planning.createWorkItem(projectId, { title: 'Clash' }, actor(), 'human', null, {
      number: 40
    })
    expect(kept.number).toBe(40)
    expect(clash.number).toBe(41)
    expect(make('Next').number).toBe(42)
  })

  it('finds a task by its number', () => {
    const one = make('One')
    expect(planning.findWorkItemByNumber(projectId, 1)?.id).toBe(one.id)
    expect(planning.findWorkItemByNumber(projectId, 2)).toBeNull()
  })

  it('changes every ID at once when the prefix changes', () => {
    make('One')
    store.updateProject(projectId, { taskPrefix: 'shop' })
    expect(planning.listWorkItems(projectId)[0].key).toBe('SHOP-1')
  })

  it('refuses a prefix that is not two to five letters, or that another project uses', () => {
    store.registerProject({ name: 'Garden', folder: null })
    expect(() => store.updateProject(projectId, { taskPrefix: 'S' })).toThrow()
    expect(() => store.updateProject(projectId, { taskPrefix: 'SHOP12' })).toThrow()
    expect(() => store.updateProject(projectId, { taskPrefix: 'gar' })).toThrow(/Garden/)
    expect(prefixOf(projectId)).toBe('OS')
  })

  it('finds a task first when its ID is typed, as "OS-2", "os-2" or "os 2"', () => {
    make('Fix the login')
    const two = make('Write the copy about OS')
    for (const typed of ['OS-2', 'os-2', 'os 2']) {
      const results = planning.search.search(typed)
      expect(results[0]).toMatchObject({ type: 'task', id: two.id, key: 'OS-2' })
    }
    expect(planning.search.search('login')[0].key).toBe('OS-1')
  })
})

describe('takeTaskNumber (shared by the PC, received sync changes and the phone)', () => {
  it('moves past a number already in use even when the counter is behind it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-take-number-'))
    const db = new Database(await createMigratedDatabase(dir))
    try {
      db.prepare(
        "INSERT INTO project_task_counters (project_id, next_number) VALUES ('p1', 2)"
      ).run()
      // A task that arrived without moving the counter on, as an old phone build could leave it.
      db.prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, number, created_at, updated_at)
         VALUES ('t5', 'p1', 'Arrived', 'ready', 'medium', 'human', 5, 0, 0)`
      ).run()
      expect(takeTaskNumber(db, 'p1')).toBe(6)
      expect(takeTaskNumber(db, 'p1', 3)).toBe(3)
      expect(takeTaskNumber(db, 'p1', 5)).toBe(7)
      expect(takeTaskNumber(db, 'p1')).toBe(8)
    } finally {
      db.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('config migration 33', () => {
  it('gives every project a prefix from its name, made unique', () => {
    const migration = CONFIG_MIGRATIONS.find((entry) => entry.version === 33)!
    const config = {
      projects: [
        { id: 'a', name: 'Shop' },
        { id: 'b', name: 'Shopping list' },
        { id: 'c', name: 'Shop' },
        { id: 'd', name: 'Big online shop' }
      ]
    }
    migration.up(config, { newInstall: false })
    expect(
      config.projects.map((project) => (project as { taskPrefix?: string }).taskPrefix)
    ).toEqual(['SHO', 'SL', 'SHOP', 'BOS'])
  })
})

describe('database migration 42', () => {
  async function databaseAt41(): Promise<string> {
    const file = path.join(tempDir(), 'old.db')
    await migrateOstlerDatabase(
      file,
      { backupDir: path.join(tempDir(), 'backups'), appVersion: 'test' },
      MIGRATIONS.filter((migration) => migration.version <= 41)
    )
    return file
  }

  const insert = (db: Database.Database, id: string, project: string, createdAt: number) =>
    db
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES (?, ?, ?, 'backlog', 'medium', 'human', ?, ?)"
      )
      .run(id, project, id, createdAt, createdAt)

  it('numbers existing tasks in the order they were made, per project', async () => {
    const file = await databaseAt41()
    const before = new Database(file)
    insert(before, 'late', 'p1', 300)
    insert(before, 'early', 'p1', 100)
    insert(before, 'middle', 'p1', 200)
    insert(before, 'other', 'p2', 50)
    before.close()
    await migrateOstlerDatabase(file, {
      backupDir: path.join(tempDir(), 'backups'),
      appVersion: 'test'
    })
    const db = new Database(file)
    try {
      expect(
        db.prepare('SELECT id, number FROM planning_work_items ORDER BY project_id, number').all()
      ).toEqual([
        { id: 'early', number: 1 },
        { id: 'middle', number: 2 },
        { id: 'late', number: 3 },
        { id: 'other', number: 1 }
      ])
      expect(
        db.prepare('SELECT project_id, next_number FROM project_task_counters ORDER BY 1').all()
      ).toEqual([
        { project_id: 'p1', next_number: 4 },
        { project_id: 'p2', next_number: 2 }
      ])
    } finally {
      db.close()
    }
  })

  it('numbers 10,000 tasks in a few seconds', async () => {
    const file = await databaseAt41()
    const before = new Database(file)
    before.transaction(() => {
      for (let i = 0; i < 10_000; i++) insert(before, `t${i}`, 'big', 10_000 - i)
    })()
    before.close()
    const started = performance.now()
    await migrateOstlerDatabase(file, {
      backupDir: path.join(tempDir(), 'backups'),
      appVersion: 'test'
    })
    // A guard against a slow-down by orders of magnitude, loose enough for a busy CI runner.
    expect(performance.now() - started).toBeLessThan(10_000)
    const db = new Database(file)
    try {
      expect(db.prepare("SELECT number FROM planning_work_items WHERE id = 't9999'").get()).toEqual(
        { number: 1 }
      )
      expect(
        db.prepare('SELECT COUNT(DISTINCT number) AS n FROM planning_work_items').get()
      ).toEqual({ n: 10_000 })
    } finally {
      db.close()
    }
  })
})
