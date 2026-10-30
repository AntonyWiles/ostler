import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import {
  newIdentityKeys,
  newProjectKey,
  type IdentityKeys
} from '../../electron/services/sync/change-file'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import {
  latestSnapshot,
  loadSnapshot,
  readSnapshotFile,
  writeSnapshot
} from '../../electron/services/sync/snapshots'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const SHARED = 'shared-project'

describe('sync snapshots', () => {
  const tempDir = useTempDir('ostler-sync-snapshots-')
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

  const insertItem = (db: Database.Database, id: string, title: string, project = SHARED) =>
    db
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
      )
      .run(id, project, title)

  const items = (db: Database.Database) =>
    db.prepare('SELECT * FROM planning_work_items WHERE project_id = ? ORDER BY id').all(SHARED)

  const titleOf = (db: Database.Database, id: string): string | undefined =>
    (
      db.prepare('SELECT title FROM planning_work_items WHERE id = ?').get(id) as
        { title: string } | undefined
    )?.title

  const outboxCount = (db: Database.Database): number =>
    (db.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get() as { n: number }).n

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

  const snapshotIntoB = async () => {
    const latest = await latestSnapshot(transport())
    expect(latest).not.toBeNull()
    const snapshot = await readSnapshotFile(dbB, transport(), 'share-1', latest!, projectKey)
    return loadSnapshot(dbB, SHARED, snapshot)
  }

  it('loads A project into an empty B, with stamps and no outbox rows', async () => {
    insertItem(dbA, 'item-1', 'Paint hall')
    insertItem(dbA, 'item-2', 'Fix door')
    insertItem(dbA, 'item-x', 'Other project', 'other-project')
    dbA
      .prepare(
        "INSERT INTO planning_dependencies (work_item_id, depends_on_id) VALUES ('item-2', 'item-1')"
      )
      .run()
    await pushChanges(dbA, transport(), SHARED, { projectKey, privateKey: keysA.privateKey })

    const project = { name: 'House', color: '#336699', notes: '', tags: ['home'] }
    const written = await writeSnapshot(
      dbA,
      transport(),
      SHARED,
      { projectKey, privateKey: keysA.privateKey },
      project
    )
    expect(written).toMatch(/^snapshots\/dev-a\/\d{15}-\d{6}-dev-a\.ostlersnap$/)

    const snapshot = await readSnapshotFile(dbB, transport(), 'share-1', written, projectKey)
    expect(snapshot.project).toEqual(project)
    const loaded = loadSnapshot(dbB, SHARED, snapshot)
    expect(loaded.rows).toBe(3)
    expect(items(dbB)).toEqual(items(dbA))
    expect(titleOf(dbB, 'item-x')).toBeUndefined()
    expect(
      dbB
        .prepare("SELECT depends_on_id FROM planning_dependencies WHERE work_item_id = 'item-2'")
        .get()
    ).toEqual({ depends_on_id: 'item-1' })
    expect(outboxCount(dbB)).toBe(0)
    expect(
      (
        dbB
          .prepare('SELECT COUNT(*) AS n FROM sync_field_stamps WHERE project_id = ?')
          .get(SHARED) as { n: number }
      ).n
    ).toBeGreaterThan(0)
  })

  it('then pulls only the changes newer than the snapshot', async () => {
    insertItem(dbA, 'item-1', 'Paint hall')
    await pushChanges(dbA, transport(), SHARED, { projectKey, privateKey: keysA.privateKey })
    await writeSnapshot(dbA, transport(), SHARED, { projectKey, privateKey: keysA.privateKey })

    dbA
      .prepare('UPDATE planning_work_items SET title = ? WHERE id = ?')
      .run('Paint the hall', 'item-1')
    await pushChanges(dbA, transport(), SHARED, { projectKey, privateKey: keysA.privateKey })

    await snapshotIntoB()
    expect(titleOf(dbB, 'item-1')).toBe('Paint hall')

    const pulled = await pullChanges(dbB, transport(), SHARED, { projectKey })
    expect(pulled).toMatchObject({ files: 1, applied: 1, problems: [] })
    expect(titleOf(dbB, 'item-1')).toBe('Paint the hall')
  })

  it('keeps later local edits and local deletes when loading over existing rows', async () => {
    insertItem(dbA, 'item-1', 'Paint hall')
    insertItem(dbA, 'item-2', 'Fix door')
    await pushChanges(dbA, transport(), SHARED, { projectKey, privateKey: keysA.privateKey })
    await pullChanges(dbB, transport(), SHARED, { projectKey })
    await writeSnapshot(dbA, transport(), SHARED, { projectKey, privateKey: keysA.privateKey })

    dbB.prepare('UPDATE planning_work_items SET title = ? WHERE id = ?').run('Mine', 'item-1')
    dbB.prepare('DELETE FROM planning_work_items WHERE id = ?').run('item-2')

    await snapshotIntoB()
    expect(titleOf(dbB, 'item-1')).toBe('Mine')
    expect(titleOf(dbB, 'item-2')).toBeUndefined()
  })

  it('picks the newest snapshot across devices', async () => {
    insertItem(dbA, 'item-1', 'Paint hall')
    await writeSnapshot(dbA, transport(), SHARED, { projectKey, privateKey: keysA.privateKey })
    insertItem(dbB, 'item-2', 'Fix door')
    const newer = await writeSnapshot(dbB, transport(), SHARED, {
      projectKey,
      privateKey: keysB.privateKey
    })
    expect(await latestSnapshot(transport())).toBe(newer)
  })

  it('refuses a snapshot of another share', async () => {
    insertItem(dbA, 'item-1', 'Paint hall')
    const written = await writeSnapshot(dbA, transport(), SHARED, {
      projectKey,
      privateKey: keysA.privateKey
    })
    await expect(
      readSnapshotFile(dbB, transport(), 'share-2', written, projectKey)
    ).rejects.toThrow()
  })
})
