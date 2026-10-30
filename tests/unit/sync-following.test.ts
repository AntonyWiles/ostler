import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FollowService } from '../../electron/services/follow-service'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { recordChanges } from '../../electron/services/change-history/context'
import {
  newIdentityKeys,
  newProjectKey,
  type IdentityKeys
} from '../../electron/services/sync/change-file'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const SHARED = 'shared-project'
const ANN = 'person-ann'
const BOB = 'person-bob'

const asPerson = (write: () => void) => recordChanges('test.person-edit', async () => write())

/** Two PCs of one shared project: what a pull reports when another person changes a task (prompt 15). */
describe('followed tasks changed by someone else', () => {
  const tempDir = useTempDir('ostler-sync-mentions-')
  let folder: string
  let dbA: Database.Database
  let dbB: Database.Database
  let projectKey: Buffer
  let keysA: IdentityKeys
  let keysB: IdentityKeys

  const transport = () => new FolderTransport(folder)
  let pathA = ''

  const openPc = async (
    name: string,
    member: string,
    device: string,
    me: string,
    other: string
  ) => {
    const dir = fs.mkdtempSync(path.join(tempDir(), `${name}-`))
    const dbPath = await createMigratedDatabase(dir)
    if (name === 'pc-a') pathA = dbPath
    const db = new Database(dbPath)
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
    for (const [id, isMe] of [
      [me, 1],
      [other, 0]
    ] as const) {
      db.prepare(
        `INSERT INTO people (id, name, initials, color, is_me, archived_at, created_at, updated_at)
         VALUES (?, ?, 'X', '#336699', ?, NULL, 1, 1)`
      ).run(id, id === ANN ? 'Ann' : 'Bob', isMe)
    }
    attachChangeRecorder(db)
    return db
  }

  const insertItem = (db: Database.Database) =>
    db
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES ('item-1', ?, 'Paint hall', 'ready', 'medium', 'human', 1, 1)`
      )
      .run(SHARED)

  const comment = (db: Database.Database, id: string, author: string, body: string) =>
    db
      .prepare(
        `INSERT INTO planning_comments (id, project_id, work_item_id, author_person_id, author_kind, body, created_at, updated_at)
         VALUES (?, ?, 'item-1', ?, 'human', ?, 1, 1)`
      )
      .run(id, SHARED, author, body)

  const push = (db: Database.Database, keys: IdentityKeys) =>
    pushChanges(db, transport(), SHARED, { projectKey, privateKey: keys.privateKey })
  const pull = (db: Database.Database) => pullChanges(db, transport(), SHARED, { projectKey })

  beforeEach(async () => {
    folder = path.join(tempDir(), 'shared')
    fs.mkdirSync(folder)
    projectKey = newProjectKey()
    keysA = newIdentityKeys()
    keysB = newIdentityKeys()
    dbA = await openPc('pc-a', 'm-a', 'dev-a', ANN, BOB)
    dbB = await openPc('pc-b', 'm-b', 'dev-b', BOB, ANN)
    await asPerson(() => insertItem(dbA))
    await push(dbA, keysA)
    await pull(dbB)
  })

  afterEach(() => {
    dbA.close()
    dbB.close()
  })

  const rename = (db: Database.Database, id: string, title: string) =>
    db.prepare('UPDATE planning_work_items SET title = ? WHERE id = ?').run(title, id)

  it('reports a task Bob renamed, once, even after two edits and a comment', async () => {
    await asPerson(() => rename(dbB, 'item-1', 'Paint the hall'))
    await push(dbB, keysB)
    await asPerson(() => rename(dbB, 'item-1', 'Paint the big hall'))
    await asPerson(() => comment(dbB, 'c-1', BOB, 'Done the first coat'))
    await push(dbB, keysB)
    const pulled = await pull(dbA)
    expect(pulled.changedTasks).toEqual([{ projectId: SHARED, taskId: 'item-1', byPersonId: BOB }])
  })

  it('a change to a task Ann does not follow raises no notice, and one she follows does', async () => {
    await asPerson(() => rename(dbB, 'item-1', 'Paint the hall'))
    await push(dbB, keysB)
    const pulled = await pull(dbA)
    const follows = new FollowService(pathA)
    try {
      const ids = pulled.changedTasks.map((change) => change.taskId)
      expect(follows.followedIn(ids).size).toBe(0)
      follows.autoFollow(SHARED, 'item-1')
      expect([...follows.followedIn(ids)]).toEqual(['item-1'])
    } finally {
      follows.close()
    }
  })

  it('reports nothing for a change Ann made herself on another of her devices', async () => {
    dbB.prepare('UPDATE people SET is_me = 0 WHERE id = ?').run(BOB)
    dbB.prepare('UPDATE people SET is_me = 1 WHERE id = ?').run(ANN)
    await asPerson(() => rename(dbB, 'item-1', 'Paint the hall'))
    await push(dbB, keysB)
    expect((await pull(dbA)).changedTasks).toEqual([])
  })
})
