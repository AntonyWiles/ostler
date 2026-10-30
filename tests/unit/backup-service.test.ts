import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BackupService,
  RestoreFailedError,
  applyPendingRestore,
  applyRetention,
  backupsDirectory,
  listBackups,
  writeBackup,
  type CopyOperation
} from '../../electron/services/backup-service'
import { LATEST_SCHEMA_VERSION } from '../../electron/services/database/migrations'
import { DEFAULT_BACKUP_SETTINGS, type BackupSettings } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'

describe('backup-service', () => {
  let dataDir: string
  let dbPath: string
  let settings: BackupSettings
  let relaunch: ReturnType<typeof vi.fn>
  let service: BackupService

  const goalTitles = (): string[] => {
    const db = new Database(dbPath, { readonly: true })
    try {
      return (
        db.prepare('SELECT title FROM planning_goals ORDER BY title').all() as {
          title: string
        }[]
      ).map(({ title }) => title)
    } finally {
      db.close()
    }
  }

  const addGoal = (title: string) => {
    const db = new Database(dbPath)
    try {
      db.pragma('journal_mode = WAL')
      db.prepare(
        "INSERT INTO planning_goals (id, project_id, title, status, created_at, updated_at) VALUES (?, 'p', ?, 'active', 1, 1)"
      ).run(title, title)
    } finally {
      db.close()
    }
  }

  /** A backup folder with a manifest, as retention sees it. */
  const fakeBackup = (id: string, reason: string, createdAt: number) => {
    const folder = path.join(backupsDirectory(dataDir), id)
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
  }

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-backups-'))
    dbPath = await createMigratedDatabase(dataDir)
    addGoal('original')
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ configVersion: 2 }))
    fs.mkdirSync(path.join(dataDir, 'library', 'p1', 'item1'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'library', 'p1', 'item1', 'file.txt'), 'library file')
    fs.mkdirSync(path.join(dataDir, 'ai', 'project-notes', 'p1'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'ai', 'project-notes', 'p1', 'note.md'), 'note')
    fs.mkdirSync(path.join(dataDir, 'harness', 'p1'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'harness', 'p1', 'state.json'), '{}')
    settings = { ...DEFAULT_BACKUP_SETTINGS }
    relaunch = vi.fn()
    service = new BackupService({
      dataDir,
      appVersion: '1.2.3',
      getSettings: () => settings,
      relaunch
    })
  })

  afterEach(() => {
    service.stop()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('backs up the database, config, Library and AI storage, but not harness/', async () => {
    const entry = await service.createBackup('manual')

    const folder = path.join(backupsDirectory(dataDir), entry.id)
    expect(entry.id).toMatch(/^\d{8}-\d{6}-\d{3}-manual$/)
    expect(fs.readdirSync(folder).sort()).toEqual([
      'ai',
      'config.json',
      'library',
      'manifest.json',
      'ostler.db'
    ])
    expect(fs.readFileSync(path.join(folder, 'library', 'p1', 'item1', 'file.txt'), 'utf-8')).toBe(
      'library file'
    )
    expect(fs.existsSync(path.join(folder, 'ai', 'project-notes', 'p1', 'note.md'))).toBe(true)

    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf-8'))
    expect(manifest).toMatchObject({
      appVersion: '1.2.3',
      schemaVersion: LATEST_SCHEMA_VERSION,
      configVersion: 2,
      reason: 'manual',
      excludes: ['harness/']
    })
    expect(manifest.bytes.database).toBeGreaterThan(0)
    expect(manifest.bytes.library).toBe('library file'.length)

    const saved = new Database(path.join(folder, 'ostler.db'), { readonly: true })
    try {
      expect(saved.prepare('SELECT title FROM planning_goals').all()).toEqual([
        { title: 'original' }
      ])
    } finally {
      saved.close()
    }
  })

  it('lists backups newest first, with their size and kind', async () => {
    const first = await service.createBackup('manual')
    const second = await service.createBackup('scheduled')

    const list = service.list()

    expect(list.map((entry) => entry.id)).toEqual([second.id, first.id])
    expect(list[0]).toMatchObject({ reason: 'scheduled', restoreBlockedReason: null })
    expect(list[0].sizeBytes).toBeGreaterThan(0)
  })

  it('deletes a backup by id and refuses ids that are not backup folders', async () => {
    const entry = await service.createBackup('manual')

    service.deleteBackup(entry.id)

    expect(service.list()).toEqual([])
    expect(() => service.deleteBackup('../config.json')).toThrow('Invalid backup id')
    expect(() => service.deleteBackup('missing')).toThrow('Backup not found')
  })

  it('keeps the newest scheduled and pre-migration backups and never prunes manual or pre-restore ones', () => {
    for (let n = 1; n <= 9; n += 1) fakeBackup(`s${n}`, 'scheduled', n)
    for (let n = 1; n <= 7; n += 1) fakeBackup(`m${n}`, 'pre-migration', n)
    for (let n = 1; n <= 12; n += 1) fakeBackup(`u${n}`, 'manual', n)
    fakeBackup('r1', 'pre-restore', 1)
    const root = backupsDirectory(dataDir)
    for (let n = 1; n <= 7; n += 1) {
      fs.writeFileSync(
        path.join(root, `pre-migration-config-v0-v2-2026010${n}-000000-000.json`),
        '{}'
      )
    }
    fs.mkdirSync(path.join(root, '.20260101-000000-000-scheduled.tmp'))

    applyRetention(dataDir, 3)

    const kept = listBackups(dataDir)
    const ids = (reason: string) =>
      kept.filter((entry) => entry.reason === reason).map((entry) => entry.id)
    expect(ids('scheduled')).toEqual(['s9', 's8', 's7'])
    expect(ids('pre-migration')).toEqual(['m7', 'm6', 'm5', 'm4', 'm3'])
    expect(ids('manual')).toHaveLength(12)
    expect(ids('pre-restore')).toEqual(['r1'])
    expect(
      fs
        .readdirSync(root)
        .filter((name) => name.endsWith('.json'))
        .sort()
    ).toEqual([3, 4, 5, 6, 7].map((n) => `pre-migration-config-v0-v2-2026010${n}-000000-000.json`))
    expect(fs.existsSync(path.join(root, '.20260101-000000-000-scheduled.tmp'))).toBe(false)
  })

  it('makes a scheduled backup only when enabled and the newest is older than the interval', async () => {
    settings = { ...DEFAULT_BACKUP_SETTINGS, enabled: false, intervalHours: 24, keep: 7 }
    expect(await service.runScheduledBackupIfDue()).toBeNull()

    settings = { ...DEFAULT_BACKUP_SETTINGS, enabled: true, intervalHours: 24, keep: 7 }
    const made = await service.runScheduledBackupIfDue()
    expect(made?.reason).toBe('scheduled')

    expect(await service.runScheduledBackupIfDue(made!.createdAt + 60 * 60 * 1000)).toBeNull()
    const later = await service.runScheduledBackupIfDue(made!.createdAt + 25 * 60 * 60 * 1000)
    expect(later?.reason).toBe('scheduled')
  })

  it('restores at the next start-up, replacing the database and removing its WAL and SHM files', async () => {
    const backup = await service.createBackup('manual')
    addGoal('added after the backup')
    fs.writeFileSync(path.join(dataDir, 'library', 'p1', 'item1', 'file.txt'), 'changed')
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ configVersion: 2, x: 1 }))

    service.scheduleRestore(backup.id)
    expect(relaunch).toHaveBeenCalledOnce()
    expect(fs.existsSync(path.join(dataDir, 'restore-pending.json'))).toBe(true)

    // What a crashed or still-open connection could leave beside the file.
    fs.writeFileSync(path.join(dataDir, 'ostler.db-wal'), 'stale wal')
    fs.writeFileSync(path.join(dataDir, 'ostler.db-shm'), 'stale shm')

    const outcome = await applyPendingRestore(dataDir, '1.2.3')

    expect(outcome?.restoredBackupId).toBe(backup.id)
    expect(fs.existsSync(path.join(dataDir, 'ostler.db-wal'))).toBe(false)
    expect(fs.existsSync(path.join(dataDir, 'ostler.db-shm'))).toBe(false)
    expect(fs.existsSync(path.join(dataDir, 'restore-pending.json'))).toBe(false)
    expect(goalTitles()).toEqual(['original'])
    expect(fs.readFileSync(path.join(dataDir, 'library', 'p1', 'item1', 'file.txt'), 'utf-8')).toBe(
      'library file'
    )
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf-8'))).toEqual({
      configVersion: 2
    })
    expect(fs.existsSync(path.join(dataDir, 'harness', 'p1', 'state.json'))).toBe(true)

    // The state it replaced was saved first.
    const preRestore = listBackups(dataDir).find((entry) => entry.reason === 'pre-restore')
    expect(preRestore?.id).toBe(outcome?.preRestoreBackupId)
    const saved = new Database(path.join(backupsDirectory(dataDir), preRestore!.id, 'ostler.db'), {
      readonly: true
    })
    try {
      expect(saved.prepare('SELECT COUNT(*) AS count FROM planning_goals').get()).toEqual({
        count: 2
      })
    } finally {
      saved.close()
    }

    // Nothing pending on the start after that.
    expect(await applyPendingRestore(dataDir, '1.2.3')).toBeNull()
  })

  it('refuses to restore a backup written by a newer schema', async () => {
    const backup = await service.createBackup('manual')
    const manifestPath = path.join(backupsDirectory(dataDir), backup.id, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, schemaVersion: LATEST_SCHEMA_VERSION + 1 })
    )

    expect(service.list()[0].restoreBlockedReason).toMatch(/newer version/)
    expect(() => service.scheduleRestore(backup.id)).toThrow(/newer version of Ostler/)
    expect(relaunch).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(dataDir, 'restore-pending.json'))).toBe(false)
  })

  it('puts the current data back when a copy fails part-way through a restore', async () => {
    const backup = await service.createBackup('manual')
    addGoal('added after the backup')
    fs.writeFileSync(path.join(dataDir, 'library', 'p1', 'item1', 'file.txt'), 'current')
    service.scheduleRestore(backup.id)

    // The database copies, then the Library copy fails.
    const failingCopy: CopyOperation = async (source, target) => {
      if (path.basename(source) === 'library') throw new Error('disk full')
      await fs.promises.cp(source, target, { recursive: true })
    }

    const restore = applyPendingRestore(dataDir, '1.2.3', failingCopy)

    await expect(restore).rejects.toBeInstanceOf(RestoreFailedError)
    await expect(restore).rejects.toThrow(/disk full/)
    expect(goalTitles()).toEqual(['added after the backup', 'original'])
    expect(fs.readFileSync(path.join(dataDir, 'library', 'p1', 'item1', 'file.txt'), 'utf-8')).toBe(
      'current'
    )
    expect(fs.existsSync(path.join(dataDir, 'restore-pending.json'))).toBe(false)
  })

  it('does nothing at start-up when no restore is pending', async () => {
    expect(await applyPendingRestore(dataDir, '1.2.3')).toBeNull()
    expect(listBackups(dataDir)).toEqual([])
  })

  it('writes nothing visible when a backup fails', async () => {
    fs.rmSync(dbPath)
    fs.mkdirSync(dbPath) // a folder where the database should be

    await expect(writeBackup(dataDir, 'manual', '1.2.3')).rejects.toThrow()

    expect(fs.readdirSync(backupsDirectory(dataDir))).toEqual([])
  })
})
