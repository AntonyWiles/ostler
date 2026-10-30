import { BRAND } from '@shared/brand'
import { joinLinkFor } from '@shared/deep-link'
import { t } from '@shared/i18n'
import { shareFolderName, sharePlaceKind } from '@shared/sync-place'

/**
 * The message a person sends with an invite (people and devices, prompt 07): how to get
 * the shared folder, in the sync app `folder` is in, then the join link. A project on
 * the sync server has no folder: its first step is setting up the server. Join finds
 * the invite in the whole message.
 */
export function inviteMessage(projectName: string, invite: string, folder: string): string {
  const link = joinLinkFor(invite, BRAND.urlScheme)
  const kind = sharePlaceKind(folder)
  if (kind === 'server') {
    return t('projects:projectSharing.inviteMessageServer', {
      project: projectName,
      server: hostOf(folder),
      link
    })
  }
  if (kind === 'drive') {
    return t('projects:projectSharing.inviteMessageDrive', { project: projectName, link })
  }
  return t('projects:projectSharing.inviteMessage', {
    project: projectName,
    folderStep: t(`projects:projectSharing.inviteFolderStep.${kind}`, {
      folder: shareFolderName(folder)
    }),
    link
  })
}

/** `sync.example.com` for a server or one of its spaces. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
