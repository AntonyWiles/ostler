import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DatabaseTooNewError,
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  migrateOstlerDatabase,
  type Migration
} from '../../electron/services/database/migrations'
import { useTempDir } from '../helpers/temp-dir'

const EXPECTED_TABLES = [
  'account_apps',
  'agent_runs',
  'ai_conversations',
  'away_sharing',
  'billings',
  'calendar_write_target',
  'change_history_entries',
  'change_history_rows',
  'commit_link_scans',
  'connected_accounts',
  'contacts',
  'costs',
  'days_off',
  'git_events',
  'goal_check_ins',
  'harness_events',
  'import_batches',
  'inbox_state',
  'item_links',
  'library_item_revisions',
  'library_items',
  'library_search',
  'library_work_item_attachments',
  'library_work_item_sources',
  'my_day_entries',
  'outside_calendar_events',
  'outside_calendars',
  'people',
  'personal_goal_check_ins',
  'personal_goal_links',
  'personal_goals',
  'pins',
  'planning_baseline_entries',
  'planning_baselines',
  'planning_blockers',
  'planning_checklist_checks',
  'planning_checklist_details',
  'planning_column_settings',
  'planning_comments',
  'planning_decisions',
  'planning_dependencies',
  'planning_description_versions',
  'planning_field_changes',
  'planning_field_values',
  'planning_fields',
  'planning_github_links',
  'planning_goals',
  'planning_iterations',
  'planning_labels',
  'planning_milestones',
  'planning_recurrences',
  'planning_rule_due_runs',
  'planning_rule_notices',
  'planning_rule_runs',
  'planning_rules',
  'planning_sign_offs',
  'planning_status_history',
  'planning_subprojects',
  'planning_task_links',
  'planning_task_templates',
  'planning_task_types',
  'planning_time_blocks',
  'planning_time_entries',
  'planning_wip_limits',
  'planning_work_items',
  'project_budgets',
  'project_task_counters',
  'project_webhooks',
  'reminders',
  'saved_views',
  'search_index',
  'session_transcripts',
  'shared_away',
  'shopping_items',
  'status_updates',
  'sync_applied',
  'sync_field_stamps',
  'sync_identity',
  'sync_keys',
  'sync_member_capabilities',
  'sync_members',
  'sync_outbox',
  'sync_pending',
  'sync_person',
  'sync_person_link_answers',
  'sync_records',
  'sync_role_files',
  'sync_roles',
  'sync_server',
  'sync_settings',
  'sync_shares',
  'task_commit_links',
  'task_contacts',
  'task_follows',
  'task_list_items',
  'task_list_target',
  'task_plans',
  'task_unseen',
  'team_members',
  'teams',
  'time_block_events',
  'watch_events',
  'weekly_review_reminders',
  'weekly_reviews',
  'whiteboard_objects'
]

const DROPPED_TABLES = ['projects', 'project_knowledge', 'agent_conversations']

function userTables(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true })
  try {
    return (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all() as { name: string }[]
    )
      .map(({ name }) => name)
      .filter((name) => !name.startsWith('library_search_') && !name.startsWith('search_index_'))
  } finally {
    db.close()
  }
}

function schemaDump(dbPath: string): string {
  const db = new Database(dbPath, { readonly: true })
  try {
    return JSON.stringify(
      db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all()
    )
  } finally {
    db.close()
  }
}

function userVersion(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true })
  try {
    return db.pragma('user_version', { simple: true }) as number
  } finally {
    db.close()
  }
}

/**
 * A database as an early build left it: no runner, `user_version` 0, the
 * unused tables present, `git_events` without `body` (and with a duplicate),
 * and `planning_work_items` missing every column added after its first release.
 */
function writePreRunnerDatabase(dbPath: string): void {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
      color TEXT, enabled INTEGER DEFAULT 1, notes TEXT DEFAULT '', tags TEXT DEFAULT '[]',
      added_at INTEGER NOT NULL, last_activity INTEGER);
    CREATE TABLE project_knowledge (id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      relative_path TEXT NOT NULL, extension TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL,
      size_bytes INTEGER NOT NULL, modified_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'needs-review', feedback TEXT NOT NULL DEFAULT '',
      UNIQUE(project_id, relative_path));
    CREATE TABLE agent_conversations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      source_path TEXT NOT NULL, source_file TEXT NOT NULL, provider TEXT NOT NULL, title TEXT NOT NULL,
      content TEXT NOT NULL, message_count INTEGER NOT NULL, modified_at INTEGER NOT NULL,
      imported_at INTEGER NOT NULL, UNIQUE(project_id, source_file));
    CREATE TABLE watch_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, timestamp INTEGER NOT NULL,
      type TEXT NOT NULL, relative_path TEXT NOT NULL, extension TEXT DEFAULT '', size_bytes INTEGER,
      category TEXT NOT NULL);
    CREATE TABLE git_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, timestamp INTEGER NOT NULL,
      hash TEXT NOT NULL, abbreviated_hash TEXT DEFAULT '', author TEXT DEFAULT '', message TEXT DEFAULT '',
      date TEXT DEFAULT '', files_changed INTEGER DEFAULT 0, insertions INTEGER DEFAULT 0,
      deletions INTEGER DEFAULT 0, branch TEXT DEFAULT '');
    CREATE TABLE planning_goals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL);
    CREATE TABLE planning_work_items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, milestone_id TEXT,
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, priority TEXT NOT NULL,
      labels TEXT NOT NULL DEFAULT '[]', acceptance_criteria TEXT NOT NULL DEFAULT '[]', target_date TEXT,
      origin TEXT NOT NULL, linked_harness_task_id TEXT, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL);
  `)
  db.prepare(
    "INSERT INTO projects VALUES ('p1', 'Old', 'C:/old', NULL, 1, '', '[]', 1, NULL)"
  ).run()
  db.prepare(
    "INSERT INTO watch_events VALUES ('w1', 'p1', 10, 'add', 'a.ts', '.ts', 3, 'source')"
  ).run()
  const insertGit = db.prepare(
    "INSERT INTO git_events (id, project_id, timestamp, hash, message) VALUES (?, 'p1', ?, ?, ?)"
  )
  insertGit.run('g1', 1, 'abc', 'first sighting')
  insertGit.run('g2', 2, 'abc', 'second sighting')
  insertGit.run('g3', 3, 'def', 'other commit')
  db.prepare("INSERT INTO planning_goals VALUES ('goal1', 'p1', 'Ship', '', 'active', 1, 1)").run()
  db.prepare(
    `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
     VALUES ('item1', 'p1', 'Write it', 'ready', 'high', 'human', 1, 2)`
  ).run()
  db.close()
}

describe('migrateOstlerDatabase', () => {
  const tempDir = useTempDir('ostler-migrations-')
  let dbPath: string
  let backupDir: string

  beforeEach(() => {
    dbPath = path.join(tempDir(), 'ostler.db')
    backupDir = path.join(tempDir(), 'backups')
  })

  const migrate = (migrations?: readonly Migration[]) =>
    migrateOstlerDatabase(dbPath, { backupDir, appVersion: '9.9.9' }, migrations)

  it('brings a brand-new file to the latest version with the expected tables, without a backup', async () => {
    const result = await migrate()

    expect(result).toEqual({ from: 0, to: LATEST_SCHEMA_VERSION, backupPath: null })
    expect(userVersion(dbPath)).toBe(LATEST_SCHEMA_VERSION)
    expect(userTables(dbPath)).toEqual(EXPECTED_TABLES)
    expect(fs.existsSync(backupDir)).toBe(false)
  })

  it('upgrades a pre-runner file without losing rows, and backs it up first', async () => {
    writePreRunnerDatabase(dbPath)

    const result = await migrate()

    expect(result.from).toBe(0)
    expect(result.to).toBe(LATEST_SCHEMA_VERSION)
    expect(userTables(dbPath)).toEqual(EXPECTED_TABLES)
    const db = new Database(dbPath, { readonly: true })
    try {
      expect(db.prepare('SELECT id, relative_path FROM watch_events').all()).toEqual([
        { id: 'w1', relative_path: 'a.ts' }
      ])
      // Duplicate observations collapse to the newest, as the services always did.
      expect(db.prepare('SELECT id, body FROM git_events ORDER BY id').all()).toEqual([
        { id: 'g2', body: '' },
        { id: 'g3', body: '' }
      ])
      expect(db.prepare('SELECT title FROM planning_goals').all()).toEqual([{ title: 'Ship' }])
      expect(
        db
          .prepare(
            'SELECT id, title, auto_queue, verification_status, parent_work_item_id, deleted_at FROM planning_work_items'
          )
          .all()
      ).toEqual([
        {
          id: 'item1',
          title: 'Write it',
          auto_queue: 0,
          verification_status: 'unverified',
          parent_work_item_id: null,
          deleted_at: null
        }
      ])
    } finally {
      db.close()
    }

    // The backup is the file as it was: version 0, unused tables and all.
    expect(result.backupPath).not.toBeNull()
    const backupPath = result.backupPath!
    expect(path.dirname(path.dirname(backupPath))).toBe(backupDir)
    expect(path.basename(path.dirname(backupPath))).toMatch(
      new RegExp(`^pre-migration-v0-v${LATEST_SCHEMA_VERSION}-\\d{8}-\\d{6}-\\d{3}$`)
    )
    expect(userVersion(backupPath)).toBe(0)
    expect(userTables(backupPath)).toContain('projects')
    const manifest = JSON.parse(
      fs.readFileSync(path.join(path.dirname(backupPath), 'manifest.json'), 'utf-8')
    )
    expect(manifest).toMatchObject({
      reason: 'pre-migration',
      schemaVersion: 0,
      appVersion: '9.9.9'
    })
  })

  it('drops only the unused tables', async () => {
    writePreRunnerDatabase(dbPath)
    await migrate()
    const tables = userTables(dbPath)
    for (const dropped of DROPPED_TABLES) expect(tables).not.toContain(dropped)
  })

  it('changes nothing when run a second time', async () => {
    writePreRunnerDatabase(dbPath)
    await migrate()
    const before = schemaDump(dbPath)
    const backupsBefore = fs.readdirSync(backupDir)

    const again = await migrate()

    expect(again).toEqual({
      from: LATEST_SCHEMA_VERSION,
      to: LATEST_SCHEMA_VERSION,
      backupPath: null
    })
    expect(schemaDump(dbPath)).toBe(before)
    expect(fs.readdirSync(backupDir)).toEqual(backupsBefore)
  })

  it('gives an old file and a new file the same schema', async () => {
    writePreRunnerDatabase(dbPath)
    await migrate()
    const freshPath = path.join(tempDir(), 'fresh.db')
    await migrateOstlerDatabase(freshPath, { backupDir, appVersion: 'test' })

    // Columns added by ALTER TABLE sit in a different place in the stored SQL,
    // so compare the shape rather than the text.
    const shape = (file: string) => {
      const db = new Database(file, { readonly: true })
      try {
        return userTables(file).map((table) => ({
          table,
          columns: (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[])
            .map(({ name }) => name)
            .sort(),
          indexes: (db.prepare(`PRAGMA index_list("${table}")`).all() as { name: string }[])
            .map(({ name }) => name)
            .sort()
        }))
      } finally {
        db.close()
      }
    }
    expect(shape(dbPath)).toEqual(shape(freshPath))
  })

  it('adds the P5.1 task essentials to a pre-P5.1 database without touching its tasks', async () => {
    // A database as the build before P5.1 left it: version 2, with a task.
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 2))
    const before = new Database(dbPath)
    before
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, labels,
           acceptance_criteria, target_date, origin, created_at, updated_at)
         VALUES ('item1', 'p1', 'Write it', 'ready', 'high', '["docs"]', '["Reviewed"]',
           '2026-10-20', 'human', 1, 2)`
      )
      .run()
    before.close()
    expect(userVersion(dbPath)).toBe(2)

    const result = await migrate()

    expect(result.from).toBe(2)
    expect(result.backupPath).not.toBeNull()
    expect(userVersion(result.backupPath!)).toBe(2)
    expect(userTables(dbPath)).toEqual(EXPECTED_TABLES)
    const db = new Database(dbPath)
    try {
      expect(
        db
          .prepare(
            'SELECT title, labels, acceptance_criteria, target_date, assignee_id, start_date, estimate FROM planning_work_items'
          )
          .get()
      ).toEqual({
        title: 'Write it',
        labels: '["docs"]',
        acceptance_criteria: '["Reviewed"]',
        target_date: '2026-10-20',
        assignee_id: null,
        start_date: null,
        estimate: null
      })
      // At most one person is Me, enforced by the schema as well as the service.
      const insert = db.prepare(
        "INSERT INTO people (id, name, color, is_me, created_at, updated_at) VALUES (?, ?, '#3b82f6', ?, 1, 1)"
      )
      insert.run('a', 'Ada', 1)
      insert.run('b', 'Bea', 0)
      expect(() => insert.run('c', 'Cy', 1)).toThrow(/UNIQUE/)
      // An assignee that goes away leaves the task unassigned.
      db.pragma('foreign_keys = ON')
      db.prepare("UPDATE planning_work_items SET assignee_id = 'b'").run()
      db.prepare("DELETE FROM people WHERE id = 'b'").run()
      expect(db.prepare('SELECT assignee_id FROM planning_work_items').get()).toEqual({
        assignee_id: null
      })
    } finally {
      db.close()
    }
  })

  it('adds P5.2 comments and activity to a P5.1 database, keeping status history as it was', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 3))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('item1', 'p1', 'Write it', 'ready', 'high', 'human', 1, 2)"
      )
      .run()
    before
      .prepare(
        "INSERT INTO planning_status_history (work_item_id, from_status, to_status, at) VALUES ('item1', NULL, 'ready', 1)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(3)
    expect(userTables(dbPath)).toEqual(EXPECTED_TABLES)
    const db = new Database(dbPath)
    try {
      // Old rows keep their history; who moved them is unknown (null).
      expect(
        db
          .prepare(
            'SELECT from_status, to_status, at, actor_kind, actor_person_id FROM planning_status_history'
          )
          .get()
      ).toEqual({
        from_status: null,
        to_status: 'ready',
        at: 1,
        actor_kind: null,
        actor_person_id: null
      })
      const indexes = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
          name: string
        }[]
      ).map((row) => row.name)
      expect(indexes).toEqual(
        expect.arrayContaining([
          'idx_planning_field_changes_item',
          'idx_planning_comments_item',
          'idx_planning_status_history_item'
        ])
      )
      // Comments and field changes go with their task.
      db.pragma('foreign_keys = ON')
      db.prepare(
        "INSERT INTO planning_comments (id, project_id, work_item_id, author_kind, body, created_at, updated_at) VALUES ('c1', 'p1', 'item1', 'human', 'Hi', 1, 1)"
      ).run()
      db.prepare(
        "INSERT INTO planning_field_changes (project_id, work_item_id, field, actor_kind, at) VALUES ('p1', 'item1', 'title', 'human', 1)"
      ).run()
      db.prepare("DELETE FROM planning_work_items WHERE id = 'item1'").run()
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_comments').get()).toEqual({ n: 0 })
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_field_changes').get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })

  it('adds P5.6 repeats, reminders and Inbox state to a P5.2 database', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 4))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('item1', 'p1', 'Pay rent', 'ready', 'high', 'human', 1, 2)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(4)
    expect(userTables(dbPath)).toEqual(EXPECTED_TABLES)
    const db = new Database(dbPath)
    try {
      expect(
        db.prepare("SELECT title, recurred_to_id FROM planning_work_items WHERE id = 'item1'").get()
      ).toEqual({ title: 'Pay rent', recurred_to_id: null })
      db.pragma('foreign_keys = ON')
      db.prepare(
        `INSERT INTO planning_recurrences (work_item_id, project_id, rule) VALUES ('item1', 'p1', '{"every":"week","interval":1}')`
      ).run()
      db.prepare(
        "INSERT INTO reminders (id, project_id, work_item_id, remind_at, kind) VALUES ('r1', 'p1', 'item1', 5, 'due')"
      ).run()
      db.prepare("INSERT INTO inbox_state (item_key, read_at) VALUES ('reminder:r1', 6)").run()
      // A task's repeat and reminders go with it; Inbox state is keyed, not linked.
      db.prepare("DELETE FROM planning_work_items WHERE id = 'item1'").run()
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_recurrences').get()).toEqual({ n: 0 })
      expect(db.prepare('SELECT COUNT(*) AS n FROM reminders').get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })

  it('adds the P9.1 indexes a project task list and its checklist reads use', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 8))
    const result = await migrate()

    expect(result.from).toBe(8)
    const db = new Database(dbPath)
    try {
      const plan = (sql: string) =>
        (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('p1') as Array<{ detail: string }>)
          .map((row) => row.detail)
          .join(' / ')
      const tasks = plan(
        'SELECT * FROM planning_work_items WHERE project_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC'
      )
      expect(tasks).toContain('idx_planning_work_items_project_updated')
      expect(tasks).not.toContain('TEMP B-TREE')
      expect(
        plan('SELECT work_item_id FROM planning_checklist_checks WHERE project_id = ?')
      ).toContain('idx_planning_checklist_checks_project')
    } finally {
      db.close()
    }
  })

  it('keys every task in the order the Board showed it, most recently updated first (R2.1)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 9))
    const before = new Database(dbPath)
    const insert = before.prepare(
      "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, ?)"
    )
    insert.run('old', 'p1', 'Old', 10)
    insert.run('newest', 'p1', 'Newest', 30)
    insert.run('middle', 'p1', 'Middle', 20)
    insert.run('other', 'p2', 'Other project', 5)
    before.close()

    const result = await migrate()

    expect(result.from).toBe(9)
    const db = new Database(dbPath)
    try {
      const order = (projectId: string) =>
        (
          db
            .prepare(
              'SELECT id, order_key FROM planning_work_items WHERE project_id = ? ORDER BY order_key'
            )
            .all(projectId) as { id: string; order_key: string }[]
        ).map((row) => row.id)
      expect(order('p1')).toEqual(['newest', 'middle', 'old'])
      expect(order('p2')).toEqual(['other'])
      const keys = db.prepare('SELECT order_key FROM planning_work_items').all() as {
        order_key: string
      }[]
      expect(keys.every((row) => /^[0-9A-Za-z]*[1-9A-Za-z]$/.test(row.order_key))).toBe(true)
      const plan = (
        db
          .prepare(
            'EXPLAIN QUERY PLAN SELECT * FROM planning_work_items WHERE project_id = ? ORDER BY order_key'
          )
          .all('p1') as Array<{ detail: string }>
      )
        .map((row) => row.detail)
        .join(' / ')
      expect(plan).toContain('idx_planning_work_items_project_order')
      expect(plan).not.toContain('TEMP B-TREE')
    } finally {
      db.close()
    }
  })

  it('adds custom fields to a version 10 database, keeping its tasks (R2.2)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 10))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Kept', 'ready', 'medium', 'human', 1, 1)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(10)
    const db = new Database(dbPath)
    try {
      db.pragma('foreign_keys = ON')
      expect(db.prepare('SELECT title FROM planning_work_items').all()).toEqual([{ title: 'Kept' }])
      db.prepare(
        "INSERT INTO planning_fields (id, project_id, name, type, options, position, created_at) VALUES ('f1', 'p1', 'Client', 'text', '[]', 0, 1)"
      ).run()
      db.prepare(
        "INSERT INTO planning_field_values (project_id, work_item_id, field_id, text_value) VALUES ('p1', 't1', 'f1', 'Acme')"
      ).run()
      const plan = (
        db
          .prepare(
            'EXPLAIN QUERY PLAN SELECT work_item_id FROM planning_field_values WHERE field_id = ? AND text_value = ?'
          )
          .all('f1', 'Acme') as Array<{ detail: string }>
      )
        .map((row) => row.detail)
        .join(' / ')
      expect(plan).toContain('idx_planning_field_values_text')
      // A value goes with its field and with its task.
      db.prepare("DELETE FROM planning_fields WHERE id = 'f1'").run()
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_field_values').get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })

  it('adds time entries to a version 11 database, one running timer at most (R2.3)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 11))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Kept', 'ready', 'medium', 'human', 1, 1)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(11)
    const db = new Database(dbPath)
    try {
      db.pragma('foreign_keys = ON')
      expect(db.prepare('SELECT title FROM planning_work_items').all()).toEqual([{ title: 'Kept' }])
      const insert = db.prepare(
        "INSERT INTO planning_time_entries (id, project_id, work_item_id, started_at, duration_seconds, source, created_at, updated_at) VALUES (?, 'p1', 't1', 1, ?, 'timer', 1, 1)"
      )
      insert.run('e1', 60)
      insert.run('e2', null)
      expect(() => insert.run('e3', null)).toThrow()
      insert.run('e4', 90)
      db.prepare("DELETE FROM planning_work_items WHERE id = 't1'").run()
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_time_entries').get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })

  it('adds column settings to a version 12 database (R2.4)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 12))

    const result = await migrate()

    expect(result.from).toBe(12)
    const db = new Database(dbPath)
    try {
      const insert = db.prepare(
        "INSERT INTO planning_column_settings (project_id, status, name, hidden, updated_at) VALUES ('p1', ?, ?, ?, 1)"
      )
      insert.run('active', 'Doing', 0)
      insert.run('review', '', 1)
      expect(() => insert.run('active', 'Again', 0)).toThrow()
      expect(
        db
          .prepare('SELECT status, name, hidden FROM planning_column_settings ORDER BY status')
          .all()
      ).toEqual([
        { status: 'active', name: 'Doing', hidden: 0 },
        { status: 'review', name: '', hidden: 1 }
      ])
    } finally {
      db.close()
    }
  })

  it('adds capacity and working days to a version 13 database, keeping its people (R3.2)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 13))
    const old = new Database(dbPath)
    old
      .prepare(
        "INSERT INTO people (id, name, initials, color, is_me, created_at, updated_at) VALUES ('a', 'Ada', '', '#123456', 1, 1, 1)"
      )
      .run()
    old.close()

    const result = await migrate()

    expect(result.from).toBe(13)
    const db = new Database(dbPath)
    try {
      expect(
        db.prepare('SELECT name, weekly_capacity_hours, working_days FROM people').all()
      ).toEqual([{ name: 'Ada', weekly_capacity_hours: null, working_days: 31 }])
    } finally {
      db.close()
    }
  })

  it('adds the run history to a version 14 database, keeping its tasks (R5.3)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 14))
    const old = new Database(dbPath)
    old
      .prepare(
        "INSERT INTO people (id, name, initials, color, is_me, created_at, updated_at) VALUES ('a', 'Ada', '', '#123456', 1, 1, 1)"
      )
      .run()
    old.close()

    const result = await migrate()

    expect(result.from).toBe(14)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT name FROM people').all()).toEqual([{ name: 'Ada' }])
      db.prepare(
        `INSERT INTO agent_runs (session_id, project_id, provenance, started_at, ended_at, outcome,
           ended_as, updated_at) VALUES ('s1', 'p1', 'embedded', 1, 2, 'in_review', 'in_review', 2)`
      ).run()
      expect(
        db.prepare('SELECT session_id, usage_reported, commits FROM agent_runs').all()
      ).toEqual([{ session_id: 's1', usage_reported: 0, commits: null }])
    } finally {
      db.close()
    }
  })

  it('adds GitHub links to a version 15 database, one link per issue per task (R4.4)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 15))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Kept', 'ready', 'medium', 'human', 1, 1)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(15)
    const db = new Database(dbPath)
    try {
      db.pragma('foreign_keys = ON')
      expect(db.prepare('SELECT title FROM planning_work_items').all()).toEqual([{ title: 'Kept' }])
      const insert = db.prepare(
        "INSERT INTO planning_github_links (id, project_id, work_item_id, owner, repo, number, kind, created_at) VALUES (?, 'p1', 't1', ?, 'site', ?, 'issue', 1)"
      )
      insert.run('l1', 'acme', 12)
      // The same issue again, whatever the case of the repository, is refused.
      expect(() => insert.run('l2', 'ACME', 12)).toThrow()
      insert.run('l3', 'acme', 13)
      expect(
        db
          .prepare("SELECT title, state, fetched_at FROM planning_github_links WHERE id = 'l1'")
          .get()
      ).toEqual({ title: '', state: null, fetched_at: null })
      db.prepare("DELETE FROM planning_work_items WHERE id = 't1'").run()
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_github_links').get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })

  it('adds iterations to a version 16 database, leaving tasks in none (R6.1)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 16))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Kept', 'ready', 'medium', 'human', 1, 1)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(16)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT title, iteration_id FROM planning_work_items').all()).toEqual([
        { title: 'Kept', iteration_id: null }
      ])
      db.prepare(
        "INSERT INTO planning_iterations (id, project_id, name, start_date, end_date, created_at, updated_at) VALUES ('i1', 'p1', 'One', '2026-10-01', '2026-10-14', 1, 1)"
      ).run()
      expect(
        db.prepare("SELECT goal, status, summary FROM planning_iterations WHERE id = 'i1'").get()
      ).toEqual({ goal: '', status: 'planned', summary: null })
    } finally {
      db.close()
    }
  })

  it('adds rules to a version 17 database, keeping its history (R6.2)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 17))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Kept', 'ready', 'medium', 'human', 1, 1)"
      )
      .run()
    before
      .prepare(
        "INSERT INTO planning_status_history (work_item_id, from_status, to_status, at, actor_kind) VALUES ('t1', NULL, 'ready', 1, 'human')"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(17)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT to_status, rule_name FROM planning_status_history').all()).toEqual([
        { to_status: 'ready', rule_name: null }
      ])
      db.prepare(
        "INSERT INTO planning_rules (id, project_id, name, trigger, actions, created_at, updated_at) VALUES ('r1', 'p1', 'Rule', '{\"kind\":\"taskCreated\"}', '[]', 1, 1)"
      ).run()
      expect(
        db.prepare('SELECT enabled, conditions, run_count, last_run_at FROM planning_rules').get()
      ).toEqual({ enabled: 1, conditions: '[]', run_count: 0, last_run_at: null })
      db.prepare(
        "INSERT INTO planning_rule_notices (id, project_id, work_item_id, rule_name, created_at) VALUES ('n1', 'p1', 't1', 'Rule', 1)"
      ).run()
      db.prepare("DELETE FROM planning_work_items WHERE id = 't1'").run()
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_rule_notices').get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })

  it('adds a resolution to a version 18 database, leaving its tasks open (N1.2)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 18))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at, archived_at) VALUES ('t1', 'p1', 'Kept', 'done', 'medium', 'human', 1, 1, 5)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(18)
    const db = new Database(dbPath)
    try {
      expect(
        db
          .prepare(
            'SELECT title, archived_at, resolution, resolution_reason FROM planning_work_items'
          )
          .all()
      ).toEqual([{ title: 'Kept', archived_at: 5, resolution: null, resolution_reason: '' }])
    } finally {
      db.close()
    }
  })

  it('adds show_from and someday to a version 19 database, every task shown (N1.1a)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 19))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Kept', 'backlog', 'medium', 'human', 1, 1)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(19)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT title, show_from, someday FROM planning_work_items').all()).toEqual(
        [{ title: 'Kept', show_from: null, someday: 0 }]
      )
    } finally {
      db.close()
    }
  })

  it('adds task templates to a version 20 database, for one project or every one (N2.1)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 20))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Kept', 'backlog', 'medium', 'human', 1, 1)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(20)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT title FROM planning_work_items').all()).toEqual([{ title: 'Kept' }])
      const insert = db.prepare(
        'INSERT INTO planning_task_templates (id, project_id, name, body, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)'
      )
      insert.run('a', 'p1', 'Mine', '{"title":"A"}')
      insert.run('b', null, 'Everyone', '{"title":"B"}')
      expect(
        db.prepare('SELECT id, project_id FROM planning_task_templates ORDER BY id').all()
      ).toEqual([
        { id: 'a', project_id: 'p1' },
        { id: 'b', project_id: null }
      ])
    } finally {
      db.close()
    }
  })

  it('adds My day entries to a version 21 database, one per task and day (N1.4)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 21))

    const result = await migrate()

    expect(result.from).toBe(21)
    const db = new Database(dbPath)
    try {
      const insert = db.prepare(
        'INSERT INTO my_day_entries (day, work_item_id, project_id, order_key, added_at) VALUES (?, ?, ?, ?, 1)'
      )
      insert.run('2026-10-16', 't1', 'p1', 'V')
      insert.run('2026-10-17', 't1', 'p1', 'V')
      expect(() => insert.run('2026-10-16', 't1', 'p1', 'W')).toThrow(/UNIQUE/)
      expect(db.prepare('SELECT day, released_at FROM my_day_entries ORDER BY day').all()).toEqual([
        { day: '2026-10-16', released_at: null },
        { day: '2026-10-17', released_at: null }
      ])
    } finally {
      db.close()
    }
  })

  it('adds finished weekly reviews and reminder weeks to a version 22 database (N1.5)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 22))

    const result = await migrate()

    expect(result.from).toBe(22)
    const db = new Database(dbPath)
    try {
      db.prepare("INSERT INTO weekly_reviews (id, finished_at) VALUES ('r1', 5)").run()
      expect(db.prepare('SELECT id, finished_at, steps FROM weekly_reviews').all()).toEqual([
        { id: 'r1', finished_at: 5, steps: '{}' }
      ])
      const insert = db.prepare(
        'INSERT INTO weekly_review_reminders (due_at, delivered_at) VALUES (?, ?)'
      )
      insert.run(100, 101)
      expect(() => insert.run(100, 102)).toThrow(/UNIQUE|PRIMARY/)
      expect(db.prepare('SELECT quiet FROM weekly_review_reminders').get()).toEqual({ quiet: 0 })
    } finally {
      db.close()
    }
  })

  it('adds keep reminding to the reminders of a version 23 database (N1.7)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 23))
    const before = new Database(dbPath)
    try {
      // The reminder needs no task for this check.
      before.pragma('foreign_keys = OFF')
      before
        .prepare(
          "INSERT INTO reminders (id, project_id, work_item_id, remind_at, kind) VALUES ('r', 'p', 'w', 10, 'custom')"
        )
        .run()
    } finally {
      before.close()
    }

    const result = await migrate()

    expect(result.from).toBe(23)
    const db = new Database(dbPath)
    try {
      // An existing reminder does not keep reminding.
      expect(
        db
          .prepare(
            'SELECT keep_reminding, interval_minutes, last_nudged_at, stopped_at FROM reminders'
          )
          .get()
      ).toEqual({
        keep_reminding: 0,
        interval_minutes: null,
        last_nudged_at: null,
        stopped_at: null
      })
    } finally {
      db.close()
    }
  })

  it('adds checklist item details to a version 24 database (N2.2)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 24))
    const before = new Database(dbPath)
    try {
      before.pragma('foreign_keys = OFF')
      before
        .prepare(
          "INSERT INTO planning_checklist_checks (work_item_id, project_id, criterion_text, checked_at) VALUES ('w', 'p', 'Book', 1)"
        )
        .run()
    } finally {
      before.close()
    }

    const result = await migrate()

    expect(result.from).toBe(24)
    const db = new Database(dbPath)
    try {
      // Existing ticks stay; no item has a date or person yet.
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_checklist_checks').get()).toEqual({
        n: 1
      })
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_checklist_details').get()).toEqual({
        n: 0
      })
      const columns = (
        db.prepare('PRAGMA table_info(planning_checklist_details)').all() as { name: string }[]
      ).map((column) => column.name)
      expect(columns).toEqual([
        'work_item_id',
        'project_id',
        'criterion_text',
        'due_date',
        'assignee_id'
      ])
    } finally {
      db.close()
    }
  })

  it('adds task links to a version 25 database (N2.4)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 25))

    const result = await migrate()

    expect(result.from).toBe(25)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_task_links').get()).toEqual({ n: 0 })
      const columns = (
        db.prepare('PRAGMA table_info(planning_task_links)').all() as { name: string }[]
      ).map((column) => column.name)
      expect(columns).toEqual([
        'id',
        'project_id',
        'from_work_item_id',
        'to_work_item_id',
        'kind',
        'created_at'
      ])
      // Deleting a task removes its links: tested through PlanningService.
      db.pragma('foreign_keys = OFF')
      const link = db.prepare(
        `INSERT INTO planning_task_links (id, project_id, from_work_item_id, to_work_item_id, kind, created_at)
         VALUES (?, 'p', ?, ?, ?, 1)`
      )
      link.run('l1', 'a', 'b', 'relates')
      // One link per pair and kind, whichever way round; never to itself.
      expect(() => link.run('l2', 'b', 'a', 'relates')).toThrow()
      expect(() => link.run('l3', 'a', 'a', 'duplicates')).toThrow()
      expect(() => link.run('l4', 'a', 'b', 'blocks')).toThrow()
      link.run('l5', 'b', 'a', 'duplicates')
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_task_links').get()).toEqual({ n: 2 })
    } finally {
      db.close()
    }
  })

  it('adds description versions to a version 26 database (N2.6)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 26))

    const result = await migrate()

    expect(result.from).toBe(26)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_description_versions').get()).toEqual({
        n: 0
      })
      const columns = (
        db.prepare('PRAGMA table_info(planning_description_versions)').all() as { name: string }[]
      ).map((column) => column.name)
      expect(columns).toEqual([
        'id',
        'project_id',
        'work_item_id',
        'text',
        'actor_kind',
        'actor_person_id',
        'rule_name',
        'started_at',
        'ended_at'
      ])
      // Deleting a task removes its versions: tested through PlanningService.
    } finally {
      db.close()
    }
  })

  it('adds take turns to the repeats of a version 27 database (N2.3)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 27))
    const before = new Database(dbPath)
    try {
      before.pragma('foreign_keys = OFF')
      before
        .prepare(
          `INSERT INTO planning_recurrences (work_item_id, project_id, rule, ends_on, remaining)
           VALUES ('w', 'p', '{"every":"week","interval":1}', NULL, NULL)`
        )
        .run()
    } finally {
      before.close()
    }

    const result = await migrate()

    expect(result.from).toBe(27)
    const db = new Database(dbPath)
    try {
      // An existing repeat keeps its rule and does not take turns.
      expect(
        db.prepare('SELECT rule, rotation, next_index FROM planning_recurrences').get()
      ).toEqual({ rule: '{"every":"week","interval":1}', rotation: null, next_index: 0 })
    } finally {
      db.close()
    }
  })

  it('adds task types to a version 28 database, leaving tasks with none (N2.7a)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 28))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Kept', 'ready', 'medium', 'human', 1, 1)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(28)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT title, type_id FROM planning_work_items').all()).toEqual([
        { title: 'Kept', type_id: null }
      ])
      const insert = db.prepare(
        'INSERT INTO planning_task_types (id, project_id, name, icon, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1)'
      )
      insert.run('y1', 'p1', 'Bug', 'bug', '#ef4444', 0)
      // Names are unique within a project, whatever their case.
      expect(() => insert.run('y2', 'p1', 'bug', 'bug', '#ef4444', 1)).toThrow()
      insert.run('y3', 'p2', 'Bug', 'bug', '#ef4444', 0)
    } finally {
      db.close()
    }
  })

  it('adds days off to a version 29 database, keeping its people (N3.2)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 29))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO people (id, name, initials, color, is_me, created_at, updated_at) VALUES ('sam', 'Sam', '', '#3b82f6', 0, 1, 1)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(29)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT name FROM people').all()).toEqual([{ name: 'Sam' }])
      const insert = db.prepare(
        'INSERT INTO days_off (id, person_id, first_date, last_date, name, source_file, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 1)'
      )
      insert.run('d1', null, '2026-12-25', '2026-12-25', 'Christmas Day', 'england.ics')
      insert.run('d2', 'sam', '2026-08-03', '2026-08-14', 'Leave', null)
      expect(
        db
          .prepare('SELECT id FROM days_off WHERE first_date <= ? AND last_date >= ? ORDER BY id')
          .all('2026-12-31', '2026-08-10')
      ).toEqual([{ id: 'd1' }, { id: 'd2' }])
    } finally {
      db.close()
    }
  })

  it('adds outside calendars to a version 30 database, keeping its days off (N3.3a)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 30))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO days_off (id, person_id, first_date, last_date, name, source_file, created_at, updated_at) VALUES ('d1', NULL, '2026-12-25', '2026-12-25', 'Christmas Day', NULL, 1, 1)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(30)
    const db = new Database(dbPath)
    try {
      db.pragma('foreign_keys = ON')
      expect(db.prepare('SELECT name FROM days_off').all()).toEqual([{ name: 'Christmas Day' }])
      db.prepare(
        "INSERT INTO outside_calendars (id, name, color, path, loaded_at, created_at, updated_at) VALUES ('c1', 'Work', '#3b82f6', 'C:\\work.ics', 1, 1, 1)"
      ).run()
      db.prepare(
        "INSERT INTO outside_calendar_events (id, calendar_id, title, start_at, end_at, first_date, last_date) VALUES ('e1', 'c1', 'Stand-up', '2026-10-19T09:30:00', '2026-10-19T09:45:00', '2026-10-18', NULL)"
      ).run()
      const row = db.prepare('SELECT kind, hidden, time_zones FROM outside_calendars').get()
      expect(row).toEqual({ kind: 'file', hidden: 0, time_zones: '[]' })
      // Removing a calendar removes its events.
      db.prepare("DELETE FROM outside_calendars WHERE id = 'c1'").run()
      expect(db.prepare('SELECT COUNT(*) AS n FROM outside_calendar_events').get()).toEqual({
        n: 0
      })
    } finally {
      db.close()
    }
  })

  it('adds time blocks to a version 31 database, keeping its tasks (N3.4a)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 31))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Kept', 'ready', 'medium', 'human', 1, 1)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(31)
    const db = new Database(dbPath)
    try {
      db.pragma('foreign_keys = ON')
      expect(db.prepare('SELECT title FROM planning_work_items').all()).toEqual([{ title: 'Kept' }])
      const insert = db.prepare(
        "INSERT INTO planning_time_blocks (id, project_id, work_item_id, day, start_minute, length_minutes, created_at) VALUES (?, 'p1', 't1', ?, ?, 60, 1)"
      )
      insert.run('b1', '2026-10-20', 600)
      insert.run('b2', '2026-10-19', 540)
      insert.run('b3', '2026-11-02', 540)
      expect(
        db
          .prepare(
            'SELECT id FROM planning_time_blocks WHERE day >= ? AND day <= ? ORDER BY day, start_minute'
          )
          .all('2026-10-19', '2026-10-25')
      ).toEqual([{ id: 'b2' }, { id: 'b1' }])
      // Deleting the task for good removes its blocks.
      db.prepare("DELETE FROM planning_work_items WHERE id = 't1'").run()
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_time_blocks').get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })

  it('makes every existing waits-on link finish to start with no lag (N7.2a)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 51))
    const before = new Database(dbPath)
    const task = before.prepare(
      "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES (?, 'p1', ?, 'ready', 'medium', 'human', 1, 1)"
    )
    task.run('t1', 'Plaster')
    task.run('t2', 'Paint')
    before
      .prepare(
        "INSERT INTO planning_dependencies (work_item_id, depends_on_id) VALUES ('t2', 't1')"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(51)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT * FROM planning_dependencies').all()).toEqual([
        { work_item_id: 't2', depends_on_id: 't1', type: 'finish-to-start', lag_days: 0 }
      ])
      const update = db.prepare('UPDATE planning_dependencies SET type = ?, lag_days = ?')
      update.run('start-to-start', -365)
      update.run('finish-to-finish', 365)
      expect(() => update.run('start-to-finish', 0)).toThrow()
      expect(() => update.run('finish-to-start', 366)).toThrow()
    } finally {
      db.close()
    }
  })

  it('adds baselines whose entries outlive their tasks (N7.4)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 52))
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Plaster', 'ready', 'medium', 'human', 1, 1)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(52)
    const db = new Database(dbPath)
    try {
      db.pragma('foreign_keys = ON')
      db.prepare(
        "INSERT INTO planning_baselines (id, project_id, name, saved_at) VALUES ('b1', 'p1', 'Plan agreed', 5)"
      ).run()
      db.prepare(
        "INSERT INTO planning_baseline_entries (baseline_id, project_id, kind, item_id, start_date, due_date) VALUES ('b1', 'p1', 'task', 't1', '2026-10-01', '2026-10-05')"
      ).run()
      expect(() =>
        db
          .prepare(
            "INSERT INTO planning_baselines (id, project_id, name, saved_at) VALUES ('b2', 'p1', ?, 5)"
          )
          .run('x'.repeat(81))
      ).toThrow()
      expect(() =>
        db
          .prepare(
            "INSERT INTO planning_baseline_entries (baseline_id, project_id, kind, item_id) VALUES ('b1', 'p1', 'goal', 'g1')"
          )
          .run()
      ).toThrow()
      // Deleting the task keeps its entry; deleting the baseline takes its entries.
      db.prepare("DELETE FROM planning_work_items WHERE id = 't1'").run()
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_baseline_entries').get()).toEqual({
        n: 1
      })
      db.prepare("DELETE FROM planning_baselines WHERE id = 'b1'").run()
      expect(db.prepare('SELECT COUNT(*) AS n FROM planning_baseline_entries').get()).toEqual({
        n: 0
      })
    } finally {
      db.close()
    }
  })

  it('adds AI field instructions and who filled each value, the person by default (N8.4)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 53))
    const before = new Database(dbPath)
    before.exec(`
      INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
        VALUES ('t1', 'p1', 'Paint', 'ready', 'medium', 'human', 1, 1);
      INSERT INTO planning_fields (id, project_id, name, type, options, position, created_at)
        VALUES ('f1', 'p1', 'Room', 'text', '[]', 0, 1);
      INSERT INTO planning_field_values (project_id, work_item_id, field_id, text_value)
        VALUES ('p1', 't1', 'f1', 'Hall');
    `)
    before.close()

    const result = await migrate()

    expect(result.from).toBe(53)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT ai_instruction, ai_auto_fill FROM planning_fields').get()).toEqual({
        ai_instruction: null,
        ai_auto_fill: 0
      })
      expect(db.prepare('SELECT filled_by, source_hash FROM planning_field_values').get()).toEqual({
        filled_by: 'person',
        source_hash: null
      })
      const instruct = db.prepare("UPDATE planning_fields SET ai_instruction = ? WHERE id = 'f1'")
      instruct.run('Which room is this for?')
      expect(() => instruct.run('x'.repeat(501))).toThrow()
      expect(() => instruct.run('  ')).toThrow()
      expect(() =>
        db.prepare("UPDATE planning_field_values SET filled_by = 'agent'").run()
      ).toThrow()
    } finally {
      db.close()
    }
  })

  it('creates the sync tables and indexes, and accepts only upsert or delete as an outbox op (S2)', async () => {
    await migrate()
    const db = new Database(dbPath)
    try {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sync_%' ORDER BY name"
        )
        .all()
      expect(tables).toEqual([
        { name: 'sync_applied' },
        { name: 'sync_field_stamps' },
        { name: 'sync_identity' },
        { name: 'sync_keys' },
        { name: 'sync_member_capabilities' },
        { name: 'sync_members' },
        { name: 'sync_outbox' },
        { name: 'sync_pending' },
        { name: 'sync_person' },
        { name: 'sync_person_link_answers' },
        { name: 'sync_records' },
        { name: 'sync_role_files' },
        { name: 'sync_roles' },
        { name: 'sync_server' },
        { name: 'sync_settings' },
        { name: 'sync_shares' }
      ])
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_sync_%' ORDER BY name"
        )
        .all()
      expect(indexes).toEqual([
        { name: 'idx_sync_field_stamps_project' },
        { name: 'idx_sync_outbox_project' },
        { name: 'idx_sync_pending_waiting' },
        { name: 'idx_sync_shares_one_personal' }
      ])

      const insert = db.prepare(
        "INSERT INTO sync_outbox (project_id, table_name, row_key, op, columns, stamp, actor_kind, created_at) VALUES ('p1', 'planning_work_items', 't1', ?, '{}', 's1', 'human', 1)"
      )
      expect(() => insert.run('update')).toThrow(/CHECK constraint failed/)
      expect(() => insert.run('upsert')).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('adds the person key and the member certificate columns to a version 68 database, keeping its members (people and devices, D4)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 68))
    const before = new Database(dbPath)
    before.exec(`
      INSERT INTO sync_members (share_id, member_id, name, public_key, joined_at)
        VALUES ('s1', 'm1', 'Ann', 'pub-ann', 1);
    `)
    before.close()

    const result = await migrate()

    expect(result.from).toBe(68)
    const db = new Database(dbPath)
    try {
      const columns = (table: string) =>
        (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
      expect(columns('sync_person')).toEqual([
        'id',
        'public_key',
        'private_key',
        'created_at',
        'source'
      ])
      expect(columns('sync_members')).toEqual(
        expect.arrayContaining(['person_public_key', 'certificate'])
      )
      // Migration 70 (run here too) gives the member its device key as its person.
      expect(
        db.prepare('SELECT name, person_public_key, certificate FROM sync_members').get()
      ).toEqual({ name: 'Ann', person_public_key: 'pub-ann', certificate: null })

      const person = db.prepare(
        "INSERT INTO sync_person (id, public_key, private_key, created_at, source) VALUES (?, 'pub', 'priv', 1, ?)"
      )
      expect(() => person.run(2, 'made')).toThrow(/CHECK constraint failed/)
      expect(() => person.run(1, 'borrowed')).toThrow(/CHECK constraint failed/)
      expect(() => person.run(1, 'paired')).not.toThrow()
      expect(() => person.run(1, 'made')).toThrow(/UNIQUE constraint failed/)
    } finally {
      db.close()
    }
  })

  it('adds the Me card to members and gives older members their device key as their person (people and devices, D5)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 69))
    const before = new Database(dbPath)
    before.exec(`
      INSERT INTO sync_members (share_id, member_id, name, public_key, joined_at)
        VALUES ('s1', 'm1', 'Ann', 'pub-ann', 1);
    `)
    before.close()

    const result = await migrate()

    expect(result.from).toBe(69)
    const db = new Database(dbPath)
    try {
      const columns = (
        db.prepare('PRAGMA table_info(sync_members)').all() as { name: string }[]
      ).map((c) => c.name)
      expect(columns).toContain('me')
      expect(db.prepare('SELECT name, person_public_key, me FROM sync_members').get()).toEqual({
        name: 'Ann',
        person_public_key: 'pub-ann',
        me: null
      })
    } finally {
      db.close()
    }
  })

  it('adds the answers to "Is this Bob?" and accepts only yes or no (people and devices, D12)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 70))
    const before = new Database(dbPath)
    before.close()

    const result = await migrate()

    expect(result.from).toBe(70)
    const db = new Database(dbPath)
    try {
      const insert = db.prepare(
        "INSERT INTO sync_person_link_answers (share_id, person_public_key, candidate_person_id, answer, answered_at) VALUES ('s1', 'pub-ann', 'p1', ?, 1)"
      )
      expect(() => insert.run('maybe')).toThrow(/CHECK constraint failed/)
      expect(() => insert.run('yes')).not.toThrow()
      expect(() => insert.run('no')).toThrow(/UNIQUE constraint failed/)
    } finally {
      db.close()
    }
  })

  it('keeps who made a waiting change (people and devices, D10)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 71))
    const before = new Database(dbPath)
    before.close()

    const result = await migrate()

    expect(result.from).toBe(71)
    const db = new Database(dbPath)
    try {
      const columns = db.prepare('PRAGMA table_info(sync_pending)').all() as { name: string }[]
      expect(columns.map((column) => column.name)).toContain('actor')
    } finally {
      db.close()
    }
  })

  it('gives every existing person of a share the Owner role, and adds the role tables (people and devices, D6)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 72))
    const before = new Database(dbPath)
    try {
      before.exec(`
        INSERT INTO sync_members (share_id, member_id, name, public_key, joined_at, person_public_key) VALUES
          ('s1', 'm-ann-pc', 'Ann', 'dev-ann', 1, 'person-ann'),
          ('s1', 'm-ann-laptop', 'Ann laptop', 'dev-ann-2', 1, 'person-ann'),
          ('s1', 'm-bob', 'Bob', 'dev-bob', 2, 'person-bob');
        INSERT INTO sync_members (share_id, member_id, name, public_key, joined_at, person_public_key, removed_at) VALUES
          ('s1', 'm-gone', 'Gone', 'dev-gone', 3, 'person-gone', 4);
      `)
    } finally {
      before.close()
    }

    const result = await migrate()

    expect(result.from).toBe(72)
    const db = new Database(dbPath)
    try {
      expect(
        db
          .prepare(
            'SELECT person_public_key, role FROM sync_roles WHERE share_id = ? ORDER BY person_public_key'
          )
          .all('s1')
      ).toEqual([
        { person_public_key: 'person-ann', role: 'owner' },
        { person_public_key: 'person-bob', role: 'owner' }
      ])
      const insert = db.prepare(
        "INSERT INTO sync_roles (share_id, person_public_key, role, since_stamp) VALUES ('s1', 'person-cy', ?, '0')"
      )
      expect(() => insert.run('admin')).toThrow(/CHECK constraint failed/)
      expect(() => insert.run('viewer')).not.toThrow()
      const file = db.prepare(
        "INSERT INTO sync_role_files (share_id, path, stamp, applied) VALUES ('s1', 'roles/x.ostlerrole', 's', ?)"
      )
      expect(() => file.run(2)).toThrow(/CHECK constraint failed/)
      expect(() => file.run(1)).not.toThrow()
    } finally {
      db.close()
    }
  })

  it("adds this PC's own role to each share, Owner until roles are read (people and devices, D9)", async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 73))
    const before = new Database(dbPath)
    try {
      before.exec(`
        INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at)
        VALUES ('p1', 's1', 'C:/share', 'm1', 'dev-me', 1, 1);
      `)
    } finally {
      before.close()
    }

    const result = await migrate()

    expect(result.from).toBe(73)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT my_role FROM sync_shares WHERE project_id = ?').get('p1')).toEqual({
        my_role: 'owner'
      })
      expect(() =>
        db.prepare("UPDATE sync_shares SET my_role = 'admin' WHERE project_id = 'p1'").run()
      ).toThrow(/CHECK constraint failed/)
      db.prepare("UPDATE sync_shares SET my_role = 'viewer' WHERE project_id = 'p1'").run()
      expect(db.prepare('SELECT my_role FROM sync_shares WHERE project_id = ?').get('p1')).toEqual({
        my_role: 'viewer'
      })
    } finally {
      db.close()
    }
  })

  it('adds the kind of each share, and allows one personal share at most (people and devices, D13)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 74))
    const before = new Database(dbPath)
    try {
      before.exec(`
        INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at)
        VALUES ('p1', 's1', 'C:/share', 'm1', 'dev-me', 1, 1);
      `)
    } finally {
      before.close()
    }

    const result = await migrate()

    expect(result.from).toBe(74)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT kind FROM sync_shares WHERE project_id = ?').get('p1')).toEqual({
        kind: 'project'
      })
      const share = db.prepare(
        `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at, kind)
         VALUES (?, ?, 'C:/personal', 'm1', 'dev-me', 1, 1, 'personal')`
      )
      expect(() =>
        db.prepare("UPDATE sync_shares SET kind = 'group' WHERE project_id = 'p1'").run()
      ).toThrow(/CHECK constraint failed/)
      share.run('~personal', 's-personal')
      expect(() => share.run('~personal-2', 's-personal-2')).toThrow(/UNIQUE constraint failed/)
    } finally {
      db.close()
    }
  })

  it('adds the invite a joined share was joined with, for the personal share entries (people and devices, D17)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 76))
    const before = new Database(dbPath)
    try {
      before.exec(`
        INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at)
        VALUES ('p-1', 's-1', 'C:/shared', 'm-1', 'dev-1', 1, 1);
      `)
    } finally {
      before.close()
    }

    const result = await migrate()

    expect(result.from).toBe(76)
    const db = new Database(dbPath)
    try {
      // A share from before the migration has no stored invite; its entry is made from its key instead.
      expect(db.prepare('SELECT joined_invite FROM sync_shares').get()).toEqual({
        joined_invite: null
      })
    } finally {
      db.close()
    }
  })

  it('adds the per-setting record of settings sync and the device that runs each write-back mirror (people and devices, D3, D18)', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 75))
    const before = new Database(dbPath)
    try {
      before.exec(`
        INSERT INTO calendar_write_target (id, account_id, remote_calendar, name)
        VALUES (1, 'acc-1', 'cal-1', 'Work');
      `)
    } finally {
      before.close()
    }

    const result = await migrate()

    expect(result.from).toBe(75)
    const db = new Database(dbPath)
    try {
      // A row from before the migration has no device yet; the mirror claims it on its first read.
      expect(db.prepare('SELECT device_id FROM calendar_write_target').get()).toEqual({
        device_id: null
      })
      db.prepare('UPDATE task_list_target SET device_id = ?').run('dev-a')
      db.prepare(
        "INSERT INTO sync_settings (share_id, setting, stamp, hash) VALUES ('s-personal', 'ui', 'st', 'h')"
      ).run()
      expect(() =>
        db
          .prepare(
            "INSERT INTO sync_settings (share_id, setting, stamp, hash) VALUES ('s-personal', 'ui', 'st2', 'h2')"
          )
          .run()
      ).toThrow(/UNIQUE constraint failed/)
    } finally {
      db.close()
    }
  })

  it('adds whiteboard objects, which go with their whiteboard (whiteboards, D5)', async () => {
    await migrate()
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(80)
    const db = new Database(dbPath)
    try {
      db.pragma('foreign_keys = ON')
      const indexes = (
        db.prepare('PRAGMA index_list(whiteboard_objects)').all() as { name: string }[]
      ).map((index) => index.name)
      expect(indexes).toEqual(
        expect.arrayContaining([
          'idx_whiteboard_objects_whiteboard',
          'idx_whiteboard_objects_project'
        ])
      )
      db.prepare(
        `INSERT INTO library_items (id, project_id, kind, title, summary, body, ai_access,
           is_primary_brief, tags_json, revision, created_at, updated_at)
         VALUES ('w1', 'p1', 'whiteboard', 'Plan', '', '', 'when-selected', 0, '[]', 1, 't', 't')`
      ).run()
      const insert = db.prepare(
        `INSERT INTO whiteboard_objects (id, project_id, whiteboard_id, kind, x, y, width, height,
           colour, created_at, updated_at)
         VALUES (?, 'p1', ?, 'note', 0, 0, 200, 200, 'yellow', 't', 't')`
      )
      expect(() => insert.run('o0', 'missing')).toThrow(/FOREIGN KEY constraint failed/)
      insert.run('o1', 'w1')
      insert.run('o2', 'w1')
      const row = db
        .prepare("SELECT z, text, link, data_json FROM whiteboard_objects WHERE id = 'o1'")
        .get()
      expect(row).toEqual({ z: 0, text: '', link: null, data_json: '{}' })
      db.prepare("DELETE FROM library_items WHERE id = 'w1'").run()
      expect(db.prepare('SELECT COUNT(*) AS n FROM whiteboard_objects').get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })

  it('adds connected accounts and app registrations (integrations phase 0)', async () => {
    await migrate()
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(63)
    const db = new Database(dbPath)
    try {
      const insert = db.prepare(
        `INSERT INTO connected_accounts (id, provider, label, secret, status, created_at, updated_at)
         VALUES (?, ?, 'ann@example.com', 'sealed', ?, 1, 1)`
      )
      expect(() => insert.run('a1', 'yahoo', 'connected')).toThrow(/CHECK constraint failed/)
      expect(() => insert.run('a1', 'google', 'broken')).toThrow(/CHECK constraint failed/)
      expect(() => insert.run('a1', 'google', 'connected')).not.toThrow()
      const app = db.prepare(
        "INSERT INTO account_apps (provider, client_id, updated_at) VALUES (?, 'id', 1)"
      )
      expect(() => app.run('caldav')).toThrow(/CHECK constraint failed/)
      expect(() => app.run('microsoft')).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('adds encryption keys, key generations and removed members (S7d)', async () => {
    await migrate()
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(62)
    const db = new Database(dbPath)
    try {
      const columns = (table: string) =>
        (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
      expect(columns('sync_identity')).toEqual(
        expect.arrayContaining(['box_public_key', 'box_private_key'])
      )
      expect(columns('sync_members')).toEqual(
        expect.arrayContaining(['box_public_key', 'removed_at', 'removed_cutoffs'])
      )
      expect(columns('sync_shares')).toEqual(
        expect.arrayContaining(['key_generation', 'rotations_read'])
      )
      const insert = db.prepare(
        "INSERT INTO sync_keys (share_id, generation, project_key) VALUES ('s1', ?, 'k')"
      )
      expect(() => insert.run(-1)).toThrow(/CHECK constraint failed/)
      expect(() => insert.run(0)).not.toThrow()
      expect(() => insert.run(0)).toThrow(/UNIQUE constraint failed/)
    } finally {
      db.close()
    }
  })

  it('keeps one sync record per share, kind and record (S10c)', async () => {
    await migrate()
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(61)
    const db = new Database(dbPath)
    try {
      const insert = db.prepare(
        "INSERT INTO sync_records (share_id, kind, record_id, stamp, hash) VALUES ('s1', ?, 'p1', 'x', 'h')"
      )
      expect(() => insert.run('contact')).toThrow(/CHECK constraint failed/)
      expect(() => insert.run('person')).not.toThrow()
      expect(() => insert.run('person')).toThrow(/UNIQUE constraint failed/)
      expect(() => insert.run('project')).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('adds key storage and a project column on field stamps (S6d)', async () => {
    await migrate()
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(60)
    const db = new Database(dbPath)
    try {
      const columns = (table: string) =>
        (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
      expect(columns('sync_shares')).toContain('project_key')
      expect(columns('sync_field_stamps')).toContain('project_id')
      expect(columns('sync_identity').slice(0, 4)).toEqual([
        'id',
        'public_key',
        'private_key',
        'created_at'
      ])

      const identity = db.prepare(
        "INSERT INTO sync_identity (id, public_key, private_key, created_at) VALUES (?, 'pub', 'priv', 1)"
      )
      expect(() => identity.run(2)).toThrow(/CHECK constraint failed/)
      expect(() => identity.run(1)).not.toThrow()
      expect(() => identity.run(1)).toThrow(/UNIQUE constraint failed/)
    } finally {
      db.close()
    }
  })

  it('refuses a file written by a newer build and leaves it untouched', async () => {
    const db = new Database(dbPath)
    db.exec('CREATE TABLE future (id TEXT)')
    db.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`)
    db.close()
    const bytes = fs.readFileSync(dbPath)
    const filesBefore = fs.readdirSync(tempDir())

    await expect(migrate()).rejects.toBeInstanceOf(DatabaseTooNewError)

    expect(fs.readFileSync(dbPath).equals(bytes)).toBe(true)
    expect(fs.readdirSync(tempDir())).toEqual(filesBefore)
    expect(userVersion(dbPath)).toBe(LATEST_SCHEMA_VERSION + 1)
  })

  it('rolls back a migration that throws, leaving version and data unchanged', async () => {
    await migrate()
    const db = new Database(dbPath)
    db.prepare(
      "INSERT INTO planning_goals (id, project_id, title, status, created_at, updated_at) VALUES ('g', 'p', 'Keep me', 'active', 1, 1)"
    ).run()
    db.close()

    const broken: Migration = {
      version: LATEST_SCHEMA_VERSION + 1,
      name: 'broken',
      up(target) {
        target.exec("UPDATE planning_goals SET title = 'Changed'")
        target.exec('CREATE TABLE half_done (id TEXT)')
        throw new Error('migration failed part-way')
      }
    }

    await expect(migrate([...MIGRATIONS, broken])).rejects.toThrow('migration failed part-way')

    expect(userVersion(dbPath)).toBe(LATEST_SCHEMA_VERSION)
    expect(userTables(dbPath)).not.toContain('half_done')
    const check = new Database(dbPath, { readonly: true })
    try {
      expect(check.prepare('SELECT title FROM planning_goals').get()).toEqual({ title: 'Keep me' })
    } finally {
      check.close()
    }
  })

  it('drops owner_only from a version 92 database and keeps blocked_reason', async () => {
    await migrate(MIGRATIONS.filter((migration) => migration.version <= 92))
    const columns = (): string[] => {
      const db = new Database(dbPath)
      try {
        return (
          db.prepare('PRAGMA table_info(planning_work_items)').all() as { name: string }[]
        ).map((column) => column.name)
      } finally {
        db.close()
      }
    }
    expect(columns()).toContain('owner_only')

    await migrate()

    expect(userVersion(dbPath)).toBe(LATEST_SCHEMA_VERSION)
    expect(columns()).not.toContain('owner_only')
    expect(columns()).toContain('blocked_reason')
  })

  it('does not migrate when the backup cannot be written', async () => {
    writePreRunnerDatabase(dbPath)
    // A file where the backup folder should be makes the backup fail.
    fs.writeFileSync(backupDir, 'not a folder')

    await expect(migrate()).rejects.toThrow(/Could not back up/)

    expect(userVersion(dbPath)).toBe(0)
    expect(userTables(dbPath)).toContain('projects')
  })
})
