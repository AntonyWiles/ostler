import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import type { LibraryFileStore } from '../../electron/services/sync/library-files'
import { PERSONAL_FOLDER } from '../../electron/services/sync/pairing'
import { R2Bridge } from '../../electron/services/sync/r2-bridge'
import {
  isR2Location,
  R2Changes,
  R2Client,
  r2Location,
  R2Transport
} from '../../electron/services/sync/r2-transport'
import { joinPlace, readShareFile } from '../../electron/services/sync/sharing'
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

const HOUSE = 'a1b2c3d4-0000-4000-8000-000000000001'
const noLibrary: LibraryFileStore = {
  syncedOriginal: () => null,
  receiveSyncedOriginal: async () => undefined
}
const config = { ...FAKE_R2, prefix: '' }

describe('advanced sync: the phone is one of the PC’s devices through an R2 bucket', () => {
  const tempDir = useTempDir('ostler-r2-phone-')
  const closers: (() => unknown)[] = []

  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close()
  })

  /** The PC: its personal space in a plain folder, copied to the bucket by the bridge. */
  const desktop = async (bucket: FakeR2) => {
    const databasePath = await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), 'pc-')))
    const projects = new Map<string, string>()
    const errors: string[] = []
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
      memberName: () => 'Ann laptop',
      logError: (message, error) => errors.push(`${message} ${String(error)}`),
      pushCheckMs: 60_000,
      scanIntervalMs: 60_000
    })
    service.start()
    const bridge = new R2Bridge({
      dataDir: fs.mkdtempSync(path.join(tempDir(), 'data-')),
      seal: (secret) => secret,
      open: (sealed) => sealed,
      fetch: bucket.fetch,
      spaceFolder: () => service.personalSpaceFolder(),
      shareFolders: () => service.shareFolders(),
      log: (message, error) => errors.push(`${message} ${String(error)}`)
    })
    bridge.start()
    const db = new Database(databasePath)
    attachChangeRecorder(db)
    closers.push(async () => {
      bridge.stop()
      await service.stop()
      db.close()
    })
    return { service, bridge, db, projects, errors }
  }

  /** The phone, as `createPhoneSync` makes it with a bucket and no Google account. */
  const phone = async (bucket: FakeR2) => {
    const db = new Database(
      await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), 'phone-')))
    )
    const client = new R2Client(config, { fetch: bucket.fetch })
    const changes = new R2Changes(client, { intervalMs: null })
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
    return { sync, pairing, db, logged, changes }
  }

  it('pairs, brings every project down and carries the phone’s edits back to the PC', async () => {
    const bucket = new FakeR2()
    const a = await desktop(bucket)
    a.projects.set(HOUSE, 'House')
    for (const [id, title] of [
      ['item-1', 'Paint hall'],
      ['item-2', 'Fix gate']
    ]) {
      a.db
        .prepare(
          `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
           VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
        )
        .run(id, HOUSE, title)
    }
    const root = path.join(tempDir(), 'Synced')
    fs.mkdirSync(root)
    await a.service.createPersonalSpace(root, 'Ann laptop')
    await a.service.shareUnsharedProjects()
    const space = a.service.personalSpaceFolder() as string
    expect(path.basename(space)).toBe('Ostler')

    a.bridge.set({ ...config, checkMinutes: 0, uploadSoon: false, enabled: true })
    await a.bridge.syncNow()
    expect(bucket.keys().some((key) => key.startsWith('Ostler/Personal/'))).toBe(true)

    // The phone asks to join through the bucket; the PC sees the request after copying.
    const mobile = await phone(bucket)
    mobile.sync.start()
    await mobile.pairing.start()
    expect(mobile.pairing.state().phase).toBe('waiting')
    await a.bridge.syncNow()
    const [request] = await a.service.pendingPairingRequests(space)
    expect(request.deviceName).toBe('Test phone')
    await mobile.pairing.check()
    expect(mobile.pairing.state().code).toBe(request.code)

    await a.service.allowDevice(space, request.deviceId)
    await a.bridge.syncNow()
    await mobile.pairing.check()
    expect(mobile.pairing.state().phase).toBe('paired')

    // Every project of the PC arrives, without sharing it with anyone.
    await mobile.sync.syncNow(PERSONAL_PROJECT_ID)
    expect(mobile.sync.shares().map((share) => share.projectId)).toEqual([HOUSE])
    expect(mobile.sync.shares()[0].place.startsWith('r2:Ostler/Projects/')).toBe(true)
    await mobile.sync.syncNow(HOUSE)
    expect(countTasks(mobile.db, HOUSE)).toBe(2)

    // An edit on the phone reaches the PC: phone → bucket → PC folder → PC database.
    mobile.db
      .prepare(
        "UPDATE planning_work_items SET title = 'Paint hall blue', updated_at = 2 WHERE id = 'item-1'"
      )
      .run()
    await mobile.sync.syncAll()
    const pulled = await a.bridge.syncNow()
    expect(pulled.lastDownloaded).toBeGreaterThan(0)
    await a.service.syncNow(HOUSE)
    expect(
      (
        a.db.prepare("SELECT title FROM planning_work_items WHERE id = 'item-1'").get() as {
          title: string
        }
      ).title
    ).toBe('Paint hall blue')
    expect(a.errors).toEqual([])
  })

  it('stays inside R2’s free tier for a day of looking every 5 minutes', async () => {
    const bucket = new FakeR2()
    const mobile = await phone(bucket)
    for (let i = 0; i < 288; i++) await mobile.changes.check()
    expect(bucket.classA).toBe(0)
    expect(bucket.classB).toBe(288)
  })
})
