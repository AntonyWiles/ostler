import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRAND } from '@shared/brand'
import type { ConnectedAccount } from '@shared/ostler-api'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { DriveChangesPoller } from '../../electron/services/sync/drive-changes'
import { DRIVE_FOLDER_MIME } from '../../electron/services/sync/drive-client'
import { DriveSyncSettings } from '../../electron/services/sync/drive-sync-settings'
import { DriveTransport, pollerSubscription } from '../../electron/services/sync/drive-transport'
import type { LibraryFileStore } from '../../electron/services/sync/library-files'
import { PERSONAL_PROJECT_ID } from '../../electron/services/sync/synced-tables'
import { SyncService } from '../../electron/services/sync/sync-service'
import { pairingErrorKey, PhonePairing } from '../../mobile/src/sync/phone-pairing'
import { countTasks, PhoneSync } from '../../mobile/src/sync/phone-sync'
import { createMigratedDatabase } from '../helpers/database'
import { FakeDrive } from '../helpers/fake-drive'
import { useTempDir } from '../helpers/temp-dir'

// Sealing needs Electron's safeStorage; a reversible stand-in lets the services seal and open for real.
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
const googleAccount = { id: 'account-1', provider: 'google' } as ConnectedAccount

describe('the phone pairs as one of the persons devices (mobile plan, prompt 10)', () => {
  const tempDir = useTempDir('ostler-phone-pairing-')
  let drive: FakeDrive
  const closers: (() => unknown)[] = []

  beforeEach(() => {
    drive = new FakeDrive()
    drive.entries.set('root', {
      id: 'root',
      name: 'My Drive',
      mimeType: DRIVE_FOLDER_MIME,
      createdTime: '2026-01-01T00:00:00.000Z',
      parent: '',
      bytes: null
    })
  })

  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close()
  })

  /** The desktop: a `SyncService` through the fake Drive. */
  const desktop = async (name: string) => {
    const databasePath = await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), name)))
    const settings = new DriveSyncSettings({
      accountsWithDrive: () => [googleAccount],
      call: () => Promise.reject(new Error('unused')),
      client: drive
    })
    const projects = new Map<string, string>()
    const errors: string[] = []
    const service = new SyncService({
      databasePath,
      library: noLibrary,
      projectSettings: (projectId) => {
        const projectName = projects.get(projectId)
        return projectName === undefined
          ? null
          : { name: projectName, color: '#336699', notes: '', tags: [] }
      },
      projectIds: () => [...projects.keys()],
      registerJoinedProject: (joined) => {
        projects.set(joined.projectId, joined.project?.name ?? 'Shared project')
      },
      onProjectChanged: () => undefined,
      onStateChanged: () => undefined,
      memberName: () => name,
      logError: (message, error) => errors.push(`${message} ${String(error)}`),
      openDrive: (place: string) => settings.open(place),
      pushCheckMs: 60_000,
      scanIntervalMs: 60_000
    })
    service.start()
    const db = new Database(databasePath)
    attachChangeRecorder(db)
    closers.push(async () => {
      await service.stop()
      db.close()
    })
    return { settings, service, db, projects, errors }
  }

  /** The phone: a `PhoneSync` and a `PhonePairing` on one migrated database, one poller, no timers. */
  const phone = async () => {
    const db = new Database(
      await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), 'phone-')))
    )
    const poller = new DriveChangesPoller(drive, {
      setTimer: () => 0,
      clearTimer: () => undefined
    })
    const openTransport = (place: string) =>
      new DriveTransport(drive, place, { subscribe: pollerSubscription(poller) })
    const logged: string[] = []
    const names = new Map<string, string>()
    const sync = new PhoneSync({
      db,
      openTransport,
      poller,
      now: () => Date.now(),
      deviceName: 'Test phone',
      log: (message, error) => logged.push(`${message} ${String(error)}`),
      onJoined: (result) => names.set(result.projectId, result.project?.name ?? ''),
      setTimer: () => 0,
      clearTimer: () => undefined
    })
    let paired = 0
    const pairing = new PhonePairing({
      db,
      client: drive,
      openTransport,
      deviceName: 'Test phone',
      onPaired: () => {
        paired += 1
        sync.startPersonal()
      },
      log: (message, error) => logged.push(`${message} ${String(error)}`),
      setTimer: () => 0,
      clearTimer: () => undefined
    })
    closers.push(async () => {
      pairing.cancel()
      await sync.dispose()
      db.close()
    })
    return { sync, pairing, db, logged, names, paired: () => paired }
  }

  const insertItem = (db: Database.Database, id: string, title: string) =>
    db
      .prepare(
        `INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at)
         VALUES (?, ?, ?, 'ready', 'medium', 'human', 1, 1)`
      )
      .run(id, HOUSE, title)

  it('pairs with the code and the PC project arrives in the phone database', async () => {
    const a = await desktop('pc-a')
    a.projects.set(HOUSE, 'House')
    insertItem(a.db, 'item-1', 'Paint hall')
    insertItem(a.db, 'item-2', 'Fix gate')
    const root = (await a.settings.rootPlace(true)) as string
    await a.service.createPersonalSpace(root, 'Ann laptop')
    await a.service.shareUnsharedProjects()

    const mobile = await phone()
    mobile.sync.start()
    const phases: string[] = []
    mobile.pairing.subscribe((state) => phases.push(state.phase))
    expect(mobile.pairing.state().phase).toBe('idle')

    await mobile.pairing.start()
    expect(mobile.pairing.state().phase).toBe('waiting')
    const [request] = await a.service.pendingPairingRequests(root)
    expect(request.deviceName).toBe('Test phone')
    // The phone shows the same code as the PC.
    expect(mobile.pairing.state().code).toBe(request.code)
    expect(mobile.pairing.state().code).toMatch(/^\d{6}$/)

    // Nothing happens until the person allows it on the PC.
    await mobile.pairing.check()
    expect(mobile.pairing.state().phase).toBe('waiting')
    expect(mobile.sync.paired()).toBe(false)

    await a.service.allowDevice(root, request.deviceId)
    await mobile.pairing.check()
    expect(mobile.pairing.state().phase).toBe('paired')
    expect(mobile.paired()).toBe(1)
    expect(mobile.sync.paired()).toBe(true)
    expect(phases).toContain('paired')

    // The PC lists the phone as one of the persons devices.
    await a.service.syncNow(PERSONAL_PROJECT_ID)
    expect(a.service.personalDevices().map((device) => device.name)).toContain('Test phone')

    // The personal share runs on the phone and joins the project the PC listed there.
    await mobile.sync.syncNow(PERSONAL_PROJECT_ID)
    expect(mobile.sync.shares().map((share) => share.projectId)).toEqual([HOUSE])
    await mobile.sync.syncNow(HOUSE)
    expect(countTasks(mobile.db, HOUSE)).toBe(2)
    expect(mobile.names.get(HOUSE)).toBe('House')
    expect(a.errors).toEqual([])
  })

  it('stays paired: starting again changes nothing', async () => {
    const a = await desktop('pc-a')
    const root = (await a.settings.rootPlace(true)) as string
    await a.service.createPersonalSpace(root, 'Ann laptop')
    const mobile = await phone()
    await mobile.pairing.start()
    const [request] = await a.service.pendingPairingRequests(root)
    await a.service.allowDevice(root, request.deviceId)
    await mobile.pairing.check()
    expect(mobile.pairing.state().phase).toBe('paired')

    await mobile.pairing.start()
    expect(mobile.pairing.state().phase).toBe('paired')
    expect(mobile.paired()).toBe(1)
  })

  it('says so when Ostler has no personal space in Drive', async () => {
    const mobile = await phone()
    await mobile.pairing.start()
    expect(mobile.pairing.state()).toEqual({ phase: 'failed', code: null, failure: 'no-space' })
    expect(pairingErrorKey('no-space')).toBe('mobile:pairing.errors.noSpace')

    // A folder named for the brand that holds no personal share is no space either.
    drive.entries.set('brandFolder0001', {
      id: 'brandFolder0001',
      name: BRAND.name,
      mimeType: DRIVE_FOLDER_MIME,
      createdTime: '2026-01-02T00:00:00.000Z',
      parent: 'root',
      bytes: null
    })
    await mobile.pairing.start()
    expect(mobile.pairing.state().failure).toBe('no-space')
  })
})
