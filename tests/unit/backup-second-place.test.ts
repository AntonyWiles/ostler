import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BackupService,
  RESTORE_PENDING_FILE,
  applyPendingRestore,
  backupsDirectory
} from '../../electron/services/backup-service'
import {
  COPY_MARKER_FILE,
  applySecondPlaceRetention,
  copyBackupToSecondPlace,
  listSecondPlace,
  secondPlaceDirectory,
  secondPlaceProblem,
  syncedService,
  type SecondPlaceCopy
} from '../../electron/services/backup-second-place'
import { DEFAULT_BACKUP_SETTINGS, type BackupSettings } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'

/** A finished backup folder with a manifest, as listing and retention see it. */
function fakeBackup(root: string, id: string, reason: string, createdAt: number, copied = false) {
  const folder = path.join(root, id)
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(
    path.join(folder, 'manifest.json'),
    JSON.stringify({
      format: 'ostler-backup',
      formatVersion: 1,
      appVersion: 'test',
      schemaVersion: 1,
      configVersion: 1,
      reason,
      createdAt,
      bytes: { database: 0, config: 0, library: 0, ai: 0 },
      excludes: ['harness/']
    })
  )
  if (copied) fs.writeFileSync(path.join(folder, COPY_MARKER_FILE), '{}')
}

describe('backups in a second place', () => {
  let temp: string
  let dataDir: string
  let secondPlace: string
  let settings: BackupSettings
  let service: BackupService
  let changes: number
  let now: number
  let copy: SecondPlaceCopy | undefined

  const makeService = () =>
    new BackupService({
      dataDir,
      appVersion: '1.2.3',
      getSettings: () => settings,
      relaunch: vi.fn(),
      saveCopyState: (state) => {
        settings = { ...settings, ...state }
      },
      onCopyStateChange: () => {
        changes += 1
      },
      copy: (source, target) => (copy ?? defaultCopy)(source, target),
      now: () => now,
      logError: () => {}
    })
  const defaultCopy: SecondPlaceCopy = (source, target) =>
    fs.promises.cp(source, target, { recursive: true })

  beforeEach(async () => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-second-place-'))
    dataDir = path.join(temp, 'data')
    secondPlace = path.join(temp, 'usb')
    fs.mkdirSync(dataDir)
    fs.mkdirSync(secondPlace)
    await createMigratedDatabase(dataDir)
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ configVersion: 2 }))
    settings = { ...DEFAULT_BACKUP_SETTINGS, copyTo: secondPlace }
    changes = 0
    now = 1_000
    copy = undefined
    service = makeService()
  })

  afterEach(() => {
    service.stop()
    fs.rmSync(temp, { recursive: true, force: true })
  })

  it.each(['manual', 'scheduled', 'pre-restore'] as const)(
    'copies a %s backup to <folder>\\Ostler backups\\<id> once it is written',
    async (reason) => {
      const entry = await service.createBackup(reason)
      await service.whenCopied()

      const copied = path.join(secondPlace, 'Ostler backups', entry.id)
      expect(fs.readdirSync(copied).sort()).toEqual(
        ['config.json', COPY_MARKER_FILE, 'manifest.json', 'ostler.db'].sort()
      )
      expect(listSecondPlace(secondPlace).map((backup) => backup.id)).toEqual([entry.id])
      expect(settings.lastCopiedAt).toBe(1_000)
      expect(settings.copyFailedAt).toBeNull()
    }
  )

  it('copies nothing when no second place is chosen', async () => {
    settings = { ...settings, copyTo: null }
    await service.createBackup('manual')
    await service.whenCopied()
    expect(fs.readdirSync(secondPlace)).toEqual([])
    expect(changes).toBe(0)
  })

  it('assembles the copy under a hidden name and renames it only when complete', async () => {
    let seen: string[] = []
    copy = async (source, target) => {
      await defaultCopy(source, target)
      seen = fs.readdirSync(secondPlaceDirectory(secondPlace))
    }
    const entry = await service.createBackup('manual')
    await service.whenCopied()
    expect(seen).toEqual([`.${entry.id}.tmp`])
    expect(fs.readdirSync(secondPlaceDirectory(secondPlace))).toEqual([entry.id])
  })

  it('leaves no half copy behind when copying fails part-way', async () => {
    copy = async (source, target) => {
      fs.mkdirSync(target, { recursive: true })
      fs.writeFileSync(path.join(target, 'ostler.db'), 'half')
      throw new Error('disk full')
    }
    const entry = await service.createBackup('manual')
    await service.whenCopied()
    expect(fs.readdirSync(secondPlaceDirectory(secondPlace))).toEqual([])
    expect(service.list().map((backup) => backup.id)).toEqual([entry.id])
  })

  describe('when the folder is missing', () => {
    beforeEach(() => {
      fs.rmSync(secondPlace, { recursive: true })
    })

    it('still makes the backup, and says so once in the Inbox', async () => {
      const entry = await service.createBackup('manual')
      await service.whenCopied()

      expect(service.list().map((backup) => backup.id)).toEqual([entry.id])
      // The chosen folder is never recreated: it is a drive or share that is gone.
      expect(fs.existsSync(secondPlace)).toBe(false)
      const item = service.inboxItem()
      expect(item).toMatchObject({
        key: 'backupcopy:1000',
        kind: 'backupCopy',
        title: `Backups could not be copied to ${path.join(secondPlace, 'Ostler backups')}`,
        projectId: null,
        taskId: null
      })
      expect(changes).toBe(1)

      // Tried again at the next backup, still failing: the same one item.
      now = 2_000
      await service.createBackup('manual')
      await service.whenCopied()
      expect(service.inboxItem()?.key).toBe('backupcopy:1000')
    })

    it('tries again at the next backup and clears the Inbox item when it succeeds', async () => {
      await service.createBackup('manual')
      await service.whenCopied()
      expect(service.inboxItem()).not.toBeNull()

      fs.mkdirSync(secondPlace)
      now = 3_000
      const next = await service.createBackup('manual')
      await service.whenCopied()

      expect(service.inboxItem()).toBeNull()
      expect(settings).toMatchObject({ lastCopiedAt: 3_000, copyFailedAt: null })
      expect(listSecondPlace(secondPlace).map((backup) => backup.id)).toEqual([next.id])
    })
  })

  it('keeps the same scheduled backups as the main folder, and only its own copies', async () => {
    settings = { ...settings, keep: 2 }
    const target = secondPlaceDirectory(secondPlace)
    // Older copies Ostler made, and things it did not.
    fakeBackup(target, '20260101-000000-000-scheduled', 'scheduled', 1, true)
    fakeBackup(target, '20260102-000000-000-scheduled', 'scheduled', 2, true)
    fakeBackup(target, '20260103-000000-000-manual', 'manual', 3, true)
    fakeBackup(target, '20250101-000000-000-scheduled', 'scheduled', 0)
    fs.writeFileSync(path.join(target, 'my notes.txt'), 'mine')
    fs.mkdirSync(path.join(target, 'holiday photos'))

    const made = await service.createBackup('scheduled')
    await service.whenCopied()

    expect(service.list().filter((b) => b.reason === 'scheduled')).toHaveLength(1)
    expect(fs.readdirSync(target).sort()).toEqual(
      [
        '20250101-000000-000-scheduled',
        '20260102-000000-000-scheduled',
        '20260103-000000-000-manual',
        made.id,
        'holiday photos',
        'my notes.txt'
      ].sort()
    )
  })

  it('removes leftover staging folders, but nothing else that is hidden', () => {
    const target = secondPlaceDirectory(secondPlace)
    fs.mkdirSync(path.join(target, '.20260101-000000-000-manual.tmp'), { recursive: true })
    fs.mkdirSync(path.join(target, '.git'), { recursive: true })
    applySecondPlaceRetention(secondPlace, 7)
    expect(fs.readdirSync(target)).toEqual(['.git'])
  })

  it('never overwrites a folder of the same name it did not make', async () => {
    const target = secondPlaceDirectory(secondPlace)
    fakeBackup(target, 'x-manual', 'manual', 1)
    fakeBackup(backupsDirectory(dataDir), 'x-manual', 'manual', 1)
    await expect(
      copyBackupToSecondPlace(
        path.join(backupsDirectory(dataDir), 'x-manual'),
        'x-manual',
        secondPlace
      )
    ).rejects.toThrow(/did not put it there/)
    expect(fs.existsSync(path.join(target, 'x-manual', COPY_MARKER_FILE))).toBe(false)
  })

  it('restores from the second place through the usual path', async () => {
    const entry = await service.createBackup('manual')
    await service.whenCopied()
    service.deleteBackup(entry.id)
    expect(service.list()).toEqual([])

    await service.restoreFromSecondPlace(entry.id)

    // Copied into the main backups folder first, without the copy's marker.
    const main = path.join(backupsDirectory(dataDir), entry.id)
    expect(fs.existsSync(path.join(main, 'manifest.json'))).toBe(true)
    expect(fs.existsSync(path.join(main, COPY_MARKER_FILE))).toBe(false)
    expect(
      JSON.parse(fs.readFileSync(path.join(dataDir, RESTORE_PENDING_FILE), 'utf-8')).backupId
    ).toBe(entry.id)

    // Then the next start restores it, saving the current data first.
    const outcome = await applyPendingRestore(dataDir, '1.2.3')
    expect(outcome?.restoredBackupId).toBe(entry.id)
  })

  it('refuses to restore an id that is not a backup Ostler copied there', async () => {
    fakeBackup(secondPlaceDirectory(secondPlace), 'theirs-manual', 'manual', 1)
    await expect(service.restoreFromSecondPlace('theirs-manual')).rejects.toThrow()
    await expect(service.restoreFromSecondPlace('..\\escape')).rejects.toThrow()
    expect(fs.existsSync(path.join(dataDir, RESTORE_PENDING_FILE))).toBe(false)
  })

  it('copies the backup a restore made at start-up', async () => {
    fakeBackup(backupsDirectory(dataDir), '20260101-000000-000-pre-restore', 'pre-restore', 5)
    service.start()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await service.whenCopied()
    expect(listSecondPlace(secondPlace).map((backup) => backup.id)).toContain(
      '20260101-000000-000-pre-restore'
    )
  })
})

describe('choosing the second place', () => {
  let temp: string

  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-second-place-check-'))
  })

  afterEach(() => {
    fs.rmSync(temp, { recursive: true, force: true })
  })

  it('refuses a folder inside the data folder, or the data folder itself', () => {
    const dataDir = path.join(temp, 'Data')
    fs.mkdirSync(path.join(dataDir, 'inside'), { recursive: true })
    expect(secondPlaceProblem(path.join(dataDir, 'inside'), dataDir)).toMatch(/data folder/)
    expect(secondPlaceProblem(dataDir, dataDir)).toMatch(/data folder/)
    // Windows paths compare without case.
    expect(secondPlaceProblem(path.join(temp, 'data', 'inside'), dataDir)).toMatch(/data folder/)
  })

  it('accepts a folder beside the data folder with a similar name', () => {
    const dataDir = path.join(temp, 'data')
    fs.mkdirSync(dataDir)
    fs.mkdirSync(path.join(temp, 'data-copies'))
    expect(secondPlaceProblem(path.join(temp, 'data-copies'), dataDir)).toBeNull()
  })

  it('refuses a missing folder and a relative path', () => {
    expect(secondPlaceProblem(path.join(temp, 'gone'), path.join(temp, 'data'))).toMatch(/exists/)
    expect(secondPlaceProblem('relative\\folder', path.join(temp, 'data'))).toMatch(/exists/)
  })

  it.runIf(process.platform === 'win32')('refuses a folder Windows reports as read-only', () => {
    const folder = path.join(temp, 'read-only')
    fs.mkdirSync(folder)
    // chmod sets the folder's read-only attribute on Windows.
    fs.chmodSync(folder, 0o555)
    try {
      expect(secondPlaceProblem(folder, path.join(temp, 'data'))).toMatch(/read-only/)
    } finally {
      fs.chmodSync(folder, 0o777)
    }
    // A folder Ostler can write to passes, and the test file is gone again.
    expect(secondPlaceProblem(folder, path.join(temp, 'data'))).toBeNull()
    expect(fs.readdirSync(folder)).toEqual([])
  })

  it.each([
    ['C:\\Users\\sam\\OneDrive\\Backups', 'OneDrive'],
    ['C:\\Users\\sam\\OneDrive - Contoso\\Ostler', 'OneDrive'],
    ['D:\\Sync\\Dropbox\\Ostler', 'Dropbox'],
    ['C:\\Users\\sam\\Dropbox (Personal)\\Ostler', 'Dropbox'],
    ['G:\\My Drive\\Ostler', 'Google Drive'],
    ['C:\\Users\\sam\\Google Drive\\Ostler', 'Google Drive'],
    ['E:\\Ostler backups', null],
    ['\\\\server\\share\\Ostler', null]
  ])('spots %s as %s', (folder, service) => {
    expect(syncedService(folder, {})).toBe(service)
  })

  it('spots a OneDrive folder from the variables its client sets', () => {
    expect(syncedService('D:\\Work Sync\\Plans', { OneDriveCommercial: 'D:\\Work Sync' })).toBe(
      'OneDrive'
    )
    expect(syncedService('D:\\Work Syncing\\Plans', { OneDrive: 'D:\\Work Sync' })).toBeNull()
  })
})
