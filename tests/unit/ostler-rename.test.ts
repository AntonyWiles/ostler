import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  migrateOstlerDatabase
} from '../../electron/services/database/migrations'
import { CONFIG_MIGRATIONS } from '../../electron/config-store'
import { moveLegacyDataFolder, renameLegacyFiles } from '../../electron/app/rename-migration'
import { resolveDataDir } from '../../electron/app/data-dir'
import { extractItemLinks, itemLinkTarget } from '../../src/shared/item-links'
import { isOwnTaskBranch, taskBranchSlug } from '../../src/shared/legacy-names'
import { isProjectPackageFormat } from '../../src/shared/project-package'
import { moveLegacyStorageKeys } from '../../src/renderer/lib/legacy-storage'

/** Nexus Dashboard was renamed Ostler: what it kept on disk moves to the new names. */
let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-rename-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('database migration 57 (ostler-names)', () => {
  it("rewrites Nexus AI's actor token and the CHECK constraints that name it", async () => {
    const dbPath = path.join(dir, 'ostler.db')
    const options = { backupDir: path.join(dir, 'backups'), appVersion: 'test' }
    await migrateOstlerDatabase(
      dbPath,
      options,
      MIGRATIONS.filter((migration) => migration.version < 57)
    )

    const before = new Database(dbPath)
    before.exec(`
      INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
        VALUES ('task-1', 'p1', 'A task', 'backlog', 'medium', 'human', 1, 1);
      INSERT INTO planning_fields (id, project_id, name, type, position, created_at)
        VALUES ('field-1', 'p1', 'Notes', 'text', 0, 1);
      INSERT INTO library_items (id, project_id, kind, title, ai_access, created_at, updated_at)
        VALUES ('lib-1', 'p1', 'note', 'One', 'when-selected', '2026-10-21', '2026-10-21'),
               ('lib-2', 'p1', 'note', 'Two', 'when-selected', '2026-10-21', '2026-10-21');
    `)
    before
      .prepare(
        `INSERT INTO library_work_item_attachments
           (library_item_id, work_item_id, project_id, attached_by, revision, created_at)
         VALUES ('lib-1', 'task-1', 'p1', 'nexus-ai', 1, '2026-10-21'), ('lib-2', 'task-1', 'p1', 'human', 1, '2026-10-21')`
      )
      .run()
    // A row whose task is gone, written with foreign keys off: dropped, not copied.
    before.pragma('foreign_keys = OFF')
    before
      .prepare(
        `INSERT INTO library_work_item_attachments
           (library_item_id, work_item_id, project_id, attached_by, revision, created_at)
         VALUES ('lib-1', 'gone', 'p1', 'nexus-ai', 1, '2026-10-21')`
      )
      .run()
    before.pragma('foreign_keys = ON')
    before
      .prepare(
        `INSERT INTO planning_field_values (project_id, work_item_id, field_id, text_value, filled_by)
         VALUES ('p1', 'task-1', 'field-1', 'Nexus AI wrote nexus-ai here', 'nexus-ai')`
      )
      .run()
    before
      .prepare(
        `INSERT INTO planning_field_changes (project_id, work_item_id, field, actor_kind, metadata, at)
         VALUES ('p1', 'task-1', 'status', 'nexus-ai', '{"actor":{"kind":"nexus-ai"}}', 1)`
      )
      .run()
    before.close()

    await migrateOstlerDatabase(dbPath, options)

    const db = new Database(dbPath, { readonly: true })
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)
      expect(
        db
          .prepare('SELECT attached_by FROM library_work_item_attachments ORDER BY library_item_id')
          .all()
      ).toEqual([{ attached_by: 'ostler-ai' }, { attached_by: 'human' }])
      // The person's own words stay as they are.
      expect(db.prepare('SELECT text_value, filled_by FROM planning_field_values').get()).toEqual({
        text_value: 'Nexus AI wrote nexus-ai here',
        filled_by: 'ostler-ai'
      })
      expect(db.prepare('SELECT actor_kind, metadata FROM planning_field_changes').get()).toEqual({
        actor_kind: 'ostler-ai',
        metadata: '{"actor":{"kind":"ostler-ai"}}'
      })
      const schema = db
        .prepare(
          `SELECT group_concat(sql, ' ') AS sql FROM sqlite_master
           WHERE tbl_name IN ('library_work_item_attachments', 'planning_field_values')`
        )
        .get() as { sql: string }
      expect(schema.sql).not.toContain('nexus-ai')
      expect(schema.sql).toContain("'ostler-ai'")
      expect(schema.sql).toContain('idx_library_attachments_work_item')
      expect(schema.sql).toContain('idx_planning_field_values_number')
    } finally {
      db.close()
    }
  })
})

describe('the data folder', () => {
  it('moves %APPDATA%\\nexus-dashboard to %APPDATA%\\ostler and points saved paths at it', () => {
    const old = path.join(dir, 'nexus-dashboard')
    fs.mkdirSync(path.join(old, 'harness', 'p1'), { recursive: true })
    fs.writeFileSync(
      path.join(old, 'harness', 'p1', 'state.json'),
      JSON.stringify({ copy: path.join(old, 'worktrees', 'p1', 'fix'), other: 'C:\\Elsewhere' })
    )

    const move = moveLegacyDataFolder({}, dir, 'ostler')

    const moved = path.join(dir, 'ostler')
    expect(move).toEqual({ kind: 'moved', from: old, to: moved })
    expect(fs.existsSync(old)).toBe(false)
    const state = JSON.parse(
      fs.readFileSync(path.join(moved, 'harness', 'p1', 'state.json'), 'utf8')
    )
    expect(state).toEqual({
      copy: path.join(moved, 'worktrees', 'p1', 'fix'),
      other: 'C:\\Elsewhere'
    })
  })

  it('leaves a folder the person named, and never merges into an existing one', () => {
    fs.mkdirSync(path.join(dir, 'nexus-dashboard'))
    expect(moveLegacyDataFolder({ OSTLER_USER_DATA: 'D:\\data' }, dir, 'ostler').kind).toBe(
      'nothing'
    )
    expect(moveLegacyDataFolder({ NEXUS_USER_DATA: 'D:\\data' }, dir, 'ostler').kind).toBe(
      'nothing'
    )
    fs.mkdirSync(path.join(dir, 'ostler'))
    expect(moveLegacyDataFolder({}, dir, 'ostler').kind).toBe('nothing')
    expect(fs.existsSync(path.join(dir, 'nexus-dashboard'))).toBe(true)
  })

  it('still reads NEXUS_USER_DATA, after OSTLER_USER_DATA', () => {
    expect(resolveDataDir({ NEXUS_USER_DATA: 'D:\\old' }, dir)).toBe('D:\\old')
    expect(resolveDataDir({ NEXUS_USER_DATA: 'D:\\old', OSTLER_USER_DATA: 'D:\\new' }, dir)).toBe(
      'D:\\new'
    )
  })

  it('renames nexus.db, its backups and the kept-work refs harness state records', () => {
    fs.writeFileSync(path.join(dir, 'nexus.db'), 'db')
    fs.writeFileSync(path.join(dir, 'nexus.db-wal'), 'wal')
    const backup = path.join(dir, 'backups', '20261001-daily')
    fs.mkdirSync(backup, { recursive: true })
    fs.writeFileSync(path.join(backup, 'nexus.db'), 'old')
    fs.writeFileSync(
      path.join(backup, 'manifest.json'),
      JSON.stringify({ format: 'nexus-backup', excludes: ['nexus.db'] })
    )
    fs.mkdirSync(path.join(dir, 'harness', 'p1'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'harness', 'p1', 'state.json'),
      JSON.stringify({ discardedRef: 'refs/nexus/discarded/fix' })
    )

    renameLegacyFiles(dir, 'ostler.db')
    renameLegacyFiles(dir, 'ostler.db')

    expect(fs.readFileSync(path.join(dir, 'ostler.db'), 'utf8')).toBe('db')
    expect(fs.readFileSync(path.join(dir, 'ostler.db-wal'), 'utf8')).toBe('wal')
    expect(fs.existsSync(path.join(dir, 'nexus.db'))).toBe(false)
    expect(fs.readFileSync(path.join(backup, 'ostler.db'), 'utf8')).toBe('old')
    expect(JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8'))).toEqual({
      format: 'ostler-backup',
      excludes: ['ostler.db']
    })
    expect(fs.readFileSync(path.join(dir, 'harness', 'p1', 'state.json'), 'utf8')).toContain(
      '"refs/ostler/discarded/fix"'
    )
  })
})

describe('config migration 42 (ostler-names)', () => {
  it('relabels sealed secrets, renames the actor token and the sample project', () => {
    const migration = CONFIG_MIGRATIONS.find((entry) => entry.version === 42)
    expect(migration?.name).toBe('ostler-names')
    const saved: Record<string, unknown> = {
      ai: { apiKey: 'nexus-secure:v1:abc=' },
      projects: [
        { name: 'Welcome to Nexus', automationToken: 'nexus-secure:v1:xyz=' },
        { name: 'Nexus notes', attachedBy: 'nexus-ai' }
      ]
    }
    migration?.up(saved, { newInstall: false })
    expect(saved).toEqual({
      ai: { apiKey: 'ostler-secure:v1:abc=' },
      projects: [
        { name: 'Welcome to Ostler (Demo Project)', automationToken: 'ostler-secure:v1:xyz=' },
        { name: 'Nexus notes', attachedBy: 'ostler-ai' }
      ]
    })
  })
})

describe('config migration 43 (demo-project-name)', () => {
  it('renames the sample project already made, and nothing else', () => {
    const migration = CONFIG_MIGRATIONS.find((entry) => entry.version === 43)
    expect(migration?.name).toBe('demo-project-name')
    const saved: Record<string, unknown> = {
      projects: [
        { name: 'Welcome to Ostler' },
        { name: 'Welcome to Ostler (2)' },
        { name: 'Trip notes' },
        'not a project'
      ]
    }
    migration?.up(saved, { newInstall: false })
    expect(saved.projects).toEqual([
      { name: 'Welcome to Ostler (Demo Project)' },
      { name: 'Welcome to Ostler (2)' },
      { name: 'Trip notes' },
      'not a project'
    ])
  })
})

describe('names kept from before the rename', () => {
  it('reads item links written with the old scheme', () => {
    const [project, task, milestone, decision] = [
      'aaaaaaaa-0000-4000-8000-000000000001',
      'aaaaaaaa-0000-4000-8000-000000000002',
      'aaaaaaaa-0000-4000-8000-000000000003',
      'aaaaaaaa-0000-4000-8000-000000000004'
    ]
    const text = `See [the bug](nexus-dashboard://task/${project}/${task}) and [the plan](ostler://milestone/${project}/${milestone}).`
    expect(extractItemLinks(text, 'ostler')).toEqual([
      { kind: 'task', projectId: project, id: task },
      { kind: 'milestone', projectId: project, id: milestone }
    ])
    expect(itemLinkTarget(`nexus-dashboard://decision/${project}/${decision}`, 'ostler')).toEqual({
      kind: 'decision',
      projectId: project,
      id: decision
    })
  })

  it("treats a task copy's nexus/ version as Ostler's own", () => {
    expect(isOwnTaskBranch('ostler/fix-login')).toBe(true)
    expect(isOwnTaskBranch('nexus/fix-login')).toBe(true)
    expect(isOwnTaskBranch('main')).toBe(false)
    expect(taskBranchSlug('nexus/fix-login')).toBe('fix-login')
    expect(taskBranchSlug('ostler/fix-login')).toBe('fix-login')
  })

  it('imports a project file exported before the rename', () => {
    expect(isProjectPackageFormat('nexus-project-package')).toBe(true)
    expect(isProjectPackageFormat('ostler-project-package')).toBe(true)
    expect(isProjectPackageFormat('something-else')).toBe(false)
  })

  it("moves a window's saved view settings to the new keys, keeping newer ones", () => {
    const values = new Map<string, string>([
      ['nexus.sidebar.collapsed', 'true'],
      ['nexus.myDay.hours', '6'],
      ['ostler.myDay.hours', '4'],
      ['unrelated', 'x']
    ])
    const storage = {
      get length() {
        return values.size
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
      clear: () => values.clear()
    } as Storage
    moveLegacyStorageKeys(storage)
    expect(Object.fromEntries(values)).toEqual({
      'ostler.sidebar.collapsed': 'true',
      'ostler.myDay.hours': '4',
      unrelated: 'x'
    })
  })
})
