import * as fs from 'fs'
import * as path from 'path'
import type { BackupCopyStatus, BackupEntry } from '@shared/ostler-api'
import { BRAND } from '@shared/brand'
import { t } from '@shared/i18n'
import { backupsPastRetention, isBackupId, listBackupsIn, readManifest } from './backup-listing'

/**
 * The second place for backups (N6.1, N44): a folder the person chooses (a
 * USB drive, another disk, a network share or a synced folder) where every
 * backup is copied too, under `<folder>\<BRAND.name> backups\<backup id>`.
 *
 * A copy is assembled under a hidden name and renamed when complete, as
 * `writeBackup` does, so a half-copied backup never looks whole. Each copy
 * holds a marker file, and retention and listing here only ever see folders
 * with it: Ostler never deletes anything in the second place it did not put
 * there.
 */

/** Marks a folder in the second place as a copy Ostler made. */
export const COPY_MARKER_FILE = 'copied-by-ostler.json'

export function secondPlaceDirectory(folder: string): string {
  return path.join(folder, `${BRAND.name} backups`)
}

function isOstlerCopy(folder: string): boolean {
  return fs.existsSync(path.join(folder, COPY_MARKER_FILE))
}

/** True when `child` is `parent` or inside it (Windows paths compare without case). */
function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent.toLowerCase(), child.toLowerCase())
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Why `folder` cannot be the second place, or null when it can. Refuses a
 * relative path, a folder inside the data folder (a copy on the same disk,
 * which a backup of the data folder would then contain), a missing folder
 * and one Windows reports as read-only.
 */
export function secondPlaceProblem(folder: string, dataDir: string): string | null {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) {
    return t('errors:backupSecondPlace.notAFolder')
  }
  const resolved = path.resolve(folder)
  if (isInside(path.resolve(dataDir), resolved)) {
    return t('errors:backupSecondPlace.insideDataFolder')
  }
  let stat: fs.Stats
  try {
    stat = fs.statSync(resolved)
  } catch {
    return t('errors:backupSecondPlace.notAFolder')
  }
  if (!stat.isDirectory()) return t('errors:backupSecondPlace.notAFolder')
  // The read-only attribute shows as a mode without write permission. A
  // write-protected drive or a read-only share keeps the attribute clear but
  // refuses writes, so a small file is written and removed too.
  if ((stat.mode & 0o200) === 0) return t('errors:backupSecondPlace.readOnly')
  const probe = path.join(resolved, `.ostler-write-test-${process.pid}-${Date.now()}`)
  try {
    fs.writeFileSync(probe, '')
  } catch {
    return t('errors:backupSecondPlace.readOnly')
  } finally {
    fs.rmSync(probe, { force: true })
  }
  return null
}

type SyncService = NonNullable<BackupCopyStatus['syncedBy']>

/**
 * The sync service a folder is inside, from the variables the OneDrive client
 * sets and the folder names OneDrive, Dropbox and Google Drive use by default
 * (`C:\Users\<name>\OneDrive - Contoso`, `...\Dropbox`, `G:\My Drive`).
 */
export function syncedService(
  folder: string,
  env: NodeJS.ProcessEnv = process.env
): SyncService | null {
  const resolved = path.resolve(folder)
  for (const name of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) {
    const root = env[name]
    if (root && path.isAbsolute(root) && isInside(root, resolved)) return 'OneDrive'
  }
  const parts = resolved.split(/[\\/]+/).map((part) => part.toLowerCase())
  if (parts.some((part) => part === 'onedrive' || part.startsWith('onedrive - '))) return 'OneDrive'
  if (parts.some((part) => part === 'dropbox' || part.startsWith('dropbox ('))) return 'Dropbox'
  if (
    parts.some((part) => part === 'google drive' || part === 'my drive' || part === 'googledrive')
  ) {
    return 'Google Drive'
  }
  return null
}

/** Copies a file or folder. Swappable in tests. */
export type SecondPlaceCopy = (source: string, target: string) => Promise<void>

const defaultCopy: SecondPlaceCopy = (source, target) =>
  fs.promises.cp(source, target, { recursive: true, errorOnExist: false, force: true })

/**
 * Copies the finished backup `source` (a folder in the main backups folder)
 * to the second place. The database is not touched: the backup is already a
 * finished copy. Throws when the folder cannot be reached.
 */
export async function copyBackupToSecondPlace(
  source: string,
  id: string,
  folder: string,
  copy: SecondPlaceCopy = defaultCopy
): Promise<void> {
  if (!isBackupId(id)) throw new Error('Invalid backup id')
  // A drive that is unplugged or a share that is offline: `folder` is gone.
  // Never recreate the chosen folder itself, only Ostler's folder inside it.
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new Error(t('errors:backupSecondPlace.unreachable', { folder }))
  }
  const root = secondPlaceDirectory(folder)
  fs.mkdirSync(root, { recursive: true })
  const target = path.join(root, id)
  if (fs.existsSync(target)) {
    if (isOstlerCopy(target)) return
    throw new Error(t('errors:backupSecondPlace.nameTaken', { id }))
  }
  const staging = path.join(root, `.${id}.tmp`)
  fs.rmSync(staging, { recursive: true, force: true })
  try {
    await copy(source, staging)
    fs.writeFileSync(
      path.join(staging, COPY_MARKER_FILE),
      JSON.stringify({ copiedAt: Date.now() }, null, 2),
      'utf-8'
    )
    fs.renameSync(staging, target)
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

/** The copies Ostler made in the second place, newest first. */
export function listSecondPlace(folder: string): BackupEntry[] {
  return listBackupsIn(secondPlaceDirectory(folder), isOstlerCopy)
}

/**
 * The main folder's retention in the second place: the same `keep`, the same
 * reasons kept forever, and only among the copies Ostler made. Hidden staging
 * folders a quit or an unplugged drive left behind are removed too.
 */
export function applySecondPlaceRetention(folder: string, keepScheduled: number): string[] {
  const root = secondPlaceDirectory(folder)
  const removed: string[] = []
  for (const entry of backupsPastRetention(listSecondPlace(folder), keepScheduled)) {
    fs.rmSync(path.join(root, entry.id), { recursive: true, force: true })
    removed.push(entry.id)
  }
  if (fs.existsSync(root)) {
    for (const name of fs.readdirSync(root)) {
      const id = /^\.(.+)\.tmp$/.exec(name)?.[1]
      if (id && isBackupId(id)) fs.rmSync(path.join(root, name), { recursive: true, force: true })
    }
  }
  return removed
}

/**
 * Copies a backup from the second place into the main backups folder, under
 * a hidden name renamed when complete, so it can be restored through the
 * usual path. A backup already there is left as it is.
 */
export async function bringBackFromSecondPlace(
  folder: string,
  id: string,
  mainBackups: string,
  copy: SecondPlaceCopy = defaultCopy
): Promise<void> {
  if (!isBackupId(id)) throw new Error('Invalid backup id')
  const source = path.join(secondPlaceDirectory(folder), id)
  if (!fs.existsSync(source) || !isOstlerCopy(source) || !readManifest(source)) {
    throw new Error(t('errors:backupService.backupNotFound'))
  }
  const target = path.join(mainBackups, id)
  if (fs.existsSync(target)) return
  fs.mkdirSync(mainBackups, { recursive: true })
  const staging = path.join(mainBackups, `.${id}.tmp`)
  fs.rmSync(staging, { recursive: true, force: true })
  try {
    await copy(source, staging)
    fs.rmSync(path.join(staging, COPY_MARKER_FILE), { force: true })
    fs.renameSync(staging, target)
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true })
    throw error
  }
}
