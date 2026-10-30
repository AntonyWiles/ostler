import { dialog, shell, type BrowserWindow } from 'electron'
import { copyText } from '../app/clipboard'
import { forgetJoinInvite, peekJoinInvite } from '../app/join-links'
import * as fs from 'node:fs'
import * as path from 'path'
import { BRAND } from '@shared/brand'
import { findInvite, isEntityId } from '@shared/deep-link'
import { type JoinShareResult } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { isRefusal } from '@shared/refusal'
import type { ConfigStore } from '../config-store'
import { RemoveMemberError } from '../services/sync/rotation'
import { PersonLinkError } from '../services/sync/person-links'
import { inviteMessage } from '../services/sync/invite-message'
import { emailRefusal, sendEmail } from '../services/email-sender'
import { parseInvite, SharingError } from '../services/sync/sharing'
import type { DriveSyncSettings } from '../services/sync/drive-sync-settings'
import { isDriveLocation } from '../services/sync/drive-transport'
import {
  findShareFolder,
  JOIN_FOLDER_LIMITS,
  syncedRoots,
  syncPlaces
} from '../services/sync/share-folder-finder'
import { pickProjectFolder } from '../services/sync/personal-shares'
import type { PeopleService } from '../services/people-service'
import type { SyncService } from '../services/sync/sync-service'
import type { SyncServerSettings } from '../services/sync/sync-server-settings'
import { SyncServerError } from '../services/sync/http-transport'
import { randomUUID } from 'node:crypto'
import { handleApi } from './handle-ipc'

/** One address, no spaces: enough to refuse a typo before asking Google. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface SharingHandlerDependencies {
  syncService: SyncService
  /** The sync server (integrations phase 7); null when it can't be kept. */
  syncServer: SyncServerSettings | null
  /** Google Drive (mobile plan, phase 3); null when it can't be kept. */
  driveSync: DriveSyncSettings | null
  configStore: ConfigStore
  /** Hands a removed person's open tasks on; without it removal only removes. */
  peopleService?: Pick<PeopleService, 'handOverOpenTasks'>
  dataDir: string
  getMainWindow(): BrowserWindow | null
}

/**
 * Sharing a project through a synced folder (docs/plans/integrations/shared-folder-sync.md, S9b).
 * Folders are chosen in main's own picker, never sent by the renderer. The
 * invite goes from main straight to the clipboard; it is never returned to the
 * renderer or logged. A pasted invite comes in only to join.
 */
export function registerSharingHandlers({
  syncService,
  syncServer,
  driveSync,
  configStore,
  peopleService,
  dataDir,
  getMainWindow
}: SharingHandlerDependencies): void {
  // The data folder is this PC's own; sharing through it would mix the two.
  const assertOutsideDataFolder = (folder: string): string => {
    const relative = path.relative(path.resolve(dataDir).toLowerCase(), folder.toLowerCase())
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error(t('errors:sharing.insideDataFolder'))
    }
    return folder
  }

  const chooseFolder = async (title: string): Promise<string | null> => {
    const options: Electron.OpenDialogOptions = {
      title,
      properties: ['openDirectory', 'createDirectory']
    }
    const window = getMainWindow()
    const choice = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const chosen = choice.filePaths[0]
    if (choice.canceled || !chosen) return null
    return assertOutsideDataFolder(path.resolve(chosen))
  }

  /**
   * The invite a join call means: a pasted invite, or the one a join link left here
   * (`pendingId`, an id, which no invite is).
   */
  const inviteFrom = (value: unknown): { invite: string; pendingId: string | null } => {
    if (typeof value !== 'string') throw new Error(t('errors:sharing.not-an-invite'))
    if (isEntityId(value)) {
      const invite = peekJoinInvite(value)
      if (!invite) throw new Error(t('errors:sharing.joinLinkExpired'))
      return { invite, pendingId: value }
    }
    // A pasted invite may come inside the invite message, or as just its join link.
    const invite = findInvite(value, BRAND.urlScheme)
    if (!invite) throw new Error(t('errors:sharing.not-an-invite'))
    return { invite, pendingId: null }
  }

  /** The folder the invite's project is in, found on this PC. Null when it is not there (yet). */
  const findJoinFolder = async (shareId: string): Promise<string | null> => {
    const folder = await findShareFolder(shareId, syncedRoots(process.env, fs), {
      ...JOIN_FOLDER_LIMITS,
      fs
    })
    return folder ? assertOutsideDataFolder(folder) : null
  }

  /** Joins a project into `folder` and lists it. */
  const joinInto = async (
    invite: string,
    folder: string,
    pendingId: string | null
  ): Promise<JoinShareResult> => {
    // The join registers the project in the config store (registerJoinedProject), as the personal share's join does.
    const joined = await syncService.join(invite, folder).catch(refuse)
    if (pendingId) forgetJoinInvite(pendingId)
    const project = configStore.getProjects().find((entry) => entry.id === joined.projectId)
    return { projectId: joined.projectId, name: project?.name ?? '' }
  }

  /** The invite message for a shared project, as Share and Copy invite put it on the clipboard. */
  const copyInviteMessage = (projectId: string, projectName: string, invite: string | null) => {
    const folder = syncService.stateOf(projectId)?.folder
    if (invite && folder) copyText(inviteMessage(projectName, invite, folder))
  }

  const inviteRoleOf = (role: unknown): 'editor' | 'contributor' | 'viewer' =>
    role === 'viewer' || role === 'contributor' ? role : 'editor'

  const refuse = (error: unknown): never => {
    if (error instanceof SharingError) throw new Error(t(`errors:sharing.${error.reason}`))
    if (error instanceof SyncServerError) {
      throw new Error(t(`errors:syncServer.call.${error.reason}`))
    }
    if (error instanceof RemoveMemberError) {
      throw new Error(t(`errors:sharing.removeMember.${error.reason}`))
    }
    if (error instanceof PersonLinkError) {
      throw new Error(t(`errors:sharing.personLink.${error.reason}`))
    }
    if (isRefusal(error) && error.message === 'not-an-owner') {
      throw new Error(t('errors:sharing.notAnOwner'))
    }
    if (isRefusal(error) && error.message === 'not-everyone-supports') {
      throw new Error(t('errors:sharing.notEveryoneSupports'))
    }
    if (isRefusal(error) && error.message === 'invite-reset-not-everyone-supports') {
      throw new Error(t('errors:sharing.notEveryoneSupportsInviteReset', { brand: BRAND.name }))
    }
    if (isRefusal(error) && error.message === 'editors-not-everyone-supports') {
      throw new Error(t('errors:sharing.editorsNeedLatest', { brand: BRAND.name }))
    }
    throw error
  }

  const requireProject = (projectId: string) => {
    const project = configStore.getProjects().find((candidate) => candidate.id === projectId)
    if (!project) throw new Error(t('errors:sharing.projectNotFound'))
    return project
  }

  handleApi('getShareState', (_event, projectId: string) => syncService.stateOf(projectId))

  handleApi('getMembershipHistory', (_event, projectId: string) =>
    syncService.membershipHistory(projectId)
  )

  // The folder a project is synced through, shown in Explorer; a server share has no folder to show.
  handleApi('openShareFolder', (_event, projectId: string) => {
    requireProject(projectId)
    const folder = syncService.stateOf(projectId)?.folder
    if (!folder) throw new Error(t('errors:sharing.notShared'))
    if (/^https?:\/\//i.test(folder)) throw new Error(t('errors:sharing.notShared'))
    shell.showItemInFolder(folder)
  })

  handleApi('listSyncPlaces', () => syncPlaces(process.env, fs))

  /**
   * Where a project is shared through: a new folder for it in `place`, which must be one of the
   * sync apps' folders this PC has now (the renderer only names one main listed), or, without
   * one, a folder the person picks.
   */
  const shareFolderFor = async (place: unknown, projectName: string, projectId: string) => {
    if (typeof place !== 'string') return chooseFolder(t('errors:sharing.chooseShareFolder'))
    const wanted = path.resolve(place).toLowerCase()
    const match = syncPlaces(process.env, fs).find(
      (candidate) => path.resolve(candidate.folder).toLowerCase() === wanted
    )
    if (!match) throw new Error(t('errors:personalSpace.placeGone'))
    return assertOutsideDataFolder(pickProjectFolder(match.folder, projectName, projectId))
  }

  handleApi('shareProject', async (_event, projectId: string, place?: unknown) => {
    const project = requireProject(projectId)
    const folder = await shareFolderFor(place, project.name, projectId)
    if (!folder) return null
    await syncService.share(projectId, folder).catch(refuse)
    copyInviteMessage(projectId, project.name, syncService.invite(projectId))
    return syncService.stateOf(projectId)
  })

  // Through the sync server (phase 7): a new space for the project, no folder.
  handleApi('shareProjectOnServer', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    if (!syncServer) throw new Error(t('errors:syncServer.notReady'))
    const location = syncServer.newSpace(randomUUID())
    await syncService.share(projectId, location).catch(refuse)
    copyInviteMessage(projectId, project.name, syncService.invite(projectId))
    return syncService.stateOf(projectId)
  })

  // Through Google Drive: a new folder for the project in this PC's Drive, no folder on disk.
  handleApi('shareProjectOnDrive', async (_event, projectId: string) => {
    const project = requireProject(projectId)
    if (!driveSync?.ready()) throw new Error(t('errors:sharing.no-drive-account'))
    const location = await driveSync.newProjectFolder(project.name).catch(refuse)
    await syncService.share(projectId, location).catch(refuse)
    copyInviteMessage(projectId, project.name, syncService.invite(projectId))
    return syncService.stateOf(projectId)
  })

  handleApi('getDriveSharingReady', () => driveSync?.ready() ?? false)

  // Gives someone access to the project's Drive folder, so Google emails them a link (the Owner only).
  handleApi(
    'grantDriveAccess',
    async (_event, projectId: string, email: unknown, role: unknown) => {
      requireProject(projectId)
      const address = typeof email === 'string' ? email.trim() : ''
      if (address.length > 255 || !EMAIL_SHAPE.test(address)) {
        throw new Error(t('errors:sharing.invalidEmail'))
      }
      if (role !== 'owner' && role !== 'editor' && role !== 'viewer') {
        throw new Error(t('errors:sharing.invalidRole'))
      }
      const state = syncService.stateOf(projectId)
      if (!state || !isDriveLocation(state.folder)) {
        throw new Error(t('errors:sharing.notDriveShare'))
      }
      if (state.myRole !== 'owner') throw new Error(t('errors:sharing.notAnOwner'))
      if (!driveSync?.ready()) throw new Error(t('errors:sharing.no-drive-account'))
      try {
        await driveSync.grantAccess(state.folder, address, role === 'viewer' ? 'reader' : 'writer')
      } catch (error) {
        if (error instanceof SharingError) return refuse(error)
        throw new Error(t('errors:sharing.driveGrantFailed'))
      }
    }
  )

  handleApi('copyShareInvite', (_event, projectId: string, role?: unknown) => {
    const project = requireProject(projectId)
    let invite: string | null
    try {
      invite = syncService.invite(projectId, inviteRoleOf(role))
    } catch (error) {
      return refuse(error)
    }
    if (!invite) throw new Error(t('errors:sharing.notShared'))
    copyInviteMessage(projectId, project.name, invite)
  })

  // The same message, emailed through the person's own server (MOP-4).
  handleApi('emailShareInvite', async (_event, projectId: string, role: unknown, to: unknown) => {
    const project = requireProject(projectId)
    let invite: string | null
    try {
      invite = syncService.invite(projectId, inviteRoleOf(role))
    } catch (error) {
      return refuse(error)
    }
    const folder = syncService.stateOf(projectId)?.folder
    if (!invite || !folder) throw new Error(t('errors:sharing.notShared'))
    try {
      await sendEmail(configStore.get().email, {
        to: typeof to === 'string' ? to.trim() : '',
        subject: t('projects:projectSharing.inviteSubject', { project: project.name }),
        text: inviteMessage(project.name, invite, folder)
      })
    } catch (error) {
      throw emailRefusal(error)
    }
  })

  /** Where an invite's project is kept, if the invite says (a sync server space or a Drive folder). */
  const inviteLocation = (invite: string): { shareId: string; location?: string } => {
    let parsed: ReturnType<typeof parseInvite>
    try {
      parsed = parseInvite(invite)
    } catch (error) {
      return refuse(error)
    }
    if (parsed.location && isDriveLocation(parsed.location)) {
      if (!driveSync?.ready()) throw new Error(t('errors:sharing.no-drive-account'))
    } else if (parsed.location && !syncServer?.canOpen(parsed.location)) {
      throw new Error(t('errors:sharing.no-sync-server'))
    }
    return { shareId: parsed.shareId, location: parsed.location }
  }

  // Finds the shared folder by itself (prompt 07). Not on this PC yet: `waiting`, and the
  // Join step tries again; the person can choose the folder instead.
  handleApi('joinShare', async (_event, value: unknown): Promise<JoinShareResult | null> => {
    const { invite, pendingId } = inviteFrom(value)
    const { shareId, location } = inviteLocation(invite)
    // An invite to a project on the sync server or in Drive says where it is: no folder to find.
    if (location) return joinInto(invite, location, pendingId)
    const folder = await findJoinFolder(shareId)
    if (!folder) return { waiting: true }
    return joinInto(invite, folder, pendingId)
  })

  handleApi(
    'joinShareChooseFolder',
    async (_event, value: unknown): Promise<JoinShareResult | null> => {
      const { invite, pendingId } = inviteFrom(value)
      const { location } = inviteLocation(invite)
      const folder = location ?? (await chooseFolder(t('errors:sharing.chooseJoinFolder')))
      if (!folder) return null
      return joinInto(invite, folder, pendingId)
    }
  )

  handleApi('leaveShare', async (_event, projectId: string) => {
    await syncService.leave(projectId)
  })

  handleApi('syncShareNow', async (_event, projectId: string) => {
    await syncService.syncNow(projectId)
    return syncService.stateOf(projectId)
  })

  handleApi('removeShareMember', async (_event, projectId: string, memberId: string) => {
    if (typeof memberId !== 'string') throw new Error(t('errors:sharing.removeMember.not-a-member'))
    await syncService.removeMember(projectId, memberId).catch(refuse)
    return syncService.stateOf(projectId)
  })

  handleApi('stopOldInvites', async (_event, projectId: string) => {
    await syncService.stopOldInvites(projectId).catch(refuse)
    return syncService.stateOf(projectId)
  })

  handleApi(
    'removeSharePerson',
    async (_event, projectId: string, personKey: string, giveOpenTasksTo?: unknown) => {
      if (typeof personKey !== 'string')
        throw new Error(t('errors:sharing.removeMember.not-a-member'))
      if (giveOpenTasksTo !== undefined && giveOpenTasksTo !== null) {
        if (typeof giveOpenTasksTo !== 'string' || !isEntityId(giveOpenTasksTo)) {
          throw new Error(t('errors:peopleService.chooseSomeoneElseToTake'))
        }
      }
      // Owner and member checks run first inside removePerson; the tasks are handed on
      // (ordinary Owner edits, captured for the others) before the key rotates.
      await syncService
        .removePerson(
          projectId,
          personKey,
          giveOpenTasksTo !== undefined && peopleService
            ? (personId) =>
                void peopleService.handOverOpenTasks(projectId, personId, giveOpenTasksTo)
            : undefined
        )
        .catch(refuse)
      return syncService.stateOf(projectId)
    }
  )

  handleApi('setShareRole', async (_event, projectId: string, personKey: string, role: unknown) => {
    if (typeof personKey !== 'string')
      throw new Error(t('errors:sharing.removeMember.not-a-member'))
    if (role !== 'owner' && role !== 'editor' && role !== 'contributor' && role !== 'viewer') {
      throw new Error(t('errors:sharing.invalidRole'))
    }
    await syncService.setRole(projectId, personKey, role).catch(refuse)
    return syncService.stateOf(projectId)
  })

  handleApi('getPersonLinks', (_event, projectId: string) => syncService.personLinks(projectId))

  handleApi(
    'answerPersonLink',
    (_event, projectId: string, personKey: string, candidatePersonId: string, answer: string) => {
      if (typeof personKey !== 'string' || typeof candidatePersonId !== 'string') {
        throw new Error(t('errors:sharing.personLink.not-a-candidate'))
      }
      if (answer !== 'yes' && answer !== 'no') {
        throw new Error(t('errors:sharing.personLink.not-a-candidate'))
      }
      try {
        return syncService.answerPersonLink(projectId, personKey, candidatePersonId, answer)
      } catch (error) {
        return refuse(error)
      }
    }
  )
}
