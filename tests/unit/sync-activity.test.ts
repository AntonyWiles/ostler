import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { recordChanges } from '../../electron/services/change-history/context'
import { applyChanges } from '../../electron/services/sync/apply'
import {
  newIdentityKeys,
  newProjectKey,
  type IdentityKeys,
  type SyncChange
} from '../../electron/services/sync/change-file'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const SHARED = 'shared-project'

/** A stamp far enough ahead of the real clock that the changes made in these tests are later than any stored stamp. */
const at = (n: number) => `${String(9_000_000_000_000 + n).padStart(15, '0')}-000000-dev-b`

const ANN = 'person-ann'
const BOB = 'person-bob'
const CAROL = 'person-carol'

/**
 * Runs a write the way a person's edit runs: inside an IPC call, so the change
 * is captured as the person's, with their Me as its author (D10).
 */
const asPerson = (write: () => void) => recordChanges('test.person-edit', async () => write())

/** Two PCs of one shared project, each with its Me and the other people it knows. */
describe('activity for received changes (people and devices, D10, D11)', () => {
  const tempDir = useTempDir('ostler-sync-activity-')
  let folder: string
  let dbA: Database.Database
  let dbB: Database.Database
  let projectKey: Buffer
  let keysA: IdentityKeys
  let keysB: IdentityKeys

  const transport = (): FolderTransport => new FolderTransport(folder)

  const addPerson = (db: Database.Database, id: string, name: string, isMe: boolean) =>
    db
      .prepare(
        `INSERT INTO people (id, name, initials, color, is_me, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, '#336699', ?, NULL, 1, 1)`
      )
      .run(id, name, name.charAt(0), isMe ? 1 : 0)

  const nameOf = (id: string) => (id === ANN ? 'Ann' : id === BOB ? 'Bob' : 'Carol')

  const openPc = async (
    name: string,
    member: string,
    device: string,
    me: string,
    others: string[]
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
    // People go in before the recorder is attached, so they are not sent as changes of this PC.
    addPerson(db, me, nameOf(me), true)
    for (const other of others) addPerson(db, other, nameOf(other), false)
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

  const fieldChanges = (db: Database.Database, id: string) =>
    db
      .prepare(
        `SELECT field, from_value, to_value, actor_kind, actor_person_id FROM planning_field_changes
         WHERE work_item_id = ? ORDER BY id`
      )
      .all(id) as {
      field: string
      from_value: string | null
      to_value: string | null
      actor_kind: string
      actor_person_id: string | null
    }[]

  const statusHistory = (db: Database.Database, id: string) =>
    db
      .prepare(
        `SELECT from_status, to_status, actor_person_id FROM planning_status_history
         WHERE work_item_id = ? ORDER BY at, sequence`
      )
      .all(id)

  const titleChange = (title: string, stamp: string, personId: string): SyncChange => ({
    table: 'planning_work_items',
    rowKey: JSON.stringify(['item-1']),
    op: 'upsert',
    columns: { title },
    stamp,
    actor: { kind: 'human', personId }
  })

  const push = (db: Database.Database, keyPair: IdentityKeys) =>
    pushChanges(db, transport(), SHARED, { projectKey, privateKey: keyPair.privateKey })
  const pull = (db: Database.Database) => pullChanges(db, transport(), SHARED, { projectKey })

  beforeEach(async () => {
    folder = path.join(tempDir(), 'shared')
    fs.mkdirSync(folder)
    projectKey = newProjectKey()
    keysA = newIdentityKeys()
    keysB = newIdentityKeys()
    dbA = await openPc('pc-a', 'm-a', 'dev-a', ANN, [BOB, CAROL])
    dbB = await openPc('pc-b', 'm-b', 'dev-b', BOB, [ANN, CAROL])
  })

  afterEach(() => {
    dbA.close()
    dbB.close()
  })

  it('(a) a received edit writes activity that names the sender, and creation does too', async () => {
    await asPerson(() => insertItem(dbA, 'item-1', 'Paint hall'))
    await push(dbA, keysA)
    await pull(dbB)

    expect(fieldChanges(dbB, 'item-1')).toEqual([
      {
        field: 'created',
        from_value: null,
        to_value: null,
        actor_kind: 'human',
        actor_person_id: ANN
      }
    ])

    await asPerson(() =>
      dbB
        .prepare(
          "UPDATE planning_work_items SET title = 'Paint the hall', status = 'done' WHERE id = 'item-1'"
        )
        .run()
    )
    await push(dbB, keysB)
    await pull(dbA)

    const edits = fieldChanges(dbA, 'item-1').filter((row) => row.field !== 'created')
    expect(edits).toEqual([
      {
        field: 'title',
        from_value: JSON.stringify('Paint hall'),
        to_value: JSON.stringify('Paint the hall'),
        actor_kind: 'human',
        actor_person_id: BOB
      }
    ])
    // Status has its own history, as it does on the PC that made the change.
    expect(statusHistory(dbA, 'item-1')).toEqual([
      { from_status: 'ready', to_status: 'done', actor_person_id: BOB }
    ])
  })

  it('(b) a change that loses the merge to a newer stamp writes no activity', () => {
    insertItem(dbA, 'item-1', 'Paint hall')
    applyChanges(dbA, 'share-1', [titleChange('Newer', at(2), BOB)])
    const before = fieldChanges(dbA, 'item-1').length

    const counts = applyChanges(dbA, 'share-1', [titleChange('Older', at(1), CAROL)])

    expect(counts.skipped).toBe(1)
    expect(fieldChanges(dbA, 'item-1')).toHaveLength(before)
    expect(titleOf(dbA, 'item-1')).toBe('Newer')
  })

  it('(c) applying the same change again writes no second row', () => {
    insertItem(dbA, 'item-1', 'Paint hall')
    const change = titleChange('Newer', at(2), BOB)
    applyChanges(dbA, 'share-1', [change])
    const before = fieldChanges(dbA, 'item-1').length

    const counts = applyChanges(dbA, 'share-1', [change])

    expect(counts).toMatchObject({ applied: 0, skipped: 1 })
    expect(fieldChanges(dbA, 'item-1')).toHaveLength(before)
  })

  it("(d) an assignment to this PC's Me is reported once; assignments to others are not", async () => {
    await asPerson(() => insertItem(dbA, 'item-1', 'Paint hall'))
    await push(dbA, keysA)
    await pull(dbB)

    await asPerson(() =>
      dbB.prepare("UPDATE planning_work_items SET assignee_id = ? WHERE id = 'item-1'").run(ANN)
    )
    await push(dbB, keysB)
    const toAnn = await pull(dbA)
    expect(toAnn.assignedToMe).toEqual([{ projectId: SHARED, taskId: 'item-1', byPersonId: BOB }])

    await asPerson(() =>
      dbB.prepare("UPDATE planning_work_items SET assignee_id = ? WHERE id = 'item-1'").run(CAROL)
    )
    await push(dbB, keysB)
    const toCarol = await pull(dbA)
    expect(toCarol.assignedToMe).toEqual([])

    // Ann assigns herself on her other device: no "Ann assigned you" notice here.
    dbB.prepare('UPDATE people SET is_me = 0 WHERE id = ?').run(BOB)
    dbB.prepare('UPDATE people SET is_me = 1 WHERE id = ?').run(ANN)
    await asPerson(() =>
      dbB.prepare("UPDATE planning_work_items SET assignee_id = ? WHERE id = 'item-1'").run(ANN)
    )
    await push(dbB, keysB)
    const bySelf = await pull(dbA)
    expect(bySelf.applied).toBe(1)
    expect(bySelf.assignedToMe).toEqual([])
  })
})

function titleOf(db: Database.Database, id: string): string | undefined {
  return (
    db.prepare('SELECT title FROM planning_work_items WHERE id = ?').get(id) as
      { title: string } | undefined
  )?.title
}
