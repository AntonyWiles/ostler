import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import {
  refreshCapabilities,
  sharedCapabilities,
  writeMyCapabilities
} from '../../electron/services/sync/capabilities'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import { membershipHistory } from '../../electron/services/sync/membership-history'
import { refreshKeys, rotateKey } from '../../electron/services/sync/rotation'
import { assertOwner, refreshRoles } from '../../electron/services/sync/roles'
import {
  inviteFor,
  joinShare,
  refreshMembers,
  shareProject,
  SharingError
} from '../../electron/services/sync/sharing'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import {
  identityKeys,
  keyGenerationOf,
  projectKeyFor,
  projectKeyring
} from '../../electron/services/sync/sync-keys'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const PROJECT = 'house-project'
const SETTINGS = { name: 'House', color: '#336699', notes: '', tags: [] }

describe('stopping old invites (D12)', () => {
  const tempDir = useTempDir('ostler-stop-invites-')
  let folder: string
  let shareId: string
  let dbA: Database.Database
  let dbB: Database.Database
  let dbC: Database.Database
  let oldInvite: string
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

  const pull = async (db: Database.Database) => {
    await refreshKeys(db, transport(), PROJECT)
    const keyring = projectKeyring(db, PROJECT)
    await refreshMembers(db, transport(), shareId, keyring)
    await refreshRoles(db, transport(), shareId, keyring)
    await refreshCapabilities(db, transport(), shareId, keyring)
    return pullChanges(db, transport(), PROJECT, { projectKey: keyring })
  }

  const advertise = (db: Database.Database) =>
    writeMyCapabilities(db, transport(), shareId, {
      projectKey: projectKeyFor(db, PROJECT)!,
      keyGeneration: keyGenerationOf(db, PROJECT),
      privateKey: identityKeys(db).privateKey
    })

  const push = (db: Database.Database) =>
    pushChanges(db, transport(), PROJECT, {
      projectKey: projectKeyFor(db, PROJECT)!,
      keyGeneration: keyGenerationOf(db, PROJECT),
      privateKey: identityKeys(db).privateKey
    })

  const rename = (db: Database.Database, id: string, title: string) =>
    db.prepare('UPDATE planning_work_items SET title = ? WHERE id = ?').run(title, id)

  const titleOf = (db: Database.Database, id: string): string | undefined =>
    (
      db.prepare('SELECT title FROM planning_work_items WHERE id = ?').get(id) as
        { title: string } | undefined
    )?.title

  beforeEach(async () => {
    folder = path.join(tempDir(), 'shared')
    fs.mkdirSync(folder)
    dbA = await openPc('pc-a-')
    dbB = await openPc('pc-b-')
    dbC = await openPc('pc-c-')
    dbA
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES ('item-1', ?, 'Paint hall', 'ready', 'medium', 'human', 1, 1)`
      )
      .run(PROJECT)
    await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    shareId = (dbA.prepare('SELECT share_id FROM sync_shares').get() as { share_id: string })
      .share_id
    oldInvite = inviteFor(dbA, PROJECT, 'editor')!
    await joinShare(dbB, transport(), oldInvite, { folder, memberName: 'Ben' })
    await joinShare(dbC, transport(), oldInvite, { folder, memberName: 'Cat' })
    for (const db of [dbA, dbB, dbC]) await advertise(db)
    for (const db of [dbA, dbB, dbC, dbA]) await pull(db)
  })

  afterEach(() => {
    for (const db of opened.splice(0)) db.close()
  })

  it('advertises invite-reset only when every PC does', async () => {
    expect(sharedCapabilities(dbA, shareId)).toContain('invite-reset')
    // An older PC writes no note for itself: nothing newer is shared.
    dbA
      .prepare('DELETE FROM sync_member_capabilities WHERE member_id <> ?')
      .run(
        (dbA.prepare('SELECT member_id FROM sync_shares').get() as { member_id: string }).member_id
      )
    expect(sharedCapabilities(dbA, shareId)).not.toContain('invite-reset')
  })

  it('refuses an invite copied before the stop, and accepts one copied after it', async () => {
    const generation = await rotateKey(dbA, transport(), PROJECT, null)
    expect(generation).toBe(1)

    const dbD = await openPc('pc-d-')
    await expect(
      joinShare(dbD, transport(), oldInvite, { folder, memberName: 'Dan' })
    ).rejects.toSatisfy((error) => error instanceof SharingError && error.reason === 'old-invite')
    expect(dbD.prepare('SELECT COUNT(*) AS n FROM sync_shares').get()).toEqual({ n: 0 })

    const newInvite = inviteFor(dbA, PROJECT, 'editor')!
    const dbE = await openPc('pc-e-')
    const joined = await joinShare(dbE, transport(), newInvite, { folder, memberName: 'Eve' })
    expect(joined.pulled.problems).toEqual([])
    expect(keyGenerationOf(dbE, PROJECT)).toBe(1)
    expect(titleOf(dbE, 'item-1')).toBe('Paint hall')
  })

  it('removes no one: every member keeps syncing in both directions', async () => {
    await rotateKey(dbA, transport(), PROJECT, null)
    for (const db of [dbB, dbC]) {
      const keys = await refreshKeys(db, transport(), PROJECT)
      expect(keys).toEqual({ read: 1, removed: false, problems: [] })
      expect(projectKeyFor(db, PROJECT)!.equals(projectKeyFor(dbA, PROJECT)!)).toBe(true)
    }
    expect(
      dbA.prepare('SELECT COUNT(*) AS n FROM sync_members WHERE removed_at IS NOT NULL').get()
    ).toEqual({ n: 0 })

    rename(dbB, 'item-1', 'Paint the hall')
    await push(dbB)
    expect((await pull(dbA)).problems).toEqual([])
    expect(titleOf(dbA, 'item-1')).toBe('Paint the hall')
    expect((await pull(dbC)).problems).toEqual([])
    expect(titleOf(dbC, 'item-1')).toBe('Paint the hall')

    rename(dbA, 'item-1', 'Paint it blue')
    await push(dbA)
    expect((await pull(dbB)).problems).toEqual([])
    expect(titleOf(dbB, 'item-1')).toBe('Paint it blue')
  })

  it('records when and by whom in the history, on every PC', async () => {
    await rotateKey(dbA, transport(), PROJECT, null)
    await pull(dbB)
    for (const db of [dbA, dbB]) {
      const event = membershipHistory(db, shareId).find((e) => e.kind === 'invites-stopped')
      expect(event).toMatchObject({ byName: 'Ann' })
      expect(event?.at).toBeGreaterThan(0)
    }
  })

  it('is Owner-only: an Editor or Viewer is refused by the Owner check', async () => {
    const asViewer = inviteFor(dbA, PROJECT, 'viewer')!
    const dbD = await openPc('pc-d-')
    await joinShare(dbD, transport(), asViewer, { folder, memberName: 'Dan' })
    expect(() => assertOwner(dbA, PROJECT)).not.toThrow()
    expect(() => assertOwner(dbB, PROJECT)).toThrow('not-an-owner')
    expect(() => assertOwner(dbD, PROJECT)).toThrow('not-an-owner')
  })
})
