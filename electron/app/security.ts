import { session, shell } from 'electron'
import { t } from '@shared/i18n'
import { isContactAddress } from '@shared/contacts'

/**
 * Web content gets no permissions at all: no camera, microphone, location,
 * notifications, clipboard or anything else Chromium would otherwise prompt
 * for or grant. Notifications are shown by main (NotificationService), and
 * copying goes through the COPY_TEXT call.
 */
export function denyWebPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false)
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
}

const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

/** Whether `url` is one Ostler may hand to the operating system: http and https only. */
export function isAllowedExternalUrl(url: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/** The one way Ostler opens a link in the user's browser. */
export async function openExternalUrl(url: string): Promise<void> {
  if (!isAllowedExternalUrl(url)) throw new Error(t('errors:security.onlyHttpHttpsLinks'))
  await shell.openExternal(url)
}

/**
 * Call and Email on a contact (N6.5): the one other way Ostler hands an
 * address to Windows, which opens whatever app the person set for it. Only
 * `tel:` with digits (and a leading +) and `mailto:` with one address pass,
 * and callers build them from a contact's stored field (`openContactAddress`
 * in the contacts handlers), never from text found elsewhere.
 */
export async function openContactAddress(url: string): Promise<void> {
  if (!isContactAddress(url)) throw new Error(t('errors:security.onlyContactAddresses'))
  await shell.openExternal(url)
}
