import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRAND } from '@shared/brand'
import type { ConnectedAccount } from '@shared/ostler-api'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { DRIVE_FOLDER_MIME } from '../../electron/services/sync/drive-client'
import { DriveSyncSettings } from '../../electron/services/sync/drive-sync-settings'
import { driveLocation, isDriveLocation } from '../../electron/services/sync/drive-transport'
import type { LibraryFileStore } from '../../electron/services/sync/library-files'
import { joinPlace, parentPlace } from '../../electron/services/sync/sharing'
import { SyncService } from '../../electron/services/sync/sync-service'
import { PERSONAL_PROJECT_ID } from '../../electron/services/sync/synced-tables'
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

describe('joinPlace and parentPlace', () => {
  it('extends a Drive place, joins a folder and refuses a server place', () => {
    const drive = driveLocation('folderId0001')
    expect(joinPlace(drive, 'Personal')).toBe('gdrive:folderId0001/Personal')
    expect(joinPlace('gdrive:folderId0001/Projects', 'House (a1b2c3d4)')).toBe(
      'gdrive:folderId0001/Projects/House (a1b2c3d4)'
    )
    expect(joinPlace(path.join('x', 'root'), 'devices')).toBe(path.join('x', 'root', 'devices'))
    expect(() => joinPlace('https://sync.example.com/spaces/abc', 'devices')).toThrow()
  })

  it('finds the place that holds a place', () => {
    expect(parentPlace('gdrive:folderId0001/Personal')).toBe('gdrive:folderId0001')
    expect(parentPlace('gdrive:folderId0001/Projects/House')).toBe('gdrive:folderId0001/Projects')
    expect(parentPlace(path.join('x', 'root', 'Ostler'))).toBe(path.join('x', 'root'))
  })
})

describe('the personal space in Google Drive (mobile plan, phase 5)', () => {
  const tempDir = useTempDir('ostler-personal-drive-')
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

  const pc = async (name: string) => {
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
    return { name, settings, service, db, projects, errors }
  }

  const namesIn = (parent: string) =>
    [...drive.entries.values()].filter((e) => e.parent === parent).map((e) => e.name)

  it('makes the space in Drive, pairs a second device with the code, and passes it a project', async () => {
    const a = await pc('pc-a')
    const b = await pc('pc-b')
    a.projects.set(HOUSE, 'House')

    const root = (await a.settings.rootPlace(true)) as string
    expect(isDriveLocation(root)).toBe(true)
    await a.service.createPersonalSpace(root, 'Ann laptop')
    await a.service.shareUnsharedProjects()

    // D3: the layout in Drive is the one in a folder, directly in the brand folder.
    const brand = [...drive.entries.values()].find(
      (e) => e.parent === 'root' && e.name === BRAND.name
    )!
    expect(namesIn(brand.id).sort()).toEqual(['Personal', 'Projects', 'devices'])
    expect(a.service.personalSpaceFolder()).toBe(root)

    // B (the same Google account) finds the space, shows the same code as A and joins.
    expect(await b.settings.rootPlace(false)).toBe(root)
    const deviceB = await b.service.requestPairing(root, 'Ben phone')
    const [request] = await a.service.pendingPairingRequests(root)
    expect(request.deviceId).toBe(deviceB)
    expect(await b.service.joinCodeFor(root)).toBe(request.code)
    await a.service.allowDevice(root, deviceB)
    expect(await b.service.completePairing(root)).toBe('paired')
    expect(b.service.personalSpaceFolder()).toBe(root)
    await a.service.syncNow(PERSONAL_PROJECT_ID)

    // The project A shared into the personal space reaches B from A's entry.
    await b.service.syncNow(PERSONAL_PROJECT_ID)
    expect([...b.projects.keys()]).toEqual([HOUSE])
    expect(a.errors).toEqual([])
    expect(b.errors).toEqual([])
  })
})
