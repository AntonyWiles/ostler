/**
 * Cloud file links (docs/plans/integrations/overview.md, phase 3): the
 * current name of a OneDrive, SharePoint, Google Drive or Dropbox file a
 * Library link points to, read through a connected account that can pick
 * files. Only the name (and the provider's own web address) comes back;
 * Ostler never downloads or copies the file.
 *
 * Google's `drive.file` scope only reaches files picked with Ostler, so a
 * pasted Google link may be refused; the link still works, without a live name.
 */
import { cloudFileOf, googleFileId } from '@shared/cloud-file-link'
import type { ConnectedAccountsService } from './connected-accounts-service'

type Accounts = Pick<ConnectedAccountsService, 'callJson'>

export interface CloudFileName {
  name: string
  webUrl: string | null
}

/** The file's name now, through `accountId`. Throws `AccountCallError` when the provider refuses. */
export async function cloudFileName(
  accounts: Accounts,
  accountId: string,
  url: string
): Promise<CloudFileName | null> {
  const link = cloudFileOf(url)
  if (!link) return null
  switch (link.service) {
    case 'onedrive':
    case 'sharepoint': {
      // Graph's shares API takes the link itself, as "u!" + unpadded base64url.
      const token = `u!${Buffer.from(url).toString('base64url')}`
      const item = await accounts.callJson<{ name?: string; webUrl?: string }>(
        accountId,
        `https://graph.microsoft.com/v1.0/shares/${token}/driveItem?$select=name,webUrl`
      )
      return item.name ? { name: item.name, webUrl: item.webUrl ?? null } : null
    }
    case 'googleDrive': {
      const id = googleFileId(new URL(url))
      if (!id) return null
      const file = await accounts.callJson<{ name?: string; webViewLink?: string }>(
        accountId,
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=name,webViewLink&supportsAllDrives=true`
      )
      return file.name ? { name: file.name, webUrl: file.webViewLink ?? null } : null
    }
    case 'dropbox': {
      const meta = await accounts.callJson<{ name?: string; url?: string }>(
        accountId,
        'https://api.dropboxapi.com/2/sharing/get_shared_link_metadata',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        }
      )
      return meta.name ? { name: meta.name, webUrl: meta.url ?? null } : null
    }
  }
}
