import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { withSyncApplying } from '../../electron/services/sync/capture'
import { newIdentityKeys, newProjectKey } from '../../electron/services/sync/change-file'
import type { SealKeys } from '../../electron/services/sync/envelope'
import type { LibraryFileStore } from '../../electron/services/sync/library-files'
import { FolderTransport } from '../../electron/services/sync/folder-transport'
import {
  allowDevice,
  applyRevocations,
  completePairing,
  createPersonalSpace,
  devicesOf,
  findPersonalSpace,
  pairingCode,
  pairingCodeInSpace,
  pendingRequests,
  removeDevice,
  requestPairing
} from '../../electron/services/sync/personal-space'
import {
  refreshMembers,
  shareProject,
  joinShare,
  writeMember
} from '../../electron/services/sync/sharing'
import { unwrapWithBoxKey, wrapForBoxKey, refreshKeys } from '../../electron/services/sync/rotation'
import { pullChanges, pushChanges } from '../../electron/services/sync/sync-runner'
import {
  boxKeys,
  identityKeys,
  keyGenerationOf,
  personKeys,
  projectKeyFor,
  projectKeyring,
  storeProjectKey
} from '../../electron/services/sync/sync-keys'
import { PERSONAL_PROJECT_ID } from '../../electron/services/sync/synced-tables'
import { SyncService } from '../../electron/services/sync/sync-service'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

// Sealing needs Electron's safeStorage; a reversible stand-in lets the test seal and open for real.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^enc:/, '')
  }
}))

const PROJECT = 'house-project'
const SETTINGS = { name: 'House', color: '#336699', notes: 'Our house', tags: ['home'] }

describe('the personal space: pairing a device with a code, and removing one', () => {
  const tempDir = useTempDir('ostler-personal-space-')
  let root: string
  let projectFolder: string
  let dbA: Database.Database
  let dbB: Database.Database
  let dbC: Database.Database

  const space = (): string => path.join(root, 'Ostler')
  const personalTransport = (): FolderTransport =>
    new FolderTransport(path.join(space(), 'Personal'))
  const projectTransport = (): FolderTransport => new FolderTransport(projectFolder)

  const openPc = async (name: string): Promise<Database.Database> => {
    const db = new Database(
      await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), name)))
    )
    attachChangeRecorder(db)
    return db
  }

  /** The keys a PC seals its personal changes with: the current generation, as sync does. */
  const personalKeys = (db: Database.Database): SealKeys => ({
    projectKey: projectKeyFor(db, PERSONAL_PROJECT_ID) as Buffer,
    keyGeneration: keyGenerationOf(db, PERSONAL_PROJECT_ID),
    privateKey: identityKeys(db).privateKey
  })

  const countOf = (db: Database.Database, sql: string, ...args: unknown[]): number =>
    (db.prepare(sql).get(...args) as { n: number }).n

  const myDayCount = (db: Database.Database): number =>
    countOf(db, 'SELECT COUNT(*) AS n FROM my_day_entries')

  /** Both PCs get the same planning item, which My Day entries point at. */
  const shareItem = (...dbs: Database.Database[]): void => {
    for (const db of dbs) {
      withSyncApplying(() =>
        db
          .prepare(
            `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
             VALUES ('item-1', ?, 'Paint hall', 'ready', 'medium', 'human', 1, 1)`
          )
          .run(PROJECT)
      )
    }
  }

  const addMyDay = (db: Database.Database, day: string): void => {
    db.prepare(
      `INSERT INTO my_day_entries (day, work_item_id, project_id, order_key, added_at)
       VALUES (?, 'item-1', ?, ?, 1)`
    ).run(day, PROJECT, `k-${day}`)
  }

  /** Makes the personal share on A and pairs B with it, the way the app does it. */
  const pairB = async (): Promise<string> => {
    const deviceB = await requestPairing(dbB, space(), 'Ben phone')
    await allowDevice(dbA, space(), deviceB)
    expect(await completePairing(dbB, space())).toBe('paired')
    // A learns B's member when it next reads the personal share.
    await refreshMembers(
      dbA,
      personalTransport(),
      shareIdOf(dbA, 'personal'),
      projectKeyring(dbA, PERSONAL_PROJECT_ID)
    )
    return deviceB
  }

  const shareIdOf = (db: Database.Database, kind: 'personal' | 'project'): string =>
    (
      db
        .prepare(
          kind === 'personal'
            ? "SELECT share_id FROM sync_shares WHERE kind = 'personal'"
            : "SELECT share_id FROM sync_shares WHERE kind = 'project'"
        )
        .get() as { share_id: string }
    ).share_id

  beforeEach(async () => {
    root = path.join(tempDir(), 'root')
    fs.mkdirSync(root)
    projectFolder = path.join(tempDir(), 'project')
    fs.mkdirSync(projectFolder)
    dbA = await openPc('pc-a')
    dbB = await openPc('pc-b')
    dbC = await openPc('pc-c')
  })

  afterEach(() => {
    dbA.close()
    dbB.close()
    dbC.close()
  })

  it('pairs B with a code: both show the same code, B becomes a member with the same person key, and My Day arrives', async () => {
    shareItem(dbA, dbB)
    expect(await createPersonalSpace(dbA, root, 'Ann laptop')).toBe(space())

    const deviceB = await requestPairing(dbB, space(), 'Ben phone')
    const pending = await pendingRequests(dbA, space())
    expect(pending).toEqual([
      { deviceId: deviceB, deviceName: 'Ben phone', code: expect.stringMatching(/^\d{6}$/) }
    ])
    // B computes the code from the person key in A's certificate: the same six digits A shows.
    expect(await pairingCodeInSpace(dbB, space())).toBe(pending[0].code)

    await allowDevice(dbA, space(), deviceB)
    expect(await completePairing(dbB, space())).toBe('paired')

    expect(personKeys(dbB).publicKey).toBe(personKeys(dbA).publicKey)
    expect(personKeys(dbB).privateKey).toBe(personKeys(dbA).privateKey)
    await refreshMembers(
      dbA,
      personalTransport(),
      shareIdOf(dbA, 'personal'),
      projectKeyring(dbA, PERSONAL_PROJECT_ID)
    )
    expect(
      devicesOf(dbA)
        .map((device) => device.name)
        .sort()
    ).toEqual(['Ann laptop', 'Ben phone'])
    expect(
      devicesOf(dbB)
        .map((device) => device.name)
        .sort()
    ).toEqual(['Ann laptop', 'Ben phone'])
    expect(devicesOf(dbB).find((device) => device.isThisDevice)?.name).toBe('Ben phone')

    addMyDay(dbA, '2026-10-24')
    await pushChanges(dbA, personalTransport(), PERSONAL_PROJECT_ID, personalKeys(dbA))
    const pulled = await pullChanges(dbB, personalTransport(), PERSONAL_PROJECT_ID, {
      projectKey: projectKeyring(dbB, PERSONAL_PROJECT_ID)
    })
    expect(pulled.problems).toEqual([])
    expect(myDayCount(dbB)).toBe(1)
  })

  it('ignores a request whose signature is wrong, and does not list a device again once it is certified', async () => {
    await createPersonalSpace(dbA, root, 'Ann laptop')
    const deviceB = await requestPairing(dbB, space(), 'Ben phone')
    const deviceC = await requestPairing(dbC, space(), 'Carl tablet')

    // Flip the last byte of C's signature.
    const requestFile = path.join(space(), 'devices', 'requests', `${deviceC}.ostlerrequest`)
    const bytes = fs.readFileSync(requestFile)
    bytes[bytes.length - 1] ^= 0xff
    fs.writeFileSync(requestFile, bytes)

    expect((await pendingRequests(dbA, space())).map((request) => request.deviceId)).toEqual([
      deviceB
    ])

    await allowDevice(dbA, space(), deviceB)
    expect(await pendingRequests(dbA, space())).toEqual([])
    expect(await completePairing(dbB, space())).toBe('paired')
    expect(await pendingRequests(dbA, space())).toEqual([])
  })

  it('does not accept a member that claims to be paired without A’s certificate', async () => {
    await createPersonalSpace(dbA, root, 'Ann laptop')
    const deviceB = await pairB()
    expect(deviceB).toMatch(/^[0-9a-f]{32}$/)

    // C writes a keys file wrapped to its own box key, with A's keys, and no certificate from A.
    const deviceC = await requestPairing(dbC, space(), 'Carl tablet')
    const aKeys = personKeys(dbA)
    const payload = {
      personPrivateKey: aKeys.privateKey,
      personPublicKey: aKeys.publicKey,
      shareId: shareIdOf(dbA, 'personal'),
      generation: 0,
      projectKeys: [(projectKeyFor(dbA, PERSONAL_PROJECT_ID) as Buffer).toString('base64')]
    }
    fs.writeFileSync(
      path.join(space(), 'devices', `${deviceC}.ostlerkeys`),
      wrapForBoxKey(
        Buffer.from(JSON.stringify(payload), 'utf8'),
        boxKeys(dbC).publicKey,
        `ostler-pairing:${deviceC}`
      )
    )
    await expect(completePairing(dbC, space())).rejects.toThrow('bad-keys')

    // C then joins the share with its own person key: A and B refuse its member file.
    dbC
      .prepare(
        `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at, kind)
       VALUES (@projectId, @shareId, @folder, @memberId, 'dev-c', 1, 1, 'personal')`
      )
      .run({
        projectId: PERSONAL_PROJECT_ID,
        shareId: payload.shareId,
        folder: path.join(space(), 'Personal'),
        memberId: 'member-c'
      })
    storeProjectKey(dbC, PERSONAL_PROJECT_ID, projectKeyFor(dbA, PERSONAL_PROJECT_ID) as Buffer, 0)
    await writeMember(
      dbC,
      personalTransport(),
      {
        shareId: payload.shareId,
        projectId: PERSONAL_PROJECT_ID,
        projectKey: projectKeyFor(dbA, PERSONAL_PROJECT_ID) as Buffer,
        generation: 0,
        previousKeys: []
      },
      'member-c',
      'Carl tablet',
      null
    )
    const cKey = identityKeys(dbC).publicKey
    const onA = await refreshMembers(
      dbA,
      personalTransport(),
      payload.shareId,
      projectKeyring(dbA, PERSONAL_PROJECT_ID)
    )
    const onB = await refreshMembers(
      dbB,
      personalTransport(),
      payload.shareId,
      projectKeyring(dbB, PERSONAL_PROJECT_ID)
    )
    expect(onA.problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'not-this-person' })])
    )
    expect(onB.problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'not-this-person' })])
    )
    expect(countOf(dbA, 'SELECT COUNT(*) AS n FROM sync_members WHERE public_key = ?', cKey)).toBe(
      0
    )
    expect(countOf(dbB, 'SELECT COUNT(*) AS n FROM sync_members WHERE public_key = ?', cKey)).toBe(
      0
    )
  })

  it('removes B from the personal share and a project share: B shows removed, and A’s new changes are unreadable to B', async () => {
    shareItem(dbA, dbB)
    await createPersonalSpace(dbA, root, 'Ann laptop')
    const deviceB = await pairB()

    // A project both PCs share, joined the way the app does it.
    const invite = await shareProject(dbA, projectTransport(), PROJECT, {
      folder: projectFolder,
      memberName: 'Ann laptop',
      project: SETTINGS
    })
    await joinShare(dbB, projectTransport(), invite, {
      folder: projectFolder,
      memberName: 'Ben phone'
    })
    const projectShare = shareIdOf(dbA, 'project')
    // A reads B's project member file, as its sync does before removing anyone.
    await refreshMembers(dbA, projectTransport(), projectShare, projectKeyring(dbA, PROJECT))
    expect(
      countOf(
        dbA,
        'SELECT COUNT(*) AS n FROM sync_members WHERE share_id = ? AND public_key = ? AND removed_at IS NULL',
        projectShare,
        identityKeys(dbB).publicKey
      )
    ).toBe(1)

    addMyDay(dbA, '2026-10-24')
    await pushChanges(dbA, personalTransport(), PERSONAL_PROJECT_ID, personalKeys(dbA))
    await pullChanges(dbB, personalTransport(), PERSONAL_PROJECT_ID, {
      projectKey: projectKeyring(dbB, PERSONAL_PROJECT_ID)
    })
    expect(myDayCount(dbB)).toBe(1)

    await removeDevice(dbA, space(), deviceB, (folder) => new FolderTransport(folder))

    // A has marked B removed in both shares, and written the revocation.
    expect(devicesOf(dbA).find((device) => device.deviceId === deviceB)?.revoked).toBe(true)
    expect(fs.existsSync(path.join(space(), 'devices', `${deviceB}.ostlerrevoked`))).toBe(true)
    expect(
      countOf(
        dbA,
        'SELECT COUNT(*) AS n FROM sync_members WHERE share_id = ? AND public_key = ? AND removed_at IS NULL',
        projectShare,
        identityKeys(dbB).publicKey
      )
    ).toBe(0)

    // B reads the key changes and learns it was removed, in both shares.
    const personal = await refreshKeys(dbB, personalTransport(), PERSONAL_PROJECT_ID)
    expect(personal.removed).toBe(true)
    expect(devicesOf(dbB).find((device) => device.isThisDevice)?.revoked).toBe(true)
    const project = await refreshKeys(dbB, projectTransport(), PROJECT)
    expect(project.problems).toEqual([])
    expect(project.removed).toBe(true)

    // A's next change is sealed with the new key; B has only the old one.
    addMyDay(dbA, '2026-10-25')
    await pushChanges(dbA, personalTransport(), PERSONAL_PROJECT_ID, personalKeys(dbA))
    const pulled = await pullChanges(dbB, personalTransport(), PERSONAL_PROJECT_ID, {
      projectKey: projectKeyring(dbB, PERSONAL_PROJECT_ID)
    })
    expect(pulled.applied).toBe(0)
    expect(pulled.problems.map((problem) => problem.reason)).toContain('cannot-decrypt')
    expect(myDayCount(dbB)).toBe(1)

    // The revocation is already reflected on B by the key change it came with.
    expect(await applyRevocations(dbB, space())).toBe(0)
  })

  it("gives a paired device the person's Me: B's rows that named its own Me name it, and B's old Me is archived (F4)", async () => {
    const addMe = (db: Database.Database, id: string) =>
      db
        .prepare(
          `INSERT INTO people (id, name, initials, color, is_me, archived_at, created_at, updated_at)
           VALUES (?, 'Ann', 'A', '#336699', 1, NULL, 1, 1)`
        )
        .run(id)
    addMe(dbA, 'ann-1')
    addMe(dbB, 'ann-2')
    shareItem(dbA, dbB)
    dbB.prepare("UPDATE planning_work_items SET assignee_id = 'ann-2' WHERE id = 'item-1'").run()
    await createPersonalSpace(dbA, root, 'Ann laptop')
    await pairB()

    const people = dbB.prepare('SELECT id, is_me, archived_at FROM people ORDER BY id').all() as {
      id: string
      is_me: number
      archived_at: number | null
    }[]
    expect(people.map((person) => [person.id, person.is_me, person.archived_at !== null])).toEqual([
      ['ann-1', 1, false],
      ['ann-2', 0, true]
    ])
    expect(
      (
        dbB.prepare("SELECT assignee_id FROM planning_work_items WHERE id = 'item-1'").get() as {
          assignee_id: string
        }
      ).assignee_id
    ).toBe('ann-1')
  })

  it('gives the same six-digit code for the same two keys, every time', () => {
    const device = newIdentityKeys().publicKey
    const person = newIdentityKeys().publicKey
    const first = pairingCode(device, person)
    expect(first).toMatch(/^\d{6}$/)
    expect(pairingCode(device, person)).toBe(first)
    // A different key pair gives a different code, for almost every pair of keys.
    const codes = new Set(
      Array.from({ length: 20 }, () => pairingCode(newIdentityKeys().publicKey, person))
    )
    expect(codes.size).toBeGreaterThan(1)
    for (const code of codes) expect(code).toMatch(/^\d{6}$/)
  })

  it('never registers the personal share as a project', async () => {
    const onProjectChanged = vi.fn()
    const onStateChanged = vi.fn()
    const projectSettings = vi.fn(() => null)
    const service = new SyncService({
      databasePath: dbA.name,
      library: {} as LibraryFileStore,
      projectSettings,
      onProjectChanged,
      onStateChanged,
      logError: vi.fn(),
      openTransport: (folder) => new FolderTransport(folder, { scanIntervalMs: 60_000 }),
      pushCheckMs: 60_000,
      scanIntervalMs: 60_000
    })
    service.start()
    try {
      await service.createPersonalSpace(path.join(tempDir(), 'root-f'), 'Ann laptop')
      expect(service.personalSpaceFolder()).toBe(path.join(tempDir(), 'root-f', 'Ostler'))
      expect(service.isShared(PERSONAL_PROJECT_ID)).toBe(true)
      expect(onProjectChanged).not.toHaveBeenCalledWith(PERSONAL_PROJECT_ID)
      expect(onStateChanged).not.toHaveBeenCalledWith(PERSONAL_PROJECT_ID)
      expect(findPersonalSpace([tempDir()])).toBe(path.join(tempDir(), 'root-f', 'Ostler'))
    } finally {
      await service.stop()
    }
  })
})

// Used by tests that need a wrapped key round trip without the whole pairing flow.
describe('wrapping a key to a box key', () => {
  it('opens only for the recipient and the same context', async () => {
    const db = new Database(
      await createMigratedDatabase(fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-wrap-')))
    )
    const recipient = boxKeys(db)
    db.close()
    const secret = newProjectKey()
    const wrapped = wrapForBoxKey(secret, recipient.publicKey, 'ctx-one')
    expect(unwrapWithBoxKey(wrapped, recipient.privateKey, 'ctx-one')?.equals(secret)).toBe(true)
    expect(unwrapWithBoxKey(wrapped, recipient.privateKey, 'ctx-two')).toBeNull()
    expect(unwrapWithBoxKey(wrapped, newIdentityKeys().privateKey, 'ctx-one')).toBeNull()
    expect(unwrapWithBoxKey(Buffer.alloc(10), recipient.privateKey, 'ctx-one')).toBeNull()
  })
})
