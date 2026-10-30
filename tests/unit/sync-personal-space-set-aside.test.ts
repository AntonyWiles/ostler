import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectedAccount } from '@shared/ostler-api'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { DriveSyncSettings } from '../../electron/services/sync/drive-sync-settings'
import { driveLocation } from '../../electron/services/sync/drive-transport'
import { oldSpaceFolderName } from '../../electron/services/sync/pairing'
import {
  allowDevice,
  completePairing,
  createPersonalSpace,
  createPersonalSpaceAt,
  devicesOf,
  pendingRequests,
  requestPairing,
  setAsideFolderSpace
} from '../../electron/services/sync/personal-space'
import { createMigratedDatabase } from '../helpers/database'
import { FakeDrive } from '../helpers/fake-drive'

// Sealing needs Electron's safeStorage; a reversible stand-in lets the test seal and open for real.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`enc:${value}`),
    decryptString: (buffer: Buffer) => buffer.toString('utf8').replace(/^enc:/, '')
  }
}))

const NOW = new Date('2026-10-29T03:00:00Z')

describe('oldSpaceFolderName', () => {
  it('names the folder by the day, and numbers it when that name is taken', () => {
    expect(oldSpaceFolderName(NOW, new Set())).toBe('Old personal space 2026-10-29')
    expect(
      oldSpaceFolderName(
        NOW,
        new Set(['old personal space 2026-10-29', 'Old personal space 2026-10-29 (2)'])
      )
    ).toBe('Old personal space 2026-10-29 (3)')
  })
})

describe('setting a personal space aside in a synced folder', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-set-aside-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('moves Personal and devices into an "Old personal space" folder and deletes nothing', () => {
    const space = path.join(tempDir, 'Ostler')
    fs.mkdirSync(path.join(space, 'Personal'), { recursive: true })
    fs.mkdirSync(path.join(space, 'devices'))
    fs.writeFileSync(path.join(space, 'Personal', 'share.json'), '{}')
    fs.mkdirSync(path.join(space, 'Garden'))

    const name = setAsideFolderSpace(space, NOW)

    expect(name).toBe('Old personal space 2026-10-29')
    expect(fs.readdirSync(space).sort()).toEqual(['Garden', name])
    expect(fs.readdirSync(path.join(space, name)).sort()).toEqual(['Personal', 'devices'])
    expect(fs.existsSync(path.join(space, name, 'Personal', 'share.json'))).toBe(true)
  })

  it('makes no folder when there is nothing to set aside', () => {
    const space = path.join(tempDir, 'Ostler')
    fs.mkdirSync(space)
    setAsideFolderSpace(space, NOW)
    expect(fs.readdirSync(space)).toEqual([])
  })
})

describe('DriveSyncSettings.setAsideSpace', () => {
  const account = { id: 'account-1', provider: 'google' } as ConnectedAccount
  const settings = (drive: FakeDrive): DriveSyncSettings =>
    new DriveSyncSettings({
      accountsWithDrive: () => [account],
      call: () => Promise.reject(new Error('no network in this test')),
      client: drive
    })

  it('moves the space’s own Drive folders into a new folder inside it, at a sub-path too', async () => {
    const drive = new FakeDrive()
    const top = drive.seedFolder('Shared', drive.rootFolderId)
    const space = drive.seedFolder('Ostler', top)
    const personal = drive.seedFolder('Personal', space)
    const devices = drive.seedFolder('devices', space)
    const other = drive.seedFolder('Garden', space)

    const name = await settings(drive).setAsideSpace(driveLocation(top, 'Ostler'), NOW)

    expect(name).toBe('Old personal space 2026-10-29')
    const children = await drive.listChildren(space)
    const holder = children.find((file) => file.name === name)
    expect(children.map((file) => file.name).sort()).toEqual(['Garden', name])
    expect(drive.entries.get(personal)?.parent).toBe(holder?.id)
    expect(drive.entries.get(devices)?.parent).toBe(holder?.id)
    expect(drive.entries.get(other)?.parent).toBe(space)
  })

  it('refuses a sub-path that is not there', async () => {
    const drive = new FakeDrive()
    const top = drive.seedFolder('Shared', drive.rootFolderId)
    await expect(
      settings(drive).setAsideSpace(driveLocation(top, 'Missing'), NOW)
    ).rejects.toMatchObject({ reason: 'not-an-invite' })
  })
})

describe('starting a new personal space where an orphaned one was', () => {
  let tempDir: string
  let dbs: Database.Database[]

  const openPc = async (name: string): Promise<Database.Database> => {
    const db = new Database(await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir, name))))
    attachChangeRecorder(db)
    dbs.push(db)
    return db
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-new-space-'))
    dbs = []
  })

  afterEach(() => {
    for (const db of dbs) db.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('lets a PC stuck waiting on a space with no devices start a new one, and pair another device into it', async () => {
    const root = path.join(tempDir, 'root')
    fs.mkdirSync(root)
    const gone = await openPc('gone')
    const stuck = await openPc('stuck')
    const phone = await openPc('phone')

    // The only device of the old space is gone; this PC asked to join and can never be allowed.
    const space = await createPersonalSpace(gone, root, 'Old laptop')
    await requestPairing(stuck, space, 'Test bed')
    expect(await completePairing(stuck, space)).not.toBe('paired')

    setAsideFolderSpace(space, NOW)
    await createPersonalSpaceAt(stuck, space, 'Test bed')

    expect(devicesOf(stuck).map((device) => device.name)).toEqual(['Test bed'])
    const deviceId = await requestPairing(phone, space, 'Phone')
    expect((await pendingRequests(stuck, space)).map((request) => request.deviceId)).toEqual([
      deviceId
    ])
    await allowDevice(stuck, space, deviceId)
    expect(await completePairing(phone, space)).toBe('paired')
    expect(
      fs.existsSync(path.join(space, 'Old personal space 2026-10-29', 'Personal', 'share.json'))
    ).toBe(true)
  })
})
