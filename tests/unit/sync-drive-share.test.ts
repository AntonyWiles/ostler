import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BRAND } from '@shared/brand'
import type { ConnectedAccount } from '@shared/ostler-api'
import { attachChangeRecorder } from '../../electron/services/change-history/recorder'
import { DRIVE_FOLDER_MIME } from '../../electron/services/sync/drive-client'
import { DriveSyncSettings } from '../../electron/services/sync/drive-sync-settings'
import { isDriveLocation } from '../../electron/services/sync/drive-transport'
import type { LibraryFileStore } from '../../electron/services/sync/library-files'
import { formatInvite, parseInvite, SharingError } from '../../electron/services/sync/sharing'
import { SyncService } from '../../electron/services/sync/sync-service'
import { createMigratedDatabase } from '../helpers/database'
import { FakeDrive } from '../helpers/fake-drive'
import { useTempDir } from '../helpers/temp-dir'

const PROJECT = 'house-project'
const SETTINGS = { name: 'House', color: '#336699', notes: '', tags: [] }
const noLibrary: LibraryFileStore = {
  syncedOriginal: () => null,
  receiveSyncedOriginal: async () => undefined
}
const googleAccount = { id: 'account-1', provider: 'google' } as ConnectedAccount

describe('sharing through Google Drive (mobile plan, phase 3)', () => {
  const tempDir = useTempDir('ostler-sync-drive-')
  let drive: FakeDrive
  const closers: (() => unknown)[] = []

  beforeEach(() => {
    drive = new FakeDrive()
    // My Drive's root, which the real API calls `root`.
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

  const driveSync = (accounts: ConnectedAccount[] = [googleAccount]) =>
    new DriveSyncSettings({
      accountsWithDrive: () => accounts,
      call: () => Promise.reject(new Error('unused')),
      client: drive
    })

  const pc = async (name: string, openDrive = true) => {
    const databasePath = await createMigratedDatabase(fs.mkdtempSync(path.join(tempDir(), name)))
    const settings = driveSync()
    const service = new SyncService({
      databasePath,
      library: noLibrary,
      projectSettings: () => SETTINGS,
      onProjectChanged: () => undefined,
      onStateChanged: () => undefined,
      memberName: () => name,
      logError: (message, error) => {
        throw new Error(`${message} ${String(error)}`)
      },
      ...(openDrive ? { openDrive: (place: string) => settings.open(place) } : {}),
      pushCheckMs: 60_000,
      scanIntervalMs: 60_000
    })
    // Another connection, as the planning service has: its writes are captured.
    const db = new Database(databasePath)
    attachChangeRecorder(db)
    closers.push(async () => {
      await service.stop()
      db.close()
    })
    return { settings, service, db }
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
  const namesIn = (parent: string) =>
    [...drive.entries.values()].filter((e) => e.parent === parent).map((e) => e.name)

  it('shares and joins with no folder on disk, and keeps both PCs in step', async () => {
    const ann = await pc('ann-')
    const ben = await pc('ben-')
    ann.service.start()
    ben.service.start()
    insertItem(ann.db, 'item-1', 'Paint hall')

    const location = await ann.settings.newProjectFolder(SETTINGS.name)
    expect(isDriveLocation(location)).toBe(true)
    await ann.service.share(PROJECT, location)
    const invite = ann.service.invite(PROJECT)!
    expect(parseInvite(invite).location).toBe(location)

    const joined = await ben.service.join(invite, parseInvite(invite).location!)
    expect(joined.project).toEqual(SETTINGS)
    expect(titleOf(ben.db, 'item-1')).toBe('Paint hall')

    // A change on each side reaches the other.
    insertItem(ann.db, 'item-2', 'Fix gate')
    ben.db
      .prepare('UPDATE planning_work_items SET title = ? WHERE id = ?')
      .run('Paint the hall', 'item-1')
    await ann.service.syncNow(PROJECT)
    await ben.service.syncNow(PROJECT)
    await ann.service.syncNow(PROJECT)
    for (const db of [ann.db, ben.db]) {
      expect(titleOf(db, 'item-1')).toBe('Paint the hall')
      expect(titleOf(db, 'item-2')).toBe('Fix gate')
    }

    // D3: one brand folder in the root of My Drive, the project in its Projects folder.
    const roots = [...drive.entries.values()].filter((e) => e.parent === 'root')
    expect(roots.filter((e) => e.name === BRAND.name)).toHaveLength(1)
    const brandFolder = roots.find((e) => e.name === BRAND.name)!.id
    expect(namesIn(brandFolder)).toEqual(['Projects'])
  })

  it('names a second project folder of the same name with (2), in the oldest brand folder', async () => {
    const settings = driveSync()
    const older = drive.seedFolder(BRAND.name, 'root', '2025-01-01T00:00:00.000Z')
    drive.seedFolder(BRAND.name, 'root', '2025-06-01T00:00:00.000Z')
    await settings.newProjectFolder('House')
    await settings.newProjectFolder('House')
    const projects = [...drive.entries.values()].find(
      (e) => e.parent === older && e.name === 'Projects'
    )!.id
    expect(namesIn(projects)).toEqual(['House', 'House (2)'])
  })

  it('refuses an invite whose Drive place is not valid', async () => {
    const ann = await pc('ann-')
    const ben = await pc('ben-')
    insertItem(ann.db, 'item-1', 'Paint hall')
    await ann.service.share(PROJECT, await ann.settings.newProjectFolder(SETTINGS.name))
    const forged = formatInvite({
      ...parseInvite(ann.service.invite(PROJECT)!),
      location: 'gdrive:not valid!'
    })
    expect(() => parseInvite(forged)).toThrow(new SharingError('not-an-invite'))
    await expect(ben.service.join(forged, 'gdrive:not valid!')).rejects.toBeInstanceOf(Error)
  })

  it('refuses to share through Drive with no Drive account', async () => {
    const lone = await pc('lone-', false)
    await expect(lone.service.share(PROJECT, 'gdrive:folder0000001')).rejects.toEqual(
      new SharingError('no-drive-account')
    )
    const none = driveSync([])
    expect(none.ready()).toBe(false)
    await expect(none.newProjectFolder('House')).rejects.toEqual(
      new SharingError('no-drive-account')
    )
    expect(() => none.open('gdrive:folder0000001')).toThrow(new SharingError('no-drive-account'))
  })
})
