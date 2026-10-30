import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { randomUUID } from 'node:crypto'
import { newIdentityKeys, type IdentityKeys } from '../../electron/services/sync/change-file'
import { sealEnvelope } from '../../electron/services/sync/envelope'
import { FolderTransport, type SyncTransport } from '../../electron/services/sync/folder-transport'
import { isOwner, recordMyRole } from '../../electron/services/sync/roles'
import { personKeys } from '../../electron/services/sync/sync-keys'
import {
  forgetUnfinishedShares,
  inviteFor,
  joinShare,
  MEMBER_FILE,
  parseInvite,
  refreshMembers,
  shareProject,
  SharingError
} from '../../electron/services/sync/sharing'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import { certifyDevice, identityKeys, projectKeyFor } from '../../electron/services/sync/sync-keys'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const PROJECT = 'house-project'
const SETTINGS = { name: 'House', color: '#336699', notes: 'Our house', tags: ['home'] }

describe('sharing a project and joining it', () => {
  const tempDir = useTempDir('ostler-sync-sharing-')
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

  const insertItem = (db: Database.Database, id: string, title: string) =>
    db
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
      )
      .run(id, PROJECT, title)

  const titleOf = (db: Database.Database, id: string): string | undefined =>
    (
      db.prepare('SELECT title FROM planning_work_items WHERE id = ?').get(id) as
        { title: string } | undefined
    )?.title

  const keysOf = (db: Database.Database) => ({
    projectKey: projectKeyFor(db, PROJECT)!,
    privateKey: identityKeys(db).privateKey
  })

  const reasonOf = async (call: () => Promise<unknown>): Promise<string> => {
    try {
      await call()
    } catch (error) {
      if (error instanceof SharingError) return error.reason
      throw error
    }
    throw new Error('expected a refusal')
  }

  beforeEach(async () => {
    folder = path.join(tempDir(), 'shared')
    fs.mkdirSync(folder)
    dbA = await openPc('pc-a-')
    dbB = await openPc('pc-b-')
  })

  afterEach(() => {
    dbA.close()
    dbB.close()
  })

  it('shares from A, joins from B, and changes travel both ways', async () => {
    insertItem(dbA, 'item-1', 'Paint hall')
    const invite = await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    expect(invite).toMatch(/^ostler-invite:1:[A-Za-z0-9_-]+$/)
    expect(inviteFor(dbA, PROJECT)).toBe(invite)
    expect(fs.existsSync(path.join(folder, 'share.json'))).toBe(true)

    const joined = await joinShare(dbB, transport(), invite, { folder, memberName: 'Ben' })
    expect(joined.projectId).toBe(PROJECT)
    expect(joined.project).toEqual(SETTINGS)
    expect(titleOf(dbB, 'item-1')).toBe('Paint hall')
    expect(dbB.prepare('SELECT name FROM sync_members ORDER BY name').all()).toEqual([
      { name: 'Ann' },
      { name: 'Ben' }
    ])

    dbB
      .prepare('UPDATE planning_work_items SET title = ? WHERE id = ?')
      .run('Paint the hall', 'item-1')
    await pushChanges(dbB, transport(), PROJECT, keysOf(dbB))

    const shareId = parseInvite(invite).shareId
    const refreshed = await refreshMembers(dbA, transport(), shareId, keysOf(dbA).projectKey)
    expect(refreshed).toEqual({ members: 2, problems: [] })
    const pulled = await pullChanges(dbA, transport(), PROJECT, keysOf(dbA))
    expect(pulled).toMatchObject({ files: 1, problems: [] })
    expect(titleOf(dbA, 'item-1')).toBe('Paint the hall')

    insertItem(dbA, 'item-2', 'Fix door')
    await pushChanges(dbA, transport(), PROJECT, keysOf(dbA))
    await pullChanges(dbB, transport(), PROJECT, keysOf(dbB))
    expect(titleOf(dbB, 'item-2')).toBe('Fix door')
  })

  /** A folder that takes no files under `refused` (a path prefix), the way G:\ refuses them. */
  const refusing = (refused: string): SyncTransport => {
    const inner = transport()
    return {
      list: (prefix) => inner.list(prefix),
      read: (file) => inner.read(file),
      watch: (onChange) => inner.watch(onChange),
      writeOnce: (file, bytes) =>
        file.startsWith(refused)
          ? Promise.reject(new Error('EPERM: operation not permitted'))
          : inner.writeOnce(file, bytes)
    }
  }

  const countIn = (db: Database.Database, table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

  const myRoleIn = (db: Database.Database): string =>
    (
      db.prepare('SELECT my_role FROM sync_shares WHERE project_id = ?').get(PROJECT) as {
        my_role: string
      }
    ).my_role

  it('makes the sharer the Owner on record, in step with the folder', async () => {
    const invite = await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    const shareId = parseInvite(invite).shareId
    expect(isOwner(dbA, shareId, personKeys(dbA).publicKey)).toBe(true)
    expect(myRoleIn(dbA)).toBe('owner')
    const share = dbA.prepare('SELECT last_synced_at FROM sync_shares').get() as {
      last_synced_at: number | null
    }
    expect(share.last_synced_at).not.toBeNull()
  })

  it('keeps nothing when the folder refuses a file, so sharing again works', async () => {
    for (const refused of ['share.json', 'members/', 'roles/', 'snapshots/']) {
      await expect(
        shareProject(dbA, refusing(refused), PROJECT, {
          folder,
          memberName: 'Ann',
          project: SETTINGS
        })
      ).rejects.toThrow('EPERM')
      for (const table of ['sync_shares', 'sync_members', 'sync_keys', 'sync_roles']) {
        expect({ refused, table, n: countIn(dbA, table) }).toEqual({ refused, table, n: 0 })
      }
      // What was written before the refusal stays; a fresh folder for the next try.
      folder = path.join(tempDir(), `shared-${refused.replace(/\W/g, '')}`)
      fs.mkdirSync(folder)
    }
    const invite = await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    expect(inviteFor(dbA, PROJECT)).toBe(invite)
  })

  it('keeps nothing when a join stops before the project arrives', async () => {
    const invite = await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    fs.rmSync(path.join(folder, 'snapshots'), { recursive: true, force: true })
    expect(
      await reasonOf(() => joinShare(dbB, transport(), invite, { folder, memberName: 'Ben' }))
    ).toBe('no-snapshot')
    for (const table of ['sync_shares', 'sync_members', 'sync_keys', 'sync_roles']) {
      expect({ table, n: countIn(dbB, table) }).toEqual({ table, n: 0 })
    }
  })

  it('keeps no share when the first pull fails, so the join can start again', async () => {
    const invite = await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    const inner = transport()
    const failingPull: SyncTransport = {
      list: (prefix) =>
        prefix.startsWith('changes')
          ? Promise.reject(new Error('Drive did not answer'))
          : inner.list(prefix),
      read: (file) => inner.read(file),
      watch: (onChange) => inner.watch(onChange),
      writeOnce: (file, bytes) => inner.writeOnce(file, bytes)
    }
    await expect(
      joinShare(dbB, failingPull, invite, { folder, memberName: 'Ben' })
    ).rejects.toThrow('Drive did not answer')
    for (const table of ['sync_shares', 'sync_members', 'sync_keys', 'sync_roles']) {
      expect({ table, n: countIn(dbB, table) }).toEqual({ table, n: 0 })
    }
    const joined = await joinShare(dbB, transport(), invite, { folder, memberName: 'Ben' })
    expect(joined.projectId).toBe(PROJECT)
  })

  it('forgets a share that never finished, and only that one', async () => {
    await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    expect(forgetUnfinishedShares(dbA)).toEqual([])
    expect(countIn(dbA, 'sync_shares')).toBe(1)

    // The state a share that stopped before its member was written left behind.
    dbA.prepare('DELETE FROM sync_members').run()
    expect(forgetUnfinishedShares(dbA)).toEqual([PROJECT])
    for (const table of ['sync_shares', 'sync_keys', 'sync_roles', 'sync_role_files']) {
      expect({ table, n: countIn(dbA, table) }).toEqual({ table, n: 0 })
    }
  })

  it('never records a role short of the record as Owner', async () => {
    const invite = await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    const shareId = parseInvite(invite).shareId
    // No roles at all: this PC may edit, but it is no Owner until one is on record.
    dbA.prepare('DELETE FROM sync_roles').run()
    recordMyRole(dbA, shareId)
    expect(myRoleIn(dbA)).toBe('editor')
    expect(inviteFor(dbA, PROJECT)).toBeNull()
  })

  it('refuses a bad invite, a different share folder, and sharing twice', async () => {
    const invite = await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    expect(
      await reasonOf(() => joinShare(dbB, transport(), 'hello', { folder, memberName: 'Ben' }))
    ).toBe('not-an-invite')
    expect(
      await reasonOf(() =>
        shareProject(dbA, transport(), PROJECT, { folder, memberName: 'Ann', project: SETTINGS })
      )
    ).toBe('already-shared')

    const otherFolder = path.join(tempDir(), 'other')
    fs.mkdirSync(otherFolder)
    expect(
      await reasonOf(() =>
        joinShare(dbB, new FolderTransport(otherFolder), invite, {
          folder: otherFolder,
          memberName: 'Ben'
        })
      )
    ).toBe('not-a-share-folder')
    expect(dbB.prepare('SELECT COUNT(*) AS n FROM sync_shares').get()).toEqual({ n: 0 })
  })

  it('ignores a member file whose name does not match the member inside it', async () => {
    const invite = await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    fs.copyFileSync(
      path.join(folder, 'members', fs.readdirSync(path.join(folder, 'members'))[0]),
      path.join(folder, 'members', 'intruder.ostlermember')
    )
    const { shareId, projectKey } = parseInvite(invite)
    const refreshed = await refreshMembers(dbA, transport(), shareId, projectKey)
    expect(refreshed.members).toBe(1)
    expect(refreshed.problems).toEqual([
      { path: 'members/intruder.ostlermember', reason: 'mismatch' }
    ])
  })

  /** Writes a member file for `device` into the share folder, as an older or a newer build would. */
  const writeMemberFile = async (
    invite: string,
    device: IdentityKeys,
    payload: Record<string, unknown>
  ): Promise<string> => {
    const { shareId, projectKey } = parseInvite(invite)
    const memberId = randomUUID()
    const bytes = sealEnvelope(
      MEMBER_FILE,
      { formatVersion: 1, shareId, memberId, publicKey: device.publicKey },
      { joinedAt: 5, ...payload },
      { projectKey, keyGeneration: 0, privateKey: device.privateKey }
    )
    await transport().writeOnce(`members/${memberId}.ostlermember`, bytes)
    return memberId
  }

  it('keeps a device whose certificate is from another device key as its own person, and reports it', async () => {
    const invite = await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    const device = newIdentityKeys()
    const person = newIdentityKeys()
    const otherDevice = newIdentityKeys()
    const certificate = certifyDevice(person, {
      publicKey: otherDevice.publicKey,
      boxPublicKey: 'box',
      name: 'Ben'
    })
    const memberId = await writeMemberFile(invite, device, {
      name: 'Ben',
      boxPublicKey: 'box',
      personPublicKey: person.publicKey,
      certificate
    })

    const { shareId, projectKey } = parseInvite(invite)
    const refreshed = await refreshMembers(dbA, transport(), shareId, projectKey)
    expect(refreshed.problems).toEqual([
      { path: `members/${memberId}.ostlermember`, reason: 'bad-certificate' }
    ])
    expect(
      dbA
        .prepare('SELECT person_public_key, certificate, me FROM sync_members WHERE member_id = ?')
        .get(memberId)
    ).toEqual({ person_public_key: device.publicKey, certificate: null, me: null })
  })

  it('lets a member file from before person keys join as its own person, with no problem', async () => {
    const invite = await shareProject(dbA, transport(), PROJECT, {
      folder,
      memberName: 'Ann',
      project: SETTINGS
    })
    const device = newIdentityKeys()
    const memberId = await writeMemberFile(invite, device, { name: 'Ben', boxPublicKey: 'box' })

    const { shareId, projectKey } = parseInvite(invite)
    expect(await refreshMembers(dbA, transport(), shareId, projectKey)).toEqual({
      members: 2,
      problems: []
    })
    expect(
      dbA
        .prepare('SELECT person_public_key, certificate, me FROM sync_members WHERE member_id = ?')
        .get(memberId)
    ).toEqual({ person_public_key: device.publicKey, certificate: null, me: null })
  })
})
