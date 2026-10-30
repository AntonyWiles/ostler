import type { SyncProvider } from './ostler-api'

/** The sync apps' own names, as they write them in every language. */
export const SYNC_PROVIDER_NAMES: Record<SyncProvider, string> = {
  onedrive: 'OneDrive',
  'google-drive': 'Google Drive',
  dropbox: 'Dropbox'
}

/** Where a shared project is kept: in a sync app's folder, on the sync server, in a Google Drive folder Ostler keeps itself (`gdrive:`), or in some other folder. */
export type SharePlaceKind = SyncProvider | 'server' | 'drive' | 'folder'

/**
 * Which sync app keeps a folder, from its path: a "My Drive" or "Google Drive" folder is
 * Google Drive's, a "OneDrive…" folder OneDrive's, a "Dropbox…" folder Dropbox's. An
 * http(s) address is the sync server; anything else is a folder of another kind, such
 * as one on a network drive. The invite message and the Sharing panel both word their
 * steps from it.
 */
export function sharePlaceKind(folder: string): SharePlaceKind {
  if (/^https?:\/\//i.test(folder)) return 'server'
  if (/^gdrive:/i.test(folder)) return 'drive'
  const parts = folder
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase())
  if (parts.some((part) => part === 'my drive' || part === 'google drive')) return 'google-drive'
  if (parts.some((part) => part.startsWith('onedrive'))) return 'onedrive'
  if (parts.some((part) => part.startsWith('dropbox'))) return 'dropbox'
  return 'folder'
}

/** The shared folder's own name, which the person it is shared with sees in their sync app. */
export function shareFolderName(folder: string): string {
  const parts = folder.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? folder
}
