import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import type { BackupEntry, BackupManifest, BackupReason, BackupSettings } from '@shared/ostler-api'
import { AI_STORAGE_DIRECTORIES } from './ai-storage-service'
import { LATEST_SCHEMA_VERSION, backupTimestamp, readSchemaVersion } from './database/migrations'
import {
  MANIFEST_FILE,
  PRE_MIGRATION_BACKUPS_KEPT,
  backupsPastRetention,
  isBackupId,
  listBackupsIn,
  readManifest,
  toEntry
} from './backup-listing'
import {
  applySecondPlaceRetention,
  bringBackFromSecondPlace,
  copyBackupToSecondPlace,
  listSecondPlace,
  secondPlaceDirectory,
  syncedService,
  type SecondPlaceCopy
} from './backup-second-place'
import type { BackupCopyStatus, InboxItem } from '@shared/ostler-api'
import { t } from '@shared/i18n'

/**
 * Backups of the Ostler data folder, and restoring one.
 *
 * A backup is `<dataDir>/backups/<timestamp>-<reason>/` holding `ostler.db`
 * (written with SQLite's online backup, so it is consistent while the app
 * runs), `config.json`, `library/`, the AI storage folders and a
 * `manifest.json`. `harness/` is never included: agent workspaces and the
 * control repository can be very large, and they are rebuilt from Git.
 *
 * Restoring while `ostler.db` is open would corrupt it, so `scheduleRestore`
 * only records the request and relaunches; `applyPendingRestore` does the
 * work at the next start-up, before the config or the database is opened.
 */

export { PRE_MIGRATION_BACKUPS_KEPT, backupsPastRetention, isBackupId, listBackupsIn }

export const BACKUPS_FOLDER = 'backups'
export const RESTORE_PENDING_FILE = 'restore-pending.json'
/** How often the running app checks whether a scheduled backup is due. */
export const BACKUP_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

const DATABASE_FILE = 'ostler.db'
const CONFIG_FILE = 'config.json'
const LIBRARY_FOLDER = 'library'
const AI_FOLDER = 'ai'
const HARNESS_EXCLUDED = 'harness/'

export function backupsDirectory(dataDir: string): string {
  return path.join(dataDir, BACKUPS_FOLDER)
}

/** Copies a file or folder. Swappable in tests to fail part-way. */
export type CopyOperation = (source: string, target: string) => Promise<void>

const defaultCopy: CopyOperation = (source, target) =>
  fs.promises.cp(source, target, { recursive: true, errorOnExist: false, force: true })

function bytesIn(target: string): number {
  if (!fs.existsSync(target)) return 0
  const stat = fs.statSync(target)
  if (!stat.isDirectory()) return stat.size
  return fs.readdirSync(target).reduce((total, name) => total + bytesIn(path.join(target, name)), 0)
}

function readConfigVersion(configPath: string): number | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { configVersion?: unknown }
    return typeof parsed.configVersion === 'number' ? parsed.configVersion : 0
  } catch {
    return null
  }
}

/** Every readable backup, newest first. Folders without a valid manifest are skipped. */
export function listBackups(dataDir: string): BackupEntry[] {
  return listBackupsIn(backupsDirectory(dataDir))
}

/** Resolves a backup id to its folder, refusing anything that is not a direct child. */
function backupFolder(dataDir: string, id: string): string {
  if (!isBackupId(id)) throw new Error('Invalid backup id')
  const folder = path.join(backupsDirectory(dataDir), id)
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new Error(t('errors:backupService.backupNotFound'))
  }
  return folder
}

/** Throws unless the backup has a manifest this build can restore. */
function requireRestorable(
  dataDir: string,
  id: string
): { folder: string; manifest: BackupManifest } {
  const folder = backupFolder(dataDir, id)
  const manifest = readManifest(folder)
  if (!manifest) throw new Error(t('errors:backupService.backupHasNoReadable'))
  if (manifest.schemaVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(t('errors:backupService.backupWasWrittenNewer'))
  }
  if (manifest.bytes.database > 0 && !fs.existsSync(path.join(folder, DATABASE_FILE))) {
    throw new Error(t('errors:backupService.backupMissingDatabaseFile'))
  }
  return { folder, manifest }
}

/**
 * Writes one backup of the data folder. The folder is assembled under a
 * hidden temporary name and renamed when complete, so a failed backup never
 * shows up in the list.
 */
export async function writeBackup(
  dataDir: string,
  reason: Exclude<BackupReason, 'pre-migration'>,
  appVersion: string
): Promise<BackupEntry> {
  const root = backupsDirectory(dataDir)
  fs.mkdirSync(root, { recursive: true })
  const createdAt = Date.now()
  let id = `${backupTimestamp(new Date(createdAt))}-${reason}`
  for (let n = 2; fs.existsSync(path.join(root, id)); n += 1) {
    id = `${backupTimestamp(new Date(createdAt))}-${reason}-${n}`
  }
  const staging = path.join(root, `.${id}.tmp`)
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })

  try {
    const excludes = [HARNESS_EXCLUDED]
    let schemaVersion = 0
    const databasePath = path.join(dataDir, DATABASE_FILE)
    if (fs.existsSync(databasePath)) {
      const db = new Database(databasePath, { readonly: true, fileMustExist: true })
      try {
        schemaVersion = readSchemaVersion(db)
        await db.backup(path.join(staging, DATABASE_FILE))
      } finally {
        db.close()
      }
    }

    const configPath = path.join(dataDir, CONFIG_FILE)
    const configVersion = fs.existsSync(configPath) ? readConfigVersion(configPath) : null
    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, path.join(staging, CONFIG_FILE))
    }

    const library = path.join(dataDir, LIBRARY_FOLDER)
    if (fs.existsSync(library)) await defaultCopy(library, path.join(staging, LIBRARY_FOLDER))

    for (const name of AI_STORAGE_DIRECTORIES) {
      const source = path.join(dataDir, AI_FOLDER, name)
      if (fs.existsSync(source)) await defaultCopy(source, path.join(staging, AI_FOLDER, name))
    }

    const manifest: BackupManifest = {
      format: 'ostler-backup',
      formatVersion: 1,
      appVersion,
      schemaVersion,
      configVersion,
      reason,
      createdAt,
      bytes: {
        database: bytesIn(path.join(staging, DATABASE_FILE)),
        config: bytesIn(path.join(staging, CONFIG_FILE)),
        library: bytesIn(path.join(staging, LIBRARY_FOLDER)),
        ai: bytesIn(path.join(staging, AI_FOLDER))
      },
      excludes
    }
    fs.writeFileSync(path.join(staging, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf-8')
    fs.renameSync(staging, path.join(root, id))
    return toEntry(id, manifest)
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

/**
 * Deletes automatic backups past their limits: the newest `keep` scheduled
 * backups and the newest five pre-migration backups (database folders and
 * config copies alike) stay. Manual and pre-restore backups are never
 * deleted here.
 */
export function applyRetention(dataDir: string, keepScheduled: number): string[] {
  const root = backupsDirectory(dataDir)
  const removed: string[] = []
  for (const entry of backupsPastRetention(listBackups(dataDir), keepScheduled)) {
    fs.rmSync(path.join(root, entry.id), { recursive: true, force: true })
    removed.push(entry.id)
  }

  if (fs.existsSync(root)) {
    // Staging folders a quit or crash left behind (never the one being written:
    // backups are made one at a time, and retention runs after each).
    for (const name of fs.readdirSync(root).filter((entry) => /^\..+\.tmp$/.test(entry))) {
      fs.rmSync(path.join(root, name), { recursive: true, force: true })
    }
    // Config copies sort by their timestamp suffix; names differ only in it and the versions.
    const stamp = (name: string) => name.slice(-'20261008-101500-123.json'.length)
    const configCopies = fs
      .readdirSync(root)
      .filter((name) => /^pre-migration-config-v\d+-v\d+-[\d-]+\.json$/.test(name))
      .sort((a, b) => stamp(b).localeCompare(stamp(a)))
    for (const name of configCopies.slice(PRE_MIGRATION_BACKUPS_KEPT)) {
      fs.rmSync(path.join(root, name), { force: true })
      removed.push(name)
    }
  }
  return removed
}

function restorePendingPath(dataDir: string): string {
  return path.join(dataDir, RESTORE_PENDING_FILE)
}

/** Replaces the live data with what `folder` holds. Parts the backup excludes are left alone. */
async function putBackupInPlace(
  dataDir: string,
  folder: string,
  manifest: BackupManifest,
  copy: CopyOperation
): Promise<void> {
  const covers = (part: string) => !manifest.excludes.includes(part)

  if (covers(DATABASE_FILE)) {
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(path.join(dataDir, `${DATABASE_FILE}${suffix}`), { force: true })
    }
    if (fs.existsSync(path.join(folder, DATABASE_FILE))) {
      await copy(path.join(folder, DATABASE_FILE), path.join(dataDir, DATABASE_FILE))
    }
  }
  if (covers(CONFIG_FILE) && fs.existsSync(path.join(folder, CONFIG_FILE))) {
    await copy(path.join(folder, CONFIG_FILE), path.join(dataDir, CONFIG_FILE))
  }
  if (covers(`${LIBRARY_FOLDER}/`)) {
    fs.rmSync(path.join(dataDir, LIBRARY_FOLDER), { recursive: true, force: true })
    if (fs.existsSync(path.join(folder, LIBRARY_FOLDER))) {
      await copy(path.join(folder, LIBRARY_FOLDER), path.join(dataDir, LIBRARY_FOLDER))
    }
  }
  if (covers(`${AI_FOLDER}/`)) {
    for (const name of AI_STORAGE_DIRECTORIES) {
      const live = path.join(dataDir, AI_FOLDER, name)
      fs.rmSync(live, { recursive: true, force: true })
      const saved = path.join(folder, AI_FOLDER, name)
      if (fs.existsSync(saved)) await copy(saved, live)
    }
  }
}

export interface RestoreOutcome {
  restoredBackupId: string
  preRestoreBackupId: string
}

/** A pending restore failed; the data was put back as it was. */
export class RestoreFailedError extends Error {
  constructor(
    message: string,
    readonly preRestoreBackupId: string | null
  ) {
    super(message)
    this.name = 'RestoreFailedError'
  }
}

/**
 * Runs at start-up, before the config or the database is opened. If a restore
 * was scheduled, saves the current state as a `pre-restore` backup, removes
 * `ostler.db` with its WAL and SHM files, and copies the backup into place.
 * Migrations then bring an older backup up to date. If anything fails, the
 * pre-restore backup is put back and a `RestoreFailedError` is thrown for the
 * caller to show. The pending request is removed either way, so a failing
 * restore cannot loop.
 */
export async function applyPendingRestore(
  dataDir: string,
  appVersion: string,
  copy: CopyOperation = defaultCopy
): Promise<RestoreOutcome | null> {
  const pendingPath = restorePendingPath(dataDir)
  if (!fs.existsSync(pendingPath)) return null

  let backupId: string
  let source: { folder: string; manifest: BackupManifest }
  try {
    backupId = (JSON.parse(fs.readFileSync(pendingPath, 'utf-8')) as { backupId: string }).backupId
    source = requireRestorable(dataDir, backupId)
  } catch (error) {
    fs.rmSync(pendingPath, { force: true })
    throw new RestoreFailedError(
      t('errors:backupService.backupCouldNotRestored', {
        message: error instanceof Error ? error.message : String(error)
      }),
      null
    )
  }

  let preRestore: BackupEntry
  try {
    preRestore = await writeBackup(dataDir, 'pre-restore', appVersion)
  } catch (error) {
    fs.rmSync(pendingPath, { force: true })
    throw new RestoreFailedError(
      t('errors:backupService.nothingWasRestoredBecause', {
        message: error instanceof Error ? error.message : String(error)
      }),
      null
    )
  }

  try {
    await putBackupInPlace(dataDir, source.folder, source.manifest, copy)
  } catch (error) {
    const saved = requireRestorable(dataDir, preRestore.id)
    await putBackupInPlace(dataDir, saved.folder, saved.manifest, defaultCopy)
    fs.rmSync(pendingPath, { force: true })
    throw new RestoreFailedError(
      t('errors:backupService.backupCouldNotRestored2', {
        message: error instanceof Error ? error.message : String(error)
      }),
      preRestore.id
    )
  }
  fs.rmSync(pendingPath, { force: true })
  return { restoredBackupId: backupId, preRestoreBackupId: preRestore.id }
}

export interface BackupServiceOptions {
  dataDir: string
  appVersion: string
  getSettings(): BackupSettings
  /** Restarts the app so `applyPendingRestore` runs before anything opens the data. */
  relaunch(): void
  /** Saves the second place's state in `config.json` (N6.1). */
  saveCopyState?(state: Pick<BackupSettings, 'lastCopiedAt' | 'copyFailedAt'>): void
  /** Called after a copy to the second place succeeded or failed, so the Inbox updates. */
  onCopyStateChange?(): void
  /** Copies to and from the second place. Swappable in tests. */
  copy?: SecondPlaceCopy
  now?(): number
  logError?(message: string, error: unknown): void
}

/** The running app's handle on backups: list, create, delete, restore and the schedule. */
export class BackupService {
  private timer: NodeJS.Timeout | null = null
  private queue: Promise<unknown> = Promise.resolve()
  /** Copies to the second place, one at a time, apart from the backups themselves. */
  private copies: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: BackupServiceOptions) {}

  get directory(): string {
    return backupsDirectory(this.options.dataDir)
  }

  list(): BackupEntry[] {
    return listBackups(this.options.dataDir)
  }

  /** One backup at a time; a second request waits for the first. */
  createBackup(reason: 'manual' | 'scheduled' | 'pre-restore'): Promise<BackupEntry> {
    const run = this.queue.then(async () => {
      const entry = await writeBackup(this.options.dataDir, reason, this.options.appVersion)
      this.applyRetention()
      void this.copyToSecondPlace(entry.id)
      return entry
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  /**
   * Copies a finished backup to the second place in the background: on a USB
   * drive or a share it can be slow, and it never holds the backup or the
   * database up. A copy that fails never fails the backup: it is recorded,
   * shown once in the Inbox, and tried again with the next backup. The
   * returned promise never rejects.
   */
  copyToSecondPlace(id: string): Promise<void> {
    const run = this.copies.then(async () => {
      const settings = this.options.getSettings()
      const folder = settings.copyTo
      // Retention may have removed the backup while an earlier copy ran.
      if (!folder || !fs.existsSync(path.join(this.directory, id))) return
      const now = this.options.now?.() ?? Date.now()
      try {
        await copyBackupToSecondPlace(path.join(this.directory, id), id, folder, this.options.copy)
        applySecondPlaceRetention(folder, settings.keep)
        // The person may have stopped copying or chosen another folder meanwhile.
        if (this.options.getSettings().copyTo !== folder) return
        this.options.saveCopyState?.({ lastCopiedAt: now, copyFailedAt: null })
      } catch (error) {
        ;(this.options.logError ?? console.error)(
          'Copying a backup to the second place failed:',
          error
        )
        const current = this.options.getSettings()
        if (current.copyTo !== folder) return
        // The first failure since the last success: one Inbox item, not one per try.
        this.options.saveCopyState?.({
          lastCopiedAt: current.lastCopiedAt,
          copyFailedAt: current.copyFailedAt ?? now
        })
      }
      this.options.onCopyStateChange?.()
    })
    const settled = run.catch(() => undefined)
    this.copies = settled
    return settled
  }

  /** Resolves once every copy to the second place asked for so far has finished. */
  whenCopied(): Promise<unknown> {
    return this.copies
  }

  /** The second place as Settings shows it. */
  copyStatus(env: NodeJS.ProcessEnv = process.env): BackupCopyStatus {
    const { copyTo, lastCopiedAt, copyFailedAt } = this.options.getSettings()
    return {
      folder: copyTo,
      target: copyTo ? secondPlaceDirectory(copyTo) : null,
      syncedBy: copyTo ? syncedService(copyTo, env) : null,
      lastCopiedAt,
      copyFailedAt
    }
  }

  /** "Backups could not be copied to <folder>", until a copy succeeds. */
  inboxItem(): InboxItem | null {
    const { copyTo, copyFailedAt } = this.options.getSettings()
    if (!copyTo || copyFailedAt === null) return null
    return {
      key: `backupcopy:${copyFailedAt}`,
      kind: 'backupCopy',
      title: t('desktop:inboxSources.backupCopyFailed', { folder: secondPlaceDirectory(copyTo) }),
      body: t('desktop:inboxSources.backupCopyRetry'),
      projectId: null,
      taskId: null,
      createdAt: copyFailedAt
    }
  }

  /** The backups in the second place, newest first. Empty when it is not set or not reachable. */
  listSecondPlace(): BackupEntry[] {
    const folder = this.options.getSettings().copyTo
    if (!folder) return []
    try {
      return listSecondPlace(folder)
    } catch {
      return []
    }
  }

  /**
   * Restores a backup from the second place through the usual path: copied
   * into the main backups folder first, then restored at the next start.
   */
  async restoreFromSecondPlace(id: string): Promise<void> {
    const folder = this.options.getSettings().copyTo
    if (!folder) throw new Error(t('errors:backupSecondPlace.noSecondPlace'))
    await bringBackFromSecondPlace(folder, id, this.directory, this.options.copy)
    this.scheduleRestore(id)
  }

  deleteBackup(id: string): void {
    const folder = backupFolder(this.options.dataDir, id)
    fs.rmSync(folder, { recursive: true, force: true })
  }

  applyRetention(): string[] {
    return applyRetention(this.options.dataDir, this.options.getSettings().keep)
  }

  /**
   * Validates the backup, records the request in `restore-pending.json` and
   * relaunches. The restore itself happens at the next start-up.
   */
  scheduleRestore(id: string): void {
    requireRestorable(this.options.dataDir, id)
    fs.writeFileSync(
      restorePendingPath(this.options.dataDir),
      JSON.stringify({ backupId: id, requestedAt: Date.now() }, null, 2),
      'utf-8'
    )
    this.options.relaunch()
  }

  /** Makes a scheduled backup when automatic backups are on and the newest one is too old. */
  async runScheduledBackupIfDue(now = Date.now()): Promise<BackupEntry | null> {
    const settings = this.options.getSettings()
    if (!settings.enabled) return null
    const newest = this.list().find(
      (entry) => entry.reason === 'scheduled' || entry.reason === 'manual'
    )
    if (newest && now - newest.createdAt < settings.intervalHours * 60 * 60 * 1000) return null
    return this.createBackup('scheduled')
  }

  /** Checks once now and then every six hours while the app runs. */
  start(): void {
    this.stop()
    // Pre-migration backups made at this start-up are pruned here too.
    this.queue = this.queue
      .then(() => {
        this.applyRetention()
        // A restore at this start-up saved the data first; that backup goes to
        // the second place like any other.
        const newest = this.list()[0]
        if (newest?.reason === 'pre-restore' && this.options.getSettings().copyTo) {
          const copied = this.listSecondPlace().some((entry) => entry.id === newest.id)
          if (!copied) void this.copyToSecondPlace(newest.id)
        }
      })
      .catch((error) => (this.options.logError ?? console.error)('Backup retention failed:', error))
    const check = () => {
      this.runScheduledBackupIfDue().catch((error) =>
        (this.options.logError ?? console.error)('Scheduled backup failed:', error)
      )
    }
    check()
    this.timer = setInterval(check, BACKUP_CHECK_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
