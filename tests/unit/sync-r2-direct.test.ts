import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import type { LibraryFileStore } from '../../electron/services/sync/library-files'
import { PERSONAL_FOLDER } from '../../electron/services/sync/pairing'
import type { PendingRequest } from '../../electron/services/sync/personal-space'
import { R2Bridge } from '../../electron/services/sync/r2-bridge'
import {
  isR2Location,
  R2Changes,
  R2Client,
  r2Location,
  R2Transport
} from '../../electron/services/sync/r2-transport'
import { joinPlace, readShareFile, SharingError } from '../../electron/services/sync/sharing'
import { PERSONAL_PROJECT_ID } from '../../electron/services/sync/synced-tables'
import { SyncService } from '../../electron/services/sync/sync-service'
import { PhonePairing } from '../../mobile/src/sync/phone-pairing'
import { countTasks, PhoneSync } from '../../mobile/src/sync/phone-sync'
import { createMigratedDatabase } from '../helpers/database'
import { FAKE_R2, FakeR2 } from '../helpers/fake-r2'
import { useTempDir } from '../helpers/temp-dir'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^enc:/, '')
  }
}))

const HOUSE = 'a1b2c3d4-0000-4000-8000-000000000002'
const noLibrary: LibraryFileStore = {
  syncedOriginal: () => null,
  receiveSyncedOriginal: async () => undefined
}
const config = { ...FAKE_R2, prefix: '' }

async function until(check: () => boolean | Promise<boolean>, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out')
}

describe('R2 as a sync place on the PC: the PC syncs straight against the bucket', () => {
  const tempDir = useTempDir('ostler-r2-direct-')
  const closers: (() => unknown)[] = []

  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close()
  })

  /** The PC with no folder at all: its personal space is `r2:Ostler`, opened through the bridge. */
  const desktop = async (bucket: FakeR2, autoAllow: boolean) => {
    const databasePath = await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), 'pc-')))
    const projects = new Map<string, string>()
    const errors: string[] = []
    const requests: PendingRequest[] = []
    let bridge: R2Bridge | null = null
    const service = new SyncService({
      databasePath,
      library: noLibrary,
      projectSettings: (projectId) => {
        const name = projects.get(projectId)
        return name === undefined ? null : { name, color: '#336699', notes: '', tags: [] }
      },
      projectIds: () => [...projects.keys()],
      onProjectChanged: () => undefined,
      onStateChanged: () => undefined,
      onPairingRequest: (request) => requests.push(request),
      allowDevicesAutomatically: autoAllow,
      memberName: () => 'Ann laptop',
      logError: (message, error) => errors.push(`${message} ${String(error)}`),
      openR2: (place) => {
        if (!bridge) throw new SharingError('no-r2-bucket')
        return bridge.openPlace(place)
      },
      pushCheckMs: 60_000,
      scanIntervalMs: 60_000
    })
    bridge = new R2Bridge({
      dataDir: fs.mkdtempSync(path.join(tempDir(), 'data-')),
      seal: (secret) => secret,
      open: (sealed) => sealed,
      fetch: bucket.fetch,
      spaceFolder: () => null,
      shareFolders: () => [],
      log: (message, error) => errors.push(`${message} ${String(error)}`)
    })
    // Only the bucket's details are needed; folder copying stays off.
    bridge.set({ ...config, checkMinutes: 0, uploadSoon: false, enabled: false })
    service.start()
    bridge.start()
    const db = new Database(databasePath)
    attachChangeRecorder(db)
    const pc = { service, bridge, db, projects, errors, requests }
    closers.push(async () => {
      pc.bridge.stop()
      await service.stop()
      db.close()
    })
    return pc
  }

  /** The phone, as `createPhoneSync` makes it with a bucket and no Google account. */
  const phone = async (bucket: FakeR2) => {
    const db = new Database(
      await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), 'phone-')))
    )
    const client = new R2Client(config, { fetch: bucket.fetch })
    const changes = new R2Changes(client, { intervalMs: null, markDelayMs: 0 })
    const openTransport = (place: string) => new R2Transport(client, place, changes)
    const logged: string[] = []
    const sync = new PhoneSync({
      db,
      openTransport,
      placeFor: async (written, belowRoot) =>
        isR2Location(written) ? written : belowRoot ? r2Location(written) : null,
      poller: { kick: () => undefined },
      now: () => Date.now(),
      deviceName: 'Test phone',
      log: (message, error) => logged.push(`${message} ${String(error)}`),
      setTimer: () => 0,
      clearTimer: () => undefined
    })
    const pairing = new PhonePairing({
      db,
      findSpace: async () => {
        const space = r2Location('Ostler')
        try {
          await readShareFile(openTransport(joinPlace(space, PERSONAL_FOLDER)))
          return space
        } catch {
          return null
        }
      },
      openTransport,
      deviceName: 'Test phone',
      onPaired: () => sync.startPersonal(),
      log: (message, error) => logged.push(`${message} ${String(error)}`),
      setTimer: () => 0,
      clearTimer: () => undefined
    })
    closers.push(async () => {
      pairing.cancel()
      changes.stop()
      await sync.dispose()
      db.close()
    })
    return { sync, pairing, db, changes }
  }

  it('makes the space from the bucket choice at r2:Ostler/Personal, with projects in r2:Ostler/Projects', async () => {
    const bucket = new FakeR2()
    const a = await desktop(bucket, false)
    a.projects.set(HOUSE, 'House')
    // The place Settings › Devices passes for "My own R2 bucket" (R2_PLACE_CHOICE) is the bucket's root.
    await a.service.createPersonalSpace(r2Location(''), 'Ann laptop')
    await a.service.shareUnsharedProjects()
    expect(a.service.personalSpaceFolder()).toBe('r2:Ostler')
    expect(bucket.keys()).toContain('Ostler/Personal/share.json')
    expect(
      a.service.shareFolders().some((place) => place.startsWith('r2:Ostler/Projects/House'))
    ).toBe(true)
  })

  it('pairs a phone and syncs both ways with no folder on the PC', async () => {
    const bucket = new FakeR2()
    const a = await desktop(bucket, false)
    a.projects.set(HOUSE, 'House')
    a.db
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES ('item-1', ?, 'Paint hall', 'ready', 'medium', 'human', 1, 1)`
      )
      .run(HOUSE)
    const space = r2Location('Ostler')
    await a.service.createPersonalSpaceAt(space, 'Ann laptop')
    await a.service.shareUnsharedProjects()
    expect(a.service.personalSpaceFolder()).toBe(space)
    expect(bucket.keys().some((key) => key.startsWith('Ostler/Personal/'))).toBe(true)
    expect(a.service.shareFolders().every(isR2Location)).toBe(true)

    // The phone asks to join; the PC hears of it when the bucket's change marker moves.
    const mobile = await phone(bucket)
    mobile.sync.start()
    await mobile.pairing.start()
    await mobile.changes.mark()
    await a.bridge.syncNow()
    await until(() => a.requests.length === 1)
    expect(a.requests[0].deviceName).toBe('Test phone')

    await a.service.allowDevice(space, a.requests[0].deviceId)
    await mobile.pairing.check()
    expect(mobile.pairing.state().phase).toBe('paired')

    await mobile.sync.syncNow(PERSONAL_PROJECT_ID)
    expect(mobile.sync.shares().map((share) => share.projectId)).toEqual([HOUSE])
    await mobile.sync.syncNow(HOUSE)
    expect(countTasks(mobile.db, HOUSE)).toBe(1)

    // An edit on the phone reaches the PC straight from the bucket.
    mobile.db
      .prepare(
        "UPDATE planning_work_items SET title = 'Paint hall blue', updated_at = 2 WHERE id = 'item-1'"
      )
      .run()
    await mobile.sync.syncAll()
    await a.service.syncNow(HOUSE)
    const row = a.db.prepare("SELECT title FROM planning_work_items WHERE id = 'item-1'").get() as {
      title: string
    }
    expect(row.title).toBe('Paint hall blue')
    expect(a.errors).toEqual([])
  })

  it('lets a phone in automatically once the bucket says something changed', async () => {
    const bucket = new FakeR2()
    const a = await desktop(bucket, true)
    const space = r2Location('Ostler')
    await a.service.createPersonalSpaceAt(space, 'Ann laptop')

    const mobile = await phone(bucket)
    mobile.sync.start()
    await mobile.pairing.start()
    await mobile.changes.mark()
    await a.bridge.syncNow()
    await until(async () => {
      await mobile.pairing.check()
      return mobile.pairing.state().phase === 'paired'
    })
    expect(a.errors).toEqual([])
  })

  it('refuses an r2: place when no bucket is set up', async () => {
    const databasePath = await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), 'pc-')))
    const service = new SyncService({
      databasePath,
      library: noLibrary,
      projectSettings: () => null,
      projectIds: () => [],
      onProjectChanged: () => undefined,
      onStateChanged: () => undefined,
      logError: () => undefined
    })
    closers.push(() => service.stop())
    await expect(service.createPersonalSpaceAt(r2Location('Ostler'), 'PC')).rejects.toMatchObject({
      reason: 'no-r2-bucket'
    })
  })
})
