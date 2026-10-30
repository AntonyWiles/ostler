import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BRAND } from '../../src/shared/brand'
import { mentionLink } from '../../src/shared/mentions'
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

/** Two PCs of one shared project: what a pull reports when a comment mentions this PC's Me (prompt 14). */
describe('mentions in received comments', () => {
  const tempDir = useTempDir('ostler-sync-mentions-')
  let folder: string
  let dbA: Database.Database
  let dbB: Database.Database
  let projectKey: Buffer
  let keysA: IdentityKeys
  let keysB: IdentityKeys

  const transport = () => new FolderTransport(folder)
  const mentionAnn = mentionLink({ id: ANN, name: 'Ann' }, BRAND.urlScheme)

  const openPc = async (
    name: string,
    member: string,
    device: string,
    me: string,
    other: string
  ) => {
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

  it('reports a new comment by Bob that mentions Ann on her PC', async () => {
    await asPerson(() => comment(dbB, 'c-1', BOB, `${mentionAnn} can you check this?`))
    await push(dbB, keysB)
    const pulled = await pull(dbA)
    expect(pulled.mentionedMe).toEqual([
      { projectId: SHARED, taskId: 'item-1', commentId: 'c-1', byPersonId: BOB }
    ])
  })

  it('reports nothing for a comment that mentions no one, or someone else', async () => {
    await asPerson(() => comment(dbB, 'c-1', BOB, 'No mention here'))
    await asPerson(() =>
      comment(dbB, 'c-2', BOB, mentionLink({ id: BOB, name: 'Bob' }, BRAND.urlScheme))
    )
    await push(dbB, keysB)
    expect((await pull(dbA)).mentionedMe).toEqual([])
  })

  it('reports nothing for a comment Ann wrote herself on another of her devices', async () => {
    dbB.prepare('UPDATE people SET is_me = 0 WHERE id = ?').run(BOB)
    dbB.prepare('UPDATE people SET is_me = 1 WHERE id = ?').run(ANN)
    await asPerson(() => comment(dbB, 'c-1', ANN, `${mentionAnn} note to self`))
    await push(dbB, keysB)
    expect((await pull(dbA)).mentionedMe).toEqual([])
  })

  it('reports nothing when an edit adds a mention later: inserts only', async () => {
    await asPerson(() => comment(dbB, 'c-1', BOB, 'Look at this'))
    await push(dbB, keysB)
    expect((await pull(dbA)).mentionedMe).toEqual([])

    await asPerson(() =>
      dbB
        .prepare('UPDATE planning_comments SET body = ? WHERE id = ?')
        .run(`${mentionAnn} look`, 'c-1')
    )
    await push(dbB, keysB)
    expect((await pull(dbA)).mentionedMe).toEqual([])
  })
})
