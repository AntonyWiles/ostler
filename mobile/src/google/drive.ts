import { DRIVE_FOLDER_MIME, GoogleDriveClient } from '../../../electron/services/sync/drive-client'
import { BRAND } from '../../../src/shared/brand'
import { accessToken, discardToken } from './account'
import { createDriveRequest } from './drive-request'

/** The phone's Drive client: `fetch` plus a fresh Google access token for every call. */
export function createPhoneDriveClient(): GoogleDriveClient {
  return new GoogleDriveClient(createDriveRequest({ accessToken, discardToken, fetch }))
}

export interface OstlerFolderListing {
  /** Names of the folders inside Ostler's folder, or null when the PC has not made it yet. */
  folders: string[] | null
}

/** Finds Ostler's folder in the root of My Drive (oldest if several) and lists its folders. */
export async function listOstlerFolder(
  client: GoogleDriveClient = createPhoneDriveClient()
): Promise<OstlerFolderListing> {
  const roots = await client.findInRoot(BRAND.name)
  const oldest = [...roots].sort((a, b) => a.createdTime.localeCompare(b.createdTime))[0]
  if (!oldest) return { folders: null }
  const children = await client.listChildren(oldest.id)
  const folders = children
    .filter((file) => file.mimeType === DRIVE_FOLDER_MIME)
    .map((file) => file.name)
    .sort((a, b) => a.localeCompare(b))
  return { folders }
}
