// ─── Backups ────────────────────────────────────────────────────────────────

/**
 * Why a backup exists. Only `scheduled` and `pre-migration` backups are ever
 * deleted automatically (retention); `manual` and `pre-restore` stay until the
 * user deletes them.
 */
export type BackupReason = 'manual' | 'scheduled' | 'pre-restore' | 'pre-migration'

/** `manifest.json` inside every backup folder. */
export interface BackupManifest {
  format: 'ostler-backup'
  formatVersion: 1
  appVersion: string
  /** `PRAGMA user_version` of the saved `ostler.db`. */
  schemaVersion: number
  /** `configVersion` of the saved `config.json`, or null when no config was saved. */
  configVersion: number | null
  reason: BackupReason
  /** Epoch milliseconds. */
  createdAt: number
  bytes: { database: number; config: number; library: number; ai: number }
  /** Parts of the data folder this backup deliberately does not hold. */
  excludes: string[]
}

/** One backup as Settings lists it. */
export interface BackupEntry {
  /** The folder name under `<dataDir>/backups/`. */
  id: string
  reason: BackupReason
  createdAt: number
  sizeBytes: number
  appVersion: string
  schemaVersion: number
  /** Null when the backup can be restored; otherwise why not. */
  restoreBlockedReason: string | null
}

export interface BackupSettings {
  enabled: boolean
  /** A scheduled backup is made when the newest backup is older than this. */
  intervalHours: number
  /** Scheduled backups kept; older ones are deleted. */
  keep: number
  /**
   * The second place (N6.1): a folder each backup is also copied to, under
   * `<copyTo>\<BRAND.name> backups\`, or null. Set only through
   * `chooseBackupCopyFolder` and `stopBackupCopy`, never by `updateConfig`.
   */
  copyTo: string | null
  /** When a backup was last copied to `copyTo` (epoch ms), or null. */
  lastCopiedAt: number | null
  /** When copying first failed since the last success (epoch ms), or null. */
  copyFailedAt: number | null
}

/** Settings › Data › Backups' second place, as main reports it. */
export interface BackupCopyStatus {
  /** The folder the person chose, or null when backups are not copied. */
  folder: string | null
  /** Where the copies go inside it: `<folder>\<BRAND.name> backups`. */
  target: string | null
  /** The sync service the folder is inside, when Ostler recognises one. */
  syncedBy: 'OneDrive' | 'Dropbox' | 'Google Drive' | null
  lastCopiedAt: number | null
  copyFailedAt: number | null
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  enabled: true,
  intervalHours: 24,
  keep: 7,
  copyTo: null,
  lastCopiedAt: null,
  copyFailedAt: null
}

/** Clamps stored or user-entered backup settings to values the scheduler accepts. */
export function normalizeBackupSettings(
  value: Partial<BackupSettings> | undefined
): BackupSettings {
  const whole = (input: unknown, fallback: number, min: number, max: number): number => {
    const number = Math.floor(Number(input))
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
  }
  return {
    enabled: typeof value?.enabled === 'boolean' ? value.enabled : DEFAULT_BACKUP_SETTINGS.enabled,
    intervalHours: whole(value?.intervalHours, DEFAULT_BACKUP_SETTINGS.intervalHours, 1, 24 * 30),
    keep: whole(value?.keep, DEFAULT_BACKUP_SETTINGS.keep, 1, 100),
    copyTo: typeof value?.copyTo === 'string' && value.copyTo !== '' ? value.copyTo : null,
    lastCopiedAt: typeof value?.lastCopiedAt === 'number' ? value.lastCopiedAt : null,
    copyFailedAt: typeof value?.copyFailedAt === 'number' ? value.copyFailedAt : null
  }
}
