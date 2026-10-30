/**
 * Links to files in OneDrive, SharePoint, Google Drive and Dropbox
 * (docs/plans/integrations/overview.md, phase 3). A Library link whose
 * address is one of these is a cloud file: Ostler keeps only the link, never
 * a copy, and with a connected account that can pick files it reads the
 * file's current name from the provider. Only `https` addresses on the
 * services' own hosts count.
 */
import type { AccountProvider } from './ostler-api/account-types'

export type CloudFileService = 'onedrive' | 'sharepoint' | 'googleDrive' | 'dropbox'

export interface CloudFileLink {
  service: CloudFileService
  /** The kind of account that can read its name. */
  provider: AccountProvider
}

/** The cloud service a link points into, or null for any other address. */
export function cloudFileOf(url: string | null | undefined): CloudFileLink | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
  const host = parsed.hostname.toLowerCase()
  if (host === '1drv.ms' || host === 'onedrive.live.com') {
    return { service: 'onedrive', provider: 'microsoft' }
  }
  if (/^[a-z0-9-]+(-my)?\.sharepoint\.com$/.test(host)) {
    return {
      service: host.endsWith('-my.sharepoint.com') ? 'onedrive' : 'sharepoint',
      provider: 'microsoft'
    }
  }
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    return googleFileId(parsed) ? { service: 'googleDrive', provider: 'google' } : null
  }
  if (
    host === 'www.dropbox.com' ||
    host === 'dropbox.com' ||
    host === 'dl.dropboxusercontent.com'
  ) {
    return { service: 'dropbox', provider: 'dropbox' }
  }
  return null
}

/** A Google Drive or Docs file's id: `/file/d/<id>`, `/document/d/<id>`, or `?id=<id>`. */
export function googleFileId(url: URL): string | null {
  const path = /\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname)
  if (path) return path[1]
  const query = url.searchParams.get('id')
  return query && /^[A-Za-z0-9_-]{10,}$/.test(query) ? query : null
}
