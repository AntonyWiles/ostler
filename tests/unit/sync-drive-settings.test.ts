import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectedAccount } from '@shared/ostler-api'
import { DriveSyncSettings } from '../../electron/services/sync/drive-sync-settings'
import { driveLocation } from '../../electron/services/sync/drive-transport'
import { SharingError } from '../../electron/services/sync/sharing'
import { FakeDrive } from '../helpers/fake-drive'

const googleAccount = { id: 'account-1', provider: 'google' } as ConnectedAccount
const unusedCall = () => Promise.reject(new Error('no network in this test'))

function settings(drive: FakeDrive, accounts: ConnectedAccount[] = [googleAccount]) {
  return new DriveSyncSettings({
    accountsWithDrive: () => accounts,
    call: unusedCall,
    client: drive
  })
}

describe('DriveSyncSettings: one poller for the account', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('serves two shares with one changes call per poll', async () => {
    const drive = new FakeDrive()
    const first = drive.seedFolder('first', drive.rootFolderId)
    const second = drive.seedFolder('second', drive.rootFolderId)
    const changes = vi.spyOn(drive, 'changes')
    const sync = settings(drive)
    const onFirst = vi.fn()
    const onSecond = vi.fn()
    const stopFirst = sync.open(driveLocation(first)).watch(onFirst)
    const stopSecond = sync.open(driveLocation(second)).watch(onSecond)
    await vi.advanceTimersByTimeAsync(0)
    drive.seedFile('a.bin', first, Buffer.from('a'))
    drive.seedFile('b.bin', second, Buffer.from('b'))
    changes.mockClear()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(changes).toHaveBeenCalledTimes(1)
    expect(onFirst).toHaveBeenCalledTimes(1)
    expect(onSecond).toHaveBeenCalledTimes(1)
    stopFirst()
    stopSecond()
  })

  it('polls soon after kick(), for a change this PC just pushed', async () => {
    const drive = new FakeDrive()
    const folder = drive.seedFolder('share', drive.rootFolderId)
    const sync = settings(drive)
    const onChange = vi.fn()
    const stop = sync.open(driveLocation(folder)).watch(onChange)
    await vi.advanceTimersByTimeAsync(0)
    drive.seedFile('a.bin', folder, Buffer.from('a'))
    sync.kick()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(onChange).toHaveBeenCalledTimes(1)
    stop()
  })
})

describe('DriveSyncSettings.grantAccess', () => {
  it('gives the Drive folder to a person as writer or reader', async () => {
    const drive = new FakeDrive()
    const grant = vi.spyOn(drive, 'grantAccess').mockResolvedValue(undefined)
    const sync = settings(drive)
    await sync.grantAccess(driveLocation('folder-0001'), 'ben@example.com', 'writer')
    await sync.grantAccess(driveLocation('folder-0001'), 'cat@example.com', 'reader')
    expect(grant).toHaveBeenNthCalledWith(1, 'folder-0001', 'ben@example.com', 'writer')
    expect(grant).toHaveBeenNthCalledWith(2, 'folder-0001', 'cat@example.com', 'reader')
  })

  it('refuses a place that is not a Drive folder, and a PC with no Drive account', async () => {
    const drive = new FakeDrive()
    const grant = vi.spyOn(drive, 'grantAccess').mockResolvedValue(undefined)
    await expect(
      settings(drive).grantAccess('C:\\Shared\\Garden', 'ben@example.com', 'writer')
    ).rejects.toMatchObject({ reason: 'not-an-invite' })
    await expect(
      settings(drive, []).grantAccess(driveLocation('folder-0001'), 'ben@example.com', 'writer')
    ).rejects.toBeInstanceOf(SharingError)
    expect(grant).not.toHaveBeenCalled()
  })
})
