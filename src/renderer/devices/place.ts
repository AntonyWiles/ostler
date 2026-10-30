import { BRAND } from '@shared/brand'
import { sharePlaceKind } from '@shared/sync-place'

export { SYNC_PROVIDER_NAMES } from '@shared/sync-place'

/**
 * Where a synced folder is, for a person to find it: "Google Drive › My Drive › Ostler"
 * rather than a drive-letter path. A folder in no known sync service is shown as it is.
 */
export function placeOf(folder: string): string {
  // A personal space in Drive: Ostler's own folder in My Drive.
  if (folder.startsWith('gdrive:')) return ['Google Drive', 'My Drive', BRAND.name].join(' › ')
  const parts = folder.split(/[\\/]+/).filter(Boolean)
  const kind = sharePlaceKind(folder)
  if (kind === 'google-drive') {
    const myDrive = parts.findIndex((part) => part.toLowerCase() === 'my drive')
    if (myDrive >= 0) return ['Google Drive', ...parts.slice(myDrive)].join(' › ')
    const drive = parts.findIndex((part) => part.toLowerCase() === 'google drive')
    return parts.slice(drive).join(' › ')
  }
  if (kind === 'onedrive' || kind === 'dropbox') {
    const service = parts.findIndex((part) => part.toLowerCase().startsWith(kind))
    return parts.slice(service).join(' › ')
  }
  return folder
}
