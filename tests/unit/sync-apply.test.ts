import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { applyChanges } from '../../electron/services/sync/apply'
import type { SyncChange } from '../../electron/services/sync/change-file'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const SHARED = 'shared-project'
const OTHER = 'other-project'

const at = (n: number) => `${String(n).padStart(15, '0')}-000000-dev-b`

const itemColumns = (id: string, projectId: string, title: string) => ({
  id,
  project_id: projectId,
  title,
  status: 'ready',
  priority: 'medium',
  origin: 'human',
  created_at: 1,
  updated_at: 1
})

const itemChange = (
  id: string,
  op: 'upsert' | 'delete',
  columns: Record<string, unknown>,
  stamp: string
): SyncChange => ({
  table: 'planning_work_items',
  rowKey: JSON.stringify([id]),
  op,
  columns,
  stamp,
  actor: { kind: 'human' }
})

/** The lists applyChanges returns besides its counts, empty when no change touched them. */
const NOTHING_ELSE = { assigned: [], changed: [], mentioned: [], signOffs: [] }

describe('applying sync changes', () => {
  const tempDir = useTempDir('ostler-sync-apply-')
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

  const titleOf = (id: string): string | undefined =>
    (
      db.prepare('SELECT title FROM planning_work_items WHERE id = ?').get(id) as
        { title: string } | undefined
    )?.title

  const exists = (id: string): boolean => titleOf(id) !== undefined

  const outboxCount = (): number =>
    (db.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get() as { n: number }).n

  const tombstones = (id: string): number =>
    (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM sync_field_stamps WHERE table_name = 'planning_work_items' AND row_key = ? AND column_name = '*'"
        )
        .get(JSON.stringify([id])) as { n: number }
    ).n

  it('inserts a new row and leaves nothing in the outbox', () => {
    const result = applyChanges(db, 'share-1', [
      itemChange('item-1', 'upsert', itemColumns('item-1', SHARED, 'Paint hall'), at(10))
    ])

    expect(result).toEqual({ applied: 1, skipped: 0, pending: 0, ...NOTHING_ELSE })
    expect(titleOf('item-1')).toBe('Paint hall')
    expect(outboxCount()).toBe(0)
  })

  it('records the share project on every field stamp it writes, tombstones included', () => {
    applyChanges(db, 'share-1', [
      itemChange('item-1', 'upsert', itemColumns('item-1', SHARED, 'Paint hall'), at(10)),
      itemChange('item-2', 'delete', {}, at(20))
    ])

    const projects = db.prepare('SELECT DISTINCT project_id FROM sync_field_stamps').all() as {
      project_id: string | null
    }[]
    expect(projects).toEqual([{ project_id: SHARED }])
    expect(tombstones('item-2')).toBe(1)
  })

  it('keeps the later stamp per field, so edits to different fields all survive', () => {
    applyChanges(db, 'share-1', [
      itemChange('item-1', 'upsert', itemColumns('item-1', SHARED, 'A'), at(10))
    ])
    applyChanges(db, 'share-1', [itemChange('item-1', 'upsert', { title: 'B' }, at(30))])
    applyChanges(db, 'share-1', [
      itemChange('item-1', 'upsert', { title: 'C', status: 'done' }, at(20))
    ])

    const row = db
      .prepare('SELECT title, status FROM planning_work_items WHERE id = ?')
      .get('item-1') as { title: string; status: string }
    expect(row).toEqual({ title: 'B', status: 'done' })
  })

  it('lets a delete remove the row, and blocks older upserts until a newer one re-creates it', () => {
    applyChanges(db, 'share-1', [
      itemChange('item-1', 'upsert', itemColumns('item-1', SHARED, 'A'), at(10))
    ])
    applyChanges(db, 'share-1', [itemChange('item-1', 'delete', {}, at(20))])
    expect(exists('item-1')).toBe(false)
    expect(tombstones('item-1')).toBe(1)

    const older = applyChanges(db, 'share-1', [
      itemChange('item-1', 'upsert', { title: 'X' }, at(15))
    ])
    expect(older).toEqual({ applied: 0, skipped: 1, pending: 0, ...NOTHING_ELSE })
    expect(exists('item-1')).toBe(false)

    applyChanges(db, 'share-1', [
      itemChange('item-1', 'upsert', itemColumns('item-1', SHARED, 'Back'), at(30))
    ])
    expect(titleOf('item-1')).toBe('Back')
  })

  it('writes a tombstone for a delete of a row that is not here, so an older row is skipped', () => {
    const result = applyChanges(db, 'share-1', [itemChange('item-1', 'delete', {}, at(20))])
    expect(result.applied).toBe(1)
    expect(tombstones('item-1')).toBe(1)

    const late = applyChanges(db, 'share-1', [
      itemChange('item-1', 'upsert', itemColumns('item-1', SHARED, 'Late'), at(5))
    ])
    expect(late).toEqual({ applied: 0, skipped: 1, pending: 0, ...NOTHING_ELSE })
    expect(exists('item-1')).toBe(false)
  })

  it('skips rows of another project and unknown tables', () => {
    const result = applyChanges(db, 'share-1', [
      itemChange('item-1', 'upsert', itemColumns('item-1', OTHER, 'Elsewhere'), at(10)),
      {
        table: 'not_a_synced_table',
        rowKey: JSON.stringify(['x']),
        op: 'upsert',
        columns: { id: 'x', project_id: SHARED },
        stamp: at(11),
        actor: { kind: 'human' }
      }
    ])

    expect(result).toEqual({ applied: 0, skipped: 2, pending: 0, ...NOTHING_ELSE })
    expect(exists('item-1')).toBe(false)
  })

  it('holds a comment until its work item arrives, then applies it', () => {
    const comment: SyncChange = {
      table: 'planning_comments',
      rowKey: JSON.stringify(['comment-1']),
      op: 'upsert',
      columns: {
        id: 'comment-1',
        project_id: SHARED,
        work_item_id: 'item-1',
        author_kind: 'human',
        body: 'Looks good',
        created_at: 2,
        updated_at: 2
      },
      stamp: at(20),
      actor: { kind: 'human' }
    }

    const first = applyChanges(db, 'share-1', [comment])
    expect(first).toEqual({ applied: 0, skipped: 0, pending: 1, ...NOTHING_ELSE })
    const commentCount = () =>
      (db.prepare('SELECT COUNT(*) AS n FROM planning_comments').get() as { n: number }).n
    expect(commentCount()).toBe(0)

    const second = applyChanges(db, 'share-1', [
      itemChange('item-1', 'upsert', itemColumns('item-1', SHARED, 'Parent'), at(10))
    ])
    expect(second).toEqual({
      applied: 2,
      skipped: 0,
      pending: 0,
      ...NOTHING_ELSE,
      // The comment counts as a change to its task, for the task's followers.
      changed: [{ projectId: SHARED, taskId: 'item-1', byPersonId: null }]
    })
    expect(commentCount()).toBe(1)
  })

  it('keeps a local value that is newer than the incoming change', () => {
    db.prepare(
      `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
       VALUES ('item-1', ?, 'Local', 'ready', 'medium', 'human', 1, 1)`
    ).run(SHARED)

    const result = applyChanges(db, 'share-1', [
      itemChange('item-1', 'upsert', { title: 'Old' }, at(1))
    ])

    expect(result).toEqual({ applied: 0, skipped: 1, pending: 0, ...NOTHING_ELSE })
    expect(titleOf('item-1')).toBe('Local')
  })
})
