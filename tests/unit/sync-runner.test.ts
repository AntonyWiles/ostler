import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import {
  encodeChangeFile,
  newIdentityKeys,
  newProjectKey,
  type IdentityKeys
} from '../../electron/services/sync/change-file'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const SHARED = 'shared-project'

describe('sync push and pull between two PCs', () => {
  const tempDir = useTempDir('ostler-sync-runner-')
  let folder: string
  let dbA: Database.Database
  let dbB: Database.Database
  let projectKey: Buffer
  let keysA: IdentityKeys
  let keysB: IdentityKeys

  const transport = (): FolderTransport => new FolderTransport(folder)

  const openPc = async (name: string, member: string, device: string) => {
    const dir = fs.mkdtempSync(path.join(tempDir(), `${name}-`))
    const db = new Database(await createMigratedDatabase(dir))
    db.prepare(
      `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at)
       VALUES (?, 'share-1', ?, ?, ?, 1, 1)`
    ).run(SHARED, folder, member, device)
    for (const [memberId, publicKey] of [
      ['m-a', keysA.publicKey],
      ['m-b', keysB.publicKey]
    ]) {
      db.prepare(
        `INSERT INTO sync_members (share_id, member_id, person_id, name, public_key, joined_at)
         VALUES ('share-1', ?, NULL, ?, ?, 1)`
      ).run(memberId, memberId, publicKey)
    }
    attachChangeRecorder(db)
    return db
  }

  const insertItem = (db: Database.Database, id: string, title: string) =>
    db
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
      )
      .run(id, SHARED, title)

  const titleOf = (db: Database.Database, id: string): string | undefined =>
    (
      db.prepare('SELECT title FROM planning_work_items WHERE id = ?').get(id) as
        { title: string } | undefined
    )?.title

  const statusOf = (db: Database.Database, id: string): string | undefined =>
    (
      db.prepare('SELECT status FROM planning_work_items WHERE id = ?').get(id) as
        { status: string } | undefined
    )?.status

  const outboxCount = (db: Database.Database): number =>
    (db.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get() as { n: number }).n

  const appliedFrom = (db: Database.Database, deviceId: string): number | undefined =>
    (
      db
        .prepare(
          "SELECT last_sequence FROM sync_applied WHERE share_id = 'share-1' AND device_id = ?"
        )
        .get(deviceId) as { last_sequence: number } | undefined
    )?.last_sequence

  beforeEach(async () => {
    folder = path.join(tempDir(), 'shared')
    fs.mkdirSync(folder)
    projectKey = newProjectKey()
    keysA = newIdentityKeys()
    keysB = newIdentityKeys()
    dbA = await openPc('pc-a', 'm-a', 'dev-a')
    dbB = await openPc('pc-b', 'm-b', 'dev-b')
  })

  afterEach(() => {
    dbA.close()
    dbB.close()
  })

  it('pushes A work to the folder and pulls it into B once, without echo', async () => {
    insertItem(dbA, 'item-1', 'Paint hall')

    const pushed = await pushChanges(dbA, transport(), SHARED, {
      projectKey,
      privateKey: keysA.privateKey
    })
    expect(pushed).toEqual({ written: 1, sequence: 1 })
    expect(outboxCount(dbA)).toBe(0)
    expect(fs.existsSync(path.join(folder, 'changes', 'dev-a', '000001.ostlerchanges'))).toBe(true)

    const pulled = await pullChanges(dbB, transport(), SHARED, { projectKey })
    expect(pulled).toMatchObject({ files: 1, applied: 1, problems: [] })
    expect(titleOf(dbB, 'item-1')).toBe('Paint hall')
    expect(appliedFrom(dbB, 'dev-a')).toBe(1)
    expect(outboxCount(dbB)).toBe(0)
  })

  it('merges edits to different fields from both PCs', async () => {
    insertItem(dbA, 'item-1', 'Paint hall')
    await pushChanges(dbA, transport(), SHARED, { projectKey, privateKey: keysA.privateKey })
    await pullChanges(dbB, transport(), SHARED, { projectKey })

    dbA
      .prepare('UPDATE planning_work_items SET title = ? WHERE id = ?')
      .run('Paint the hall', 'item-1')
    dbB.prepare('UPDATE planning_work_items SET status = ? WHERE id = ?').run('done', 'item-1')
    await pushChanges(dbA, transport(), SHARED, { projectKey, privateKey: keysA.privateKey })
    await pushChanges(dbB, transport(), SHARED, { projectKey, privateKey: keysB.privateKey })
    await pullChanges(dbA, transport(), SHARED, { projectKey })
    await pullChanges(dbB, transport(), SHARED, { projectKey })

    for (const db of [dbA, dbB]) {
      expect(titleOf(db, 'item-1')).toBe('Paint the hall')
      expect(statusOf(db, 'item-1')).toBe('done')
    }
  })

  it('writes the next sequence and pulls only the new file', async () => {
    insertItem(dbA, 'item-1', 'Paint hall')
    await pushChanges(dbA, transport(), SHARED, { projectKey, privateKey: keysA.privateKey })
    await pullChanges(dbB, transport(), SHARED, { projectKey })

    dbA
      .prepare('UPDATE planning_work_items SET title = ? WHERE id = ?')
      .run('Paint the hall', 'item-1')
    const second = await pushChanges(dbA, transport(), SHARED, {
      projectKey,
      privateKey: keysA.privateKey
    })
    expect(second).toEqual({ written: 1, sequence: 2 })
    expect(fs.existsSync(path.join(folder, 'changes', 'dev-a', '000002.ostlerchanges'))).toBe(true)

    const pulled = await pullChanges(dbB, transport(), SHARED, { projectKey })
    expect(pulled).toMatchObject({ files: 1, applied: 1 })
    expect(titleOf(dbB, 'item-1')).toBe('Paint the hall')
    expect(appliedFrom(dbB, 'dev-a')).toBe(2)

    expect(await pullChanges(dbB, transport(), SHARED, { projectKey })).toMatchObject({ files: 0 })
  })

  it('reports a file from a non-member as unknown-member without throwing', async () => {
    const intruder = newIdentityKeys()
    const bytes = encodeChangeFile(
      {
        formatVersion: 1,
        shareId: 'share-1',
        deviceId: 'dev-x',
        memberId: 'm-x',
        sequence: 1,
        changes: []
      },
      { projectKey, privateKey: intruder.privateKey }
    )
    await transport().writeOnce('changes/dev-x/000001.ostlerchanges', bytes)

    const pulled = await pullChanges(dbB, transport(), SHARED, { projectKey })
    expect(pulled.files).toBe(0)
    expect(pulled.problems).toEqual([{ deviceId: 'dev-x', sequence: 1, reason: 'unknown-member' }])
  })

  it('writes nothing when the outbox is empty', async () => {
    const pushed = await pushChanges(dbA, transport(), SHARED, {
      projectKey,
      privateKey: keysA.privateKey
    })
    expect(pushed).toEqual({ written: 0, sequence: null })
    expect(fs.existsSync(path.join(folder, 'changes', 'dev-a'))).toBe(false)
  })
  it('renumbers the later of two tasks given the same number, the same way on both PCs', async () => {
    const numbered = (db: Database.Database, id: string, number: number) =>
      db
        .prepare(
          `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at, number)
           VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1, ?)`
        )
        .run(id, SHARED, id, number)
    const numbers = (db: Database.Database) =>
      db
        .prepare('SELECT id, number FROM planning_work_items WHERE project_id = ? ORDER BY id')
        .all(SHARED)
    const sync = async () => {
      await pushChanges(dbA, transport(), SHARED, { projectKey, privateKey: keysA.privateKey })
      await pushChanges(dbB, transport(), SHARED, { projectKey, privateKey: keysB.privateKey })
      await pullChanges(dbA, transport(), SHARED, { projectKey })
      await pullChanges(dbB, transport(), SHARED, { projectKey })
    }

    numbered(dbA, 'a-task', 1)
    await new Promise((resolve) => setTimeout(resolve, 5))
    numbered(dbB, 'b-task', 1)
    await sync()
    await sync()

    expect(numbers(dbA)).toEqual([
      { id: 'a-task', number: 1 },
      { id: 'b-task', number: 2 }
    ])
    expect(numbers(dbB)).toEqual(numbers(dbA))
    expect(dbA.prepare('SELECT COUNT(*) AS n FROM sync_pending').get()).toEqual({ n: 0 })
    expect(dbB.prepare('SELECT COUNT(*) AS n FROM sync_pending').get()).toEqual({ n: 0 })
    for (const db of [dbA, dbB]) {
      expect(
        db.prepare('SELECT next_number FROM project_task_counters WHERE project_id = ?').get(SHARED)
      ).toEqual({ next_number: 3 })
    }
    expect(
      dbB
        .prepare(
          "SELECT from_value, to_value FROM planning_field_changes WHERE work_item_id = 'b-task'"
        )
        .get()
    ).toEqual({ from_value: '1', to_value: '2' })
  })
  it('keeps a description edited here when another PC edit replaces it', async () => {
    insertItem(dbA, 'item-1', 'Paint hall')
    await pushChanges(dbA, transport(), SHARED, { projectKey, privateKey: keysA.privateKey })
    await pullChanges(dbB, transport(), SHARED, { projectKey })

    const describe = (db: Database.Database, text: string) =>
      db.prepare('UPDATE planning_work_items SET description = ? WHERE id = ?').run(text, 'item-1')
    describe(dbA, 'Two coats, white')
    await new Promise((resolve) => setTimeout(resolve, 5))
    describe(dbB, 'One coat, grey')
    await pushChanges(dbA, transport(), SHARED, { projectKey, privateKey: keysA.privateKey })
    await pushChanges(dbB, transport(), SHARED, { projectKey, privateKey: keysB.privateKey })
    await pullChanges(dbA, transport(), SHARED, { projectKey })
    await pullChanges(dbB, transport(), SHARED, { projectKey })

    for (const db of [dbA, dbB]) {
      expect(
        db.prepare("SELECT description FROM planning_work_items WHERE id = 'item-1'").get()
      ).toEqual({ description: 'One coat, grey' })
    }
    expect(
      dbA
        .prepare("SELECT text FROM planning_description_versions WHERE work_item_id = 'item-1'")
        .all()
    ).toEqual([{ text: 'Two coats, white' }])
    expect(
      dbA
        .prepare(
          "SELECT field FROM planning_field_changes WHERE work_item_id = 'item-1' AND field = 'descriptionReplaced'"
        )
        .all()
    ).toHaveLength(1)
    expect(dbB.prepare('SELECT COUNT(*) AS n FROM planning_description_versions').get()).toEqual({
      n: 0
    })
  })
})
