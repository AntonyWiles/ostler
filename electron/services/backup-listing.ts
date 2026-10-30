import * as fs from 'fs'
import * as path from 'path'
import type { BackupEntry, BackupManifest, BackupReason } from '@shared/ostler-api'
import { LATEST_SCHEMA_VERSION } from './database/migrations'

/**
 * Reading backup folders: their manifests, the list, and which ones
 * retention deletes. Shared by the main backups folder (backup-service.ts)
 * and the second place (backup-second-place.ts), so both follow one rule.
 */

export const MANIFEST_FILE = 'manifest.json'
/** Pre-migration backups kept; older ones are deleted. */
export const PRE_MIGRATION_BACKUPS_KEPT = 5
const BACKUP_ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/

export function readManifest(folder: string): BackupManifest | null {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(folder, MANIFEST_FILE), 'utf-8')
    ) as BackupManifest
    if (manifest.format !== 'ostler-backup' || typeof manifest.schemaVersion !== 'number') {
      return null
    }
    return manifest
  } catch {
    return null
  }
}

export function toEntry(id: string, manifest: BackupManifest): BackupEntry {
  const { database, config, library, ai } = manifest.bytes
  return {
    id,
    reason: manifest.reason,
    createdAt: manifest.createdAt,
    sizeBytes: database + config + library + ai,
    appVersion: manifest.appVersion,
    schemaVersion: manifest.schemaVersion,
    restoreBlockedReason:
      manifest.schemaVersion > LATEST_SCHEMA_VERSION
        ? 'Written by a newer version of Ostler.'
        : null
  }
}

/**
 * Every readable backup directly inside `root`, newest first. `accept` can
 * narrow it further (the second place lists only the copies Ostler made).
 */
export function listBackupsIn(
  root: string,
  accept: (folder: string) => boolean = () => true
): BackupEntry[] {
  if (!fs.existsSync(root)) return []
  const entries: BackupEntry[] = []
  for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dirent.isDirectory() || !BACKUP_ID.test(dirent.name)) continue
    const folder = path.join(root, dirent.name)
    if (!accept(folder)) continue
    const manifest = readManifest(folder)
    if (manifest) entries.push(toEntry(dirent.name, manifest))
  }
  return entries.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
}

/** True when `id` could name a backup folder (a plain folder name, no path). */
export function isBackupId(id: unknown): id is string {
  return typeof id === 'string' && BACKUP_ID.test(id)
}

/**
 * The backups retention deletes, from a newest-first list: scheduled ones
 * past the newest `keepScheduled`, pre-migration ones past the newest five.
 * One rule for the main folder and the second place (N6.1).
 */
export function backupsPastRetention(backups: BackupEntry[], keepScheduled: number): BackupEntry[] {
  const past = (reason: BackupReason, keep: number) =>
    backups.filter((backup) => backup.reason === reason).slice(keep)
  return [
    ...past('scheduled', Math.max(1, keepScheduled)),
    ...past('pre-migration', PRE_MIGRATION_BACKUPS_KEPT)
  ]
}
