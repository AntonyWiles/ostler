import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import { refreshKeys, removeMember, RemoveMemberError } from '../../electron/services/sync/rotation'
import {
  inviteFor,
  joinShare,
  parseInvite,
  refreshMembers,
  shareProject,
  SharingError
} from '../../electron/services/sync/sharing'
import { writeRoleChange } from '../../electron/services/sync/roles'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import {
  identityKeys,
  personKeys,
  keyGenerationOf,
  projectKeyFor,
  projectKeyring
} from '../../electron/services/sync/sync-keys'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const PROJECT = 'house-project'
const SETTINGS = { name: 'House', color: '#336699', notes: '', tags: [] }

describe('removing a member from a shared project (S7d)', () => {
  const tempDir = useTempDir('ostler-sync-rotation-')
  let folder: string
  let dbA: Database.Database
  let dbB: Database.Database
  let dbC: Database.Database
  let invite: string
  const opened: Database.Database[] = []

  const transport = (): FolderTransport => new FolderTransport(folder)

  const openPc = async (name: string) => {
    const db = new Database(
      await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), name)))
    )
    attachChangeRecorder(db)
    opened.push(db)
    return db
  }

  const insertItem = (db: Database.Database, id: string, title: string) =>
    db
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
      )
      .run(id, PROJECT, title)

  const rename = (db: Database.Database, id: string, title: string) =>
    db.prepare('UPDATE planning_work_items SET title = ? WHERE id = ?').run(title, id)

  const titleOf = (db: Database.Database, id: string): string | undefined =>
    (
      db.prepare('SELECT title FROM planning_work_items WHERE id = ?').get(id) as
        { title: string } | undefined
    )?.title

  const push = (db: Database.Database) =>
    pushChanges(db, transport(), PROJECT, {
      projectKey: projectKeyFor(db, PROJECT)!,
      keyGeneration: keyGenerationOf(db, PROJECT),
      privateKey: identityKeys(db).privateKey
    })

  /** What a pull does: key changes, members, then changes. */
  const pull = async (db: Database.Database) => {
    const keys = await refreshKeys(db, transport(), PROJECT)
    const shareId = parseInvite(invite).shareId
    await refreshMembers(db, transport(), shareId, projectKeyring(db, PROJECT))
    const changes = await pullChanges(db, transport(), PROJECT, {
      projectKey: projectKeyring(db, PROJECT)
    })
    return { keys, changes }
  }

  const memberIdOf = (db: Database.Database): string =>
    (db.prepare('SELECT member_id FROM sync_shares').get() as { member_id: string }).member_id

  beforeEach(async () => {
    folder = path.join(tempDir(), 'shared')
    fs.mkdirSync(folder)
    dbA = await openPc('pc-a-')
    dbB = await openPc('pc-b-')
    dbC = await openPc('pc-c-')
    insertItem(dbA, 'item-1', 'Paint hall')
    invite = await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    await joinShare(dbB, transport(), invite, { folder, memberName: 'Ben' })
    await joinShare(dbC, transport(), invite, { folder, memberName: 'Cat' })
    await pull(dbA)
    await pull(dbB)
  })

  afterEach(() => {
    for (const db of opened.splice(0)) db.close()
  })

  it('moves everyone else to a new key the removed member never gets', async () => {
    const oldKey = projectKeyFor(dbA, PROJECT)!
    const generation = await removeMember(dbA, transport(), PROJECT, memberIdOf(dbC))
    expect(generation).toBe(1)
    expect(keyGenerationOf(dbA, PROJECT)).toBe(1)
    expect(projectKeyFor(dbA, PROJECT)!.equals(oldKey)).toBe(false)

    const atB = await pull(dbB)
    expect(atB.keys).toEqual({ read: 1, removed: false, problems: [] })
    expect(projectKeyFor(dbB, PROJECT)!.equals(projectKeyFor(dbA, PROJECT)!)).toBe(true)

    rename(dbB, 'item-1', 'Paint the hall')
    await push(dbB)
    expect((await pull(dbA)).changes.problems).toEqual([])
    expect(titleOf(dbA, 'item-1')).toBe('Paint the hall')

    const atC = await pull(dbC)
    expect(atC.keys.removed).toBe(true)
    expect(projectKeyFor(dbC, PROJECT)!.equals(oldKey)).toBe(true)
    expect(atC.changes.problems.map((problem) => problem.reason)).toContain('cannot-decrypt')
    expect(titleOf(dbC, 'item-1')).toBe('Paint hall')
  })

  it('keeps what the removed member sent before, and ignores what they send after', async () => {
    rename(dbC, 'item-1', 'Paint hall blue')
    await push(dbC)
    await pull(dbA)
    expect(titleOf(dbA, 'item-1')).toBe('Paint hall blue')

    await removeMember(dbA, transport(), PROJECT, memberIdOf(dbC))
    rename(dbC, 'item-1', 'Knock the hall down')
    await push(dbC)

    // B had not pulled C's first change: it still counts, the one after the removal doesn't.
    const atB = await pull(dbB)
    expect(atB.changes.problems).toEqual([])
    expect(titleOf(dbB, 'item-1')).toBe('Paint hall blue')
    expect((await pull(dbA)).changes.problems).toEqual([])
    expect(titleOf(dbA, 'item-1')).toBe('Paint hall blue')
  })

  it('stops the old invite working and gives a new one that reads everything', async () => {
    await removeMember(dbA, transport(), PROJECT, memberIdOf(dbC))
    const dbD = await openPc('pc-d-')
    await expect(
      joinShare(dbD, transport(), invite, { folder, memberName: 'Dan' })
    ).rejects.toSatisfy((error) => error instanceof SharingError && error.reason === 'old-invite')
    expect(dbD.prepare('SELECT COUNT(*) AS n FROM sync_shares').get()).toEqual({ n: 0 })

    const newInvite = inviteFor(dbA, PROJECT)!
    expect(parseInvite(newInvite)).toMatchObject({ generation: 1 })
    expect(parseInvite(newInvite).previousKeys).toHaveLength(1)

    const dbE = await openPc('pc-e-')
    const joined = await joinShare(dbE, transport(), newInvite, { folder, memberName: 'Eve' })
    expect(joined.pulled.problems).toEqual([])
    expect(titleOf(dbE, 'item-1')).toBe('Paint hall')
    expect(keyGenerationOf(dbE, PROJECT)).toBe(1)
    expect(
      dbE
        .prepare('SELECT name, removed_at IS NOT NULL AS removed FROM sync_members ORDER BY name')
        .all()
    ).toEqual([
      { name: 'Ann', removed: 0 },
      { name: 'Ben', removed: 0 },
      { name: 'Cat', removed: 1 },
      { name: 'Eve', removed: 0 }
    ])
    const atE = await pull(dbE)
    expect(atE.keys.problems).toEqual([])
  })

  it('refuses removing this PC and settles two removals of the same member', async () => {
    await expect(removeMember(dbA, transport(), PROJECT, memberIdOf(dbA))).rejects.toSatisfy(
      (error) => error instanceof RemoveMemberError && error.reason === 'this-pc'
    )
    await removeMember(dbA, transport(), PROJECT, memberIdOf(dbC))
    // B removes C too without having pulled: it reads A's change and stops there.
    expect(await removeMember(dbB, transport(), PROJECT, memberIdOf(dbC))).toBe(1)
    expect(fs.readdirSync(path.join(folder, 'keys'))).toEqual(['1.ostlerrotation'])
  })

  it('removes a second member on top of the first', async () => {
    // Only an Owner may remove (D1): Ben joined as an Editor, so Ann makes him an Owner first.
    await writeRoleChange(dbA, transport(), PROJECT, personKeys(dbB).publicKey, 'owner')
    await removeMember(dbA, transport(), PROJECT, memberIdOf(dbC))
    await pull(dbB)
    expect(await removeMember(dbB, transport(), PROJECT, memberIdOf(dbA))).toBe(2)
    const atA = await pull(dbA)
    expect(atA.keys.removed).toBe(true)
    expect(keyGenerationOf(dbA, PROJECT)).toBe(1)
    rename(dbB, 'item-1', 'Only Ben now')
    await push(dbB)
    const later = await pull(dbA)
    expect(later.changes.problems.map((problem) => problem.reason)).toContain('cannot-decrypt')
    expect(titleOf(dbA, 'item-1')).toBe('Paint hall')
  })
})
