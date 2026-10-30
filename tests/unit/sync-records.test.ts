import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { retryWaiting } from '../../electron/services/sync/apply'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import { pullRecords, pushRecords } from '../../electron/services/sync/records'
import { joinShare, refreshMembers, shareProject } from '../../electron/services/sync/sharing'
import { identityKeys, projectKeyFor } from '../../electron/services/sync/sync-keys'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const PROJECT = 'house-project'
const SETTINGS = { name: 'House', color: '#336699', notes: '', tags: [] as string[] }

describe('people and project settings in a shared folder', () => {
  const tempDir = useTempDir('ostler-sync-records-')
  let folder: string
  let dbA: Database.Database
  let dbB: Database.Database

  const transport = (): FolderTransport => new FolderTransport(folder)

  const openPc = async (name: string) => {
    const db = new Database(
      await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), name)))
    )
    attachChangeRecorder(db)
    return db
  }

  const keysOf = (db: Database.Database) => ({
    projectKey: projectKeyFor(db, PROJECT)!,
    privateKey: identityKeys(db).privateKey
  })

  const addPerson = (db: Database.Database, id: string, name: string, isMe = 0) =>
    db
      .prepare(
        `INSERT INTO people (id, name, initials, color, is_me, created_at, updated_at)
         VALUES (?, ?, ?, '#123456', ?, 1, 1)`
      )
      .run(id, name, name.slice(0, 2).toUpperCase(), isMe)

  beforeEach(async () => {
    folder = path.join(tempDir(), 'shared')
    fs.mkdirSync(folder)
    dbA = await openPc('pc-a-')
    dbB = await openPc('pc-b-')
    const invite = await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    await joinShare(dbB, transport(), invite, { folder, memberName: 'Ben' })
  })

  afterEach(() => {
    dbA.close()
    dbB.close()
  })

  it('sends the person a task is assigned to, so the assignment applies on the other PC', async () => {
    addPerson(dbA, 'person-cleo', 'Cleo', 1)
    addPerson(dbA, 'person-unrelated', 'Dan')
    dbA
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at, assignee_id)
         VALUES ('item-1', ?, 'Paint hall', 'ready', 'medium', 'human', 1, 1, 'person-cleo')`
      )
      .run(PROJECT)

    // Changes first: the assignment waits for its person.
    await pushChanges(dbA, transport(), PROJECT, keysOf(dbA))
    await pullChanges(dbB, transport(), PROJECT, keysOf(dbB))
    expect(dbB.prepare('SELECT COUNT(*) AS n FROM planning_work_items').get()).toEqual({ n: 0 })

    expect(await pushRecords(dbA, transport(), PROJECT, keysOf(dbA), SETTINGS)).toBe(2)
    expect(await pushRecords(dbA, transport(), PROJECT, keysOf(dbA), SETTINGS)).toBe(0)
    const pulled = await pullRecords(dbB, transport(), PROJECT, keysOf(dbB))
    expect(pulled).toMatchObject({ people: 1, project: SETTINGS, problems: [] })
    // Besides the person Ann's member is here (sharing.ts), only Cleo came.
    expect(
      dbB
        .prepare(
          'SELECT id, name, is_me FROM people WHERE id NOT IN (SELECT person_id FROM sync_members WHERE person_id IS NOT NULL)'
        )
        .all()
    ).toEqual([{ id: 'person-cleo', name: 'Cleo', is_me: 0 }])
    const shareId = (dbB.prepare('SELECT share_id FROM sync_shares').get() as { share_id: string })
      .share_id
    expect(retryWaiting(dbB, shareId).pending).toBe(0)
    expect(
      dbB.prepare("SELECT assignee_id FROM planning_work_items WHERE id = 'item-1'").get()
    ).toEqual({ assignee_id: 'person-cleo' })
  })

  it('carries a rename and new settings, and never returns what it received', async () => {
    addPerson(dbA, 'person-cleo', 'Cleo')
    dbA
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at, assignee_id)
         VALUES ('item-1', ?, 'Paint hall', 'ready', 'medium', 'human', 1, 1, 'person-cleo')`
      )
      .run(PROJECT)
    await pushRecords(dbA, transport(), PROJECT, keysOf(dbA), SETTINGS)
    await pullRecords(dbB, transport(), PROJECT, keysOf(dbB))
    // B received them: nothing to send back.
    await pushChanges(dbA, transport(), PROJECT, keysOf(dbA))
    await pullChanges(dbB, transport(), PROJECT, keysOf(dbB))
    expect(await pushRecords(dbB, transport(), PROJECT, keysOf(dbB), SETTINGS)).toBe(0)

    dbB.prepare("UPDATE people SET name = 'Cleopatra' WHERE id = 'person-cleo'").run()
    const renamed = { ...SETTINGS, name: 'Our house' }
    expect(await pushRecords(dbB, transport(), PROJECT, keysOf(dbB), renamed)).toBe(2)
    const shareId = (dbA.prepare('SELECT share_id FROM sync_shares').get() as { share_id: string })
      .share_id
    await refreshMembers(dbA, transport(), shareId, keysOf(dbA).projectKey)
    const pulled = await pullRecords(dbA, transport(), PROJECT, keysOf(dbA))
    expect(pulled.project).toEqual(renamed)
    expect(dbA.prepare("SELECT name FROM people WHERE id = 'person-cleo'").get()).toEqual({
      name: 'Cleopatra'
    })
    expect((await pullRecords(dbA, transport(), PROJECT, keysOf(dbA))).project).toBeNull()
  })
})
