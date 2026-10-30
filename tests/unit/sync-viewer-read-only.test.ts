import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { withSyncApplying } from '../../electron/services/sync/capture'
import { runWorkItemHousekeeping } from '../../electron/services/work-item-housekeeping'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/*
 * A Viewer's PC refuses writes to a shared project at the database (D9):
 * BEFORE triggers from sync/capture.ts raise `ostler:read-only`, except for a
 * Viewer's own comments. Received changes (inside withSyncApplying) still apply.
 */

const SHARED = 'shared-project'
const OTHER = 'other-project'
const ME = 'person-me'
const THEM = 'person-them'

describe('a Viewer PC cannot change a shared project', () => {
  const tempDir = useTempDir('ostler-viewer-')
  let db: Database.Database

  beforeEach(async () => {
    const dbPath = await createMigratedDatabase(tempDir())
    db = new Database(dbPath)
    db.prepare(
      `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at)
       VALUES (?, 'share-1', 'x', 'm1', 'dev-a', 1, 1)`
    ).run(SHARED)
    db.prepare(
      `INSERT INTO people (id, name, initials, color, is_me, created_at, updated_at)
       VALUES (?, 'Me', 'M', '#000', 1, 1, 1), (?, 'Them', 'T', '#000', 0, 1, 1)`
    ).run(ME, THEM)
    attachChangeRecorder(db)
    // Content is made while this PC is an Editor; the Viewer role is set afterwards.
    insertItem('item-1', SHARED, 'Paint hall')
    insertItem('item-2', OTHER, 'Not shared')
    db.prepare(
      `INSERT INTO planning_milestones (id, project_id, name, status, created_at, updated_at)
       VALUES ('ms-1', ?, 'Launch', 'open', 1, 1)`
    ).run(SHARED)
    db.prepare(
      `INSERT INTO planning_comments (id, project_id, work_item_id, author_person_id, author_kind, body, created_at, updated_at)
       VALUES ('c-them', ?, 'item-1', ?, 'human', 'Hello', 1, 1)`
    ).run(SHARED, THEM)
    db.prepare("UPDATE sync_shares SET my_role = 'viewer' WHERE project_id = ?").run(SHARED)
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

  it('refuses inserting, updating and deleting a task of the shared project', () => {
    expect(() => insertItem('item-3', SHARED, 'New')).toThrow(/ostler:read-only/)
    expect(() =>
      db.prepare('UPDATE planning_work_items SET title = ? WHERE id = ?').run('Changed', 'item-1')
    ).toThrow(/ostler:read-only/)
    expect(() => db.prepare('DELETE FROM planning_work_items WHERE id = ?').run('item-1')).toThrow(
      /ostler:read-only/
    )
  })

  it('refuses changes to a milestone and to a Library item of the shared project', () => {
    expect(() =>
      db.prepare("UPDATE planning_milestones SET name = 'Renamed' WHERE id = 'ms-1'").run()
    ).toThrow(/ostler:read-only/)
    expect(() => db.prepare("DELETE FROM planning_milestones WHERE id = 'ms-1'").run()).toThrow(
      /ostler:read-only/
    )
    expect(() =>
      db
        .prepare(
          `INSERT INTO library_items (id, project_id, kind, title, ai_access, created_at, updated_at)
           VALUES ('lib-1', ?, 'note', 'Brief', 'read', '2026-10-24', '2026-10-24')`
        )
        .run(SHARED)
    ).toThrow(/ostler:read-only/)
  })

  it('leaves an unshared project alone', () => {
    expect(() => insertItem('item-4', OTHER, 'Still fine')).not.toThrow()
    expect(
      db.prepare("UPDATE planning_work_items SET title = 'Edited' WHERE id = 'item-2'").run()
        .changes
    ).toBe(1)
  })

  it("lets a Viewer add and edit their own comment, but not someone else's", () => {
    const insertComment = (id: string, author: string) =>
      db
        .prepare(
          `INSERT INTO planning_comments (id, project_id, work_item_id, author_person_id, author_kind, body, created_at, updated_at)
           VALUES (?, ?, 'item-1', ?, 'human', 'Note', 1, 1)`
        )
        .run(id, SHARED, author)

    expect(() => insertComment('c-me', ME)).not.toThrow()
    expect(() =>
      db.prepare("UPDATE planning_comments SET body = 'Edited' WHERE id = 'c-me'").run()
    ).not.toThrow()
    expect(() => insertComment('c-other', THEM)).toThrow(/ostler:read-only/)
    expect(() =>
      db.prepare("UPDATE planning_comments SET body = 'Edited' WHERE id = 'c-them'").run()
    ).toThrow(/ostler:read-only/)
  })

  it('lets a person promoted from Viewer to Editor edit once their role is recorded', () => {
    expect(() => insertItem('item-6', SHARED, 'Before')).toThrow(/ostler:read-only/)
    // What recordMyRole writes after the next pull reads the promotion.
    db.prepare("UPDATE sync_shares SET my_role = 'editor' WHERE project_id = ?").run(SHARED)
    expect(() => insertItem('item-6', SHARED, 'After')).not.toThrow()
  })

  it('still applies changes received from another PC', () => {
    withSyncApplying(() => {
      insertItem('item-5', SHARED, 'From Ann')
      db.prepare(
        "UPDATE planning_work_items SET title = 'From Ann, edited' WHERE id = 'item-5'"
      ).run()
      db.prepare('DELETE FROM planning_work_items WHERE id = ?').run('item-5')
    })
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM planning_work_items WHERE id = 'item-5'").get()
    ).toEqual({ n: 0 })
  })

  it('lets housekeeping run on a Viewer project without throwing', () => {
    // The guard refuses the purge; housekeeping treats that as nothing to tidy.
    const planning = {
      purgeRecycleBin: (projectId: string) => {
        db.prepare('DELETE FROM planning_work_items WHERE project_id = ?').run(projectId)
        return 0
      },
      listWorkItems: () => []
    }
    const project = { id: SHARED, name: 'Shared' }
    expect(() =>
      runWorkItemHousekeeping(planning as never, {} as never, project as never, {
        autoArchiveDoneAfterDays: 7
      })
    ).not.toThrow()
    expect(
      runWorkItemHousekeeping(planning as never, {} as never, project as never, {
        autoArchiveDoneAfterDays: 7
      })
    ).toEqual({ archived: 0, purged: 0 })
  })
})
