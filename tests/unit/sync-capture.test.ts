import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { observeRemoteStamp, withSyncApplying } from '../../electron/services/sync/capture'
import { recordChanges } from '../../electron/services/change-history/context'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const SHARED = 'shared-project'
const OTHER = 'other-project'

interface FieldStampRow {
  table_name: string
  row_key: string
  column_name: string
  stamp: string
  project_id: string | null
}

interface OutboxRow {
  project_id: string
  table_name: string
  row_key: string
  op: 'upsert' | 'delete'
  columns: string
  stamp: string
  actor_kind: string
}

describe('sync capture triggers', () => {
  const tempDir = useTempDir('ostler-sync-capture-')
  let db: Database.Database

  beforeEach(async () => {
    const dbPath = await createMigratedDatabase(tempDir())
    db = new Database(dbPath)
    db.prepare(
      `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at)
       VALUES (?, 'share-1', 'x', 'm1', 'dev-a', 1, 1)`
    ).run(SHARED)
    attachChangeRecorder(db)
  })

  afterEach(() => {
    db.close()
  })

  const insertItem = (id: string, projectId: string, title: string) =>
    db
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
      )
      .run(id, projectId, title)

  const outbox = (): OutboxRow[] =>
    db.prepare('SELECT * FROM sync_outbox ORDER BY id').all() as OutboxRow[]

  const fieldStamps = (): FieldStampRow[] =>
    db.prepare('SELECT * FROM sync_field_stamps ORDER BY column_name').all() as FieldStampRow[]

  const stampOf = (column: string): string | undefined =>
    fieldStamps().find((row) => row.column_name === column)?.stamp

  it('captures an insert into the shared project only, as a whole-row upsert', () => {
    insertItem('item-1', SHARED, 'Paint hall')
    const rows = outbox()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      project_id: SHARED,
      table_name: 'planning_work_items',
      row_key: '["item-1"]',
      op: 'upsert',
      actor_kind: 'system'
    })
    expect(rows[0].stamp.endsWith('-dev-a')).toBe(true)
    expect(JSON.parse(rows[0].columns).title).toBe('Paint hall')

    insertItem('item-2', OTHER, 'Not shared')
    expect(outbox()).toHaveLength(1)
  })

  it('captures an update as the changed columns, and a delete as an empty delete', () => {
    insertItem('item-1', SHARED, 'Paint hall')
    db.prepare('UPDATE planning_work_items SET title = ? WHERE id = ?').run(
      'Paint the hall',
      'item-1'
    )
    db.prepare('DELETE FROM planning_work_items WHERE id = ?').run('item-1')

    const [, update, remove] = outbox()
    expect(update.op).toBe('upsert')
    expect(JSON.parse(update.columns)).toEqual({ title: 'Paint the hall' })
    expect(remove).toMatchObject({ op: 'delete', row_key: '["item-1"]', columns: '{}' })
    const stamps = outbox().map((row) => row.stamp)
    expect([...stamps].sort()).toEqual(stamps)
  })

  it('captures nothing inside withSyncApplying', () => {
    insertItem('item-1', SHARED, 'Paint hall')
    const before = outbox().length
    withSyncApplying(() =>
      db
        .prepare('UPDATE planning_work_items SET title = ? WHERE id = ?')
        .run('From another PC', 'item-1')
    )
    expect(outbox()).toHaveLength(before)
  })

  it('captures a dependency in the shared project, found through its work item', () => {
    insertItem('item-1', SHARED, 'First')
    insertItem('item-2', SHARED, 'Second')
    insertItem('item-3', OTHER, 'Elsewhere')
    insertItem('item-4', OTHER, 'Elsewhere too')
    const before = outbox().length
    db.prepare('INSERT INTO planning_dependencies (work_item_id, depends_on_id) VALUES (?, ?)').run(
      'item-2',
      'item-1'
    )
    db.prepare('INSERT INTO planning_dependencies (work_item_id, depends_on_id) VALUES (?, ?)').run(
      'item-4',
      'item-3'
    )
    const added = outbox().slice(before)
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({
      project_id: SHARED,
      table_name: 'planning_dependencies',
      op: 'upsert'
    })
  })

  it('leaves no sync row behind when a shared project with changes is deleted', () => {
    insertItem('item-1', SHARED, 'Paint hall')
    db.prepare('UPDATE planning_work_items SET title = ? WHERE id = ?').run(
      'Paint the hall',
      'item-1'
    )
    db.prepare(
      `INSERT INTO sync_members (share_id, member_id, person_id, name, public_key, joined_at)
       VALUES ('share-1', 'm1', NULL, 'Ann', 'key', 1)`
    ).run()
    db.prepare(
      "INSERT INTO sync_applied (share_id, device_id, last_sequence) VALUES ('share-1', 'dev-b', 3)"
    ).run()
    db.prepare(
      `INSERT INTO sync_pending (share_id, table_name, row_key, op, columns, stamp, waiting_for, received_at)
       VALUES ('share-1', 'planning_work_items', '["x"]', 'upsert', '{}', 's', 'parent', 1)`
    ).run()
    expect(fieldStamps().length).toBeGreaterThan(0)

    deleteProjectRows(db, SHARED)

    const count = (table: string) =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    for (const table of [
      'sync_shares',
      'sync_members',
      'sync_outbox',
      'sync_field_stamps',
      'sync_applied',
      'sync_pending'
    ]) {
      expect(count(table), table).toBe(0)
    }
  })

  it('names Me as the actor of a change made by a person, and nobody for a system change', async () => {
    db.prepare(
      `INSERT INTO people (id, name, initials, color, is_me, created_at, updated_at)
       VALUES ('me', 'Ann', 'AN', '#123456', 1, 1, 1)`
    ).run()
    await recordChanges('test', async () => insertItem('item-1', SHARED, 'Paint hall'))
    insertItem('item-2', SHARED, 'Fix door')
    expect(
      db.prepare('SELECT row_key, actor_kind, actor_person_id FROM sync_outbox ORDER BY id').all()
    ).toEqual([
      { row_key: '["item-1"]', actor_kind: 'human', actor_person_id: 'me' },
      { row_key: '["item-2"]', actor_kind: 'system', actor_person_id: null }
    ])
  })

  it('records a field stamp for every column of an insert, all equal to its outbox stamp', () => {
    insertItem('item-1', SHARED, 'Paint hall')
    const [row] = outbox()
    const columns = Object.keys(JSON.parse(row.columns)).sort()
    expect(columns).toContain('title')
    expect(columns).toContain('status')

    const stamps = fieldStamps()
    expect(stamps.map((field) => field.column_name)).toEqual(columns)
    for (const field of stamps) {
      expect(field).toMatchObject({
        table_name: 'planning_work_items',
        row_key: row.row_key,
        stamp: row.stamp,
        project_id: SHARED
      })
    }
  })

  it('stamps only the changed column on an update', () => {
    insertItem('item-1', SHARED, 'Paint hall')
    const [first] = outbox()
    db.prepare('UPDATE planning_work_items SET title = ? WHERE id = ?').run(
      'Paint the hall',
      'item-1'
    )
    const [, second] = outbox()

    expect(stampOf('title')).toBe(second.stamp)
    expect(stampOf('status')).toBe(first.stamp)
  })

  it('records a single whole-row stamp for a delete', () => {
    insertItem('item-1', SHARED, 'Paint hall')
    db.prepare('DELETE FROM planning_work_items WHERE id = ?').run('item-1')
    const [, remove] = outbox()

    const wholeRow = fieldStamps().filter((field) => field.column_name === '*')
    expect(wholeRow).toEqual([
      {
        table_name: 'planning_work_items',
        row_key: '["item-1"]',
        column_name: '*',
        stamp: remove.stamp,
        project_id: SHARED
      }
    ])
  })

  it('records no field stamps for unshared projects or inside withSyncApplying', () => {
    insertItem('item-2', OTHER, 'Not shared')
    withSyncApplying(() => insertItem('item-1', SHARED, 'From another PC'))
    expect(fieldStamps()).toEqual([])
  })

  it('stamps later local changes after an observed remote stamp', () => {
    const remote = '900000000000000-000000-remote'
    observeRemoteStamp(remote)
    insertItem('item-1', SHARED, 'After remote')
    const [row] = outbox()

    expect(row.stamp.endsWith('-dev-a')).toBe(true)
    expect(row.stamp > remote).toBe(true)
  })
})
