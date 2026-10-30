import { dialog, type BrowserWindow } from 'electron'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DRIVE_PLACE_CHOICE, type PersonalSpaceState } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import { RemoveMemberError } from '../services/sync/rotation'
import {
  findPersonalSpace,
  PERSONAL_FOLDER,
  personalSpaceIn,
  PersonalSpaceError,
  setAsideFolderSpace
} from '../services/sync/personal-space'
import { isDriveLocation } from '../services/sync/drive-transport'
import type { DriveSyncSettings } from '../services/sync/drive-sync-settings'
import { joinPlace, readShareFile } from '../services/sync/sharing'
import { syncedRoots, syncPlaces } from '../services/sync/share-folder-finder'
import type { SyncService } from '../services/sync/sync-service'
import { handleApi } from './handle-ipc'

export interface DevicesHandlerDependencies {
  syncService: SyncService
  /** Google Drive (mobile plan, phase 5); null when it can't be kept. */
  driveSync: DriveSyncSettings | null
  dataDir: string
  getMainWindow(): BrowserWindow | null
}

/** The longest device name a person can give (the same limit the sync files check). */
const DEVICE_NAME_MAX = 100

/**
 * The personal space (people and devices, D13, D16, D20): making it, joining it
 * from another device with a code, allowing a device in, and removing one. Folders are found or
 * chosen in main, never by the renderer; keys and codes never leave main except as the state
 * below shows them.
 */
export function registerDevicesHandlers({
  syncService,
  driveSync,
  dataDir,
  getMainWindow
}: DevicesHandlerDependencies): void {
  // Set when this PC asked to join; cleared once it has joined.
  let requested = false
  // The space the person chose by hand to join, which the search under the synced roots may not find.
  let chosenSpace: string | null = null

  // The data folder is this PC's own; a personal space there would mix the two.
  const assertOutsideDataFolder = (folder: string): string => {
    const relative = path.relative(path.resolve(dataDir).toLowerCase(), folder.toLowerCase())
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error(t('errors:sharing.insideDataFolder'))
    }
    return folder
  }

  const deviceName = (given: unknown): string => {
    const name = typeof given === 'string' ? given.trim().slice(0, DEVICE_NAME_MAX) : ''
    return name || os.hostname() || t('desktop:services.thisDevice')
  }

  /** A folder the person picks in main's picker; null when they cancel. */
  const pickFolder = async (title: string): Promise<string | null> => {
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
   * Where a new personal space goes: `place`, which must be one of the sync apps' folders this PC
   * has now (the renderer only names one main listed), or, without one, a folder the person picks.
   */
  const chooseRoot = async (place: unknown): Promise<string | null> => {
    if (place === DRIVE_PLACE_CHOICE) {
      // Ostler's own folder in My Drive, through the connected Google account; no folder on this PC.
      if (!driveSync?.ready()) throw new Error(t('errors:sharing.no-drive-account'))
      const root = await driveSync.rootPlace(true)
      if (!root) throw new Error(t('errors:sharing.no-drive-account'))
      return root
    }
    if (typeof place === 'string') {
      const wanted = path.resolve(place).toLowerCase()
      const match = syncPlaces(process.env, fs).find(
        (candidate) => path.resolve(candidate.folder).toLowerCase() === wanted
      )
      if (!match) throw new Error(t('errors:personalSpace.placeGone'))
      return assertOutsideDataFolder(match.folder)
    }
    return pickFolder(t('errors:personalSpace.chooseFolder'))
  }

  /**
   * The personal space in Ostler's folder in this account's Drive, when there is one (the same
   * account on another PC made it); null when Drive is not ready or holds no space.
   */
  const driveSpace = async (): Promise<string | null> => {
    if (!driveSync?.ready()) return null
    try {
      const root = await driveSync.rootPlace(false)
      if (!root) return null
      await readShareFile(driveSync.open(joinPlace(root, PERSONAL_FOLDER)))
      return root
    } catch {
      return null
    }
  }

  /** The personal space's folder: this PC's own, the one the person chose, or one a synced root or Drive holds. */
  const spaceFolder = async (): Promise<string | null> =>
    syncService.personalSpaceFolder() ??
    chosenSpace ??
    findPersonalSpace(syncedRoots(process.env, fs), fs) ??
    (await driveSpace())

  const refuse = (error: unknown): never => {
    if (error instanceof PersonalSpaceError) {
      throw new Error(t(`errors:personalSpace.${error.reason}`))
    }
    if (error instanceof RemoveMemberError) {
      throw new Error(t(`errors:sharing.removeMember.${error.reason}`))
    }
    throw error
  }

  /** The state the settings show. Looks for the space and tries to finish pairing when it is waiting. */
  const stateOf = async (): Promise<PersonalSpaceState> => {
    const own = syncService.personalSpaceFolder()
    if (own) {
      const devices = syncService.personalDevices().map((device) => ({
        deviceId: device.deviceId,
        name: device.name,
        isThisDevice: device.isThisDevice,
        revoked: device.revoked
      }))
      return {
        on: true,
        folder: own,
        waitingForApproval: false,
        thisDeviceName: deviceName(undefined),
        joinCode: null,
        pulled: syncService.personalPulled(),
        devices,
        requests: await syncService.pendingPairingRequests(own).catch(() => []),
        places: [],
        driveReady: false
      }
    }
    const folder = await spaceFolder()
    if (folder) {
      // A device is waiting for the keys another device writes; it joins once they are there.
      const result = await syncService.completePairing(folder).catch(() => 'waiting' as const)
      if (result === 'paired') {
        requested = false
        chosenSpace = null
        return stateOf()
      }
    }
    return {
      on: false,
      folder,
      waitingForApproval: requested && folder !== null,
      thisDeviceName: deviceName(undefined),
      joinCode:
        requested && folder !== null
          ? await syncService.joinCodeFor(folder).catch(() => null)
          : null,
      pulled: false,
      devices: [],
      requests: [],
      places: syncPlaces(process.env, fs),
      driveReady: driveSync?.ready() ?? false
    }
  }

  const requireSpace = (): string => {
    const folder = syncService.personalSpaceFolder()
    if (!folder) throw new Error(t('errors:personalSpace.no-personal-space'))
    return folder
  }

  const requireDeviceId = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) {
      throw new Error(t('errors:personalSpace.no-such-device'))
    }
    return value
  }

  handleApi('getPersonalSpace', () => stateOf())

  handleApi(
    'createPersonalSpace',
    async (_event, name?: unknown, place?: unknown): Promise<PersonalSpaceState | null> => {
      const root = await chooseRoot(place)
      if (!root) return null
      await syncService.createPersonalSpace(root, deviceName(name)).catch(refuse)
      return stateOf()
    }
  )

  handleApi('requestPairing', async (_event, name?: unknown): Promise<PersonalSpaceState> => {
    const folder = await spaceFolder()
    if (!folder) throw new Error(t('errors:personalSpace.noFolderFound'))
    await syncService.requestPairing(folder, deviceName(name)).catch(refuse)
    requested = true
    return stateOf()
  })

  handleApi(
    'choosePersonalSpace',
    async (_event, name?: unknown): Promise<PersonalSpaceState | null> => {
      const chosen = await pickFolder(t('errors:personalSpace.chooseSpaceFolder'))
      if (!chosen) return null
      const found = personalSpaceIn(chosen, fs)
      if (found.kind === 'newer') throw new Error(t('errors:personalSpace.newerSpace'))
      if (found.kind === 'none') throw new Error(t('errors:personalSpace.noSpaceInFolder'))
      const folder = assertOutsideDataFolder(found.folder)
      await syncService.requestPairing(folder, deviceName(name)).catch(refuse)
      chosenSpace = folder
      requested = true
      return stateOf()
    }
  )

  handleApi('cancelPairing', (): Promise<PersonalSpaceState> => {
    requested = false
    chosenSpace = null
    return stateOf()
  })

  // A space whose devices are all gone can let no one in: set its folders aside and start anew.
  handleApi(
    'startNewPersonalSpace',
    async (_event, name?: unknown): Promise<PersonalSpaceState> => {
      if (syncService.personalSpaceFolder()) {
        throw new Error(t('errors:personalSpace.already-personal'))
      }
      const folder = await spaceFolder()
      if (!folder) throw new Error(t('errors:personalSpace.noFolderFound'))
      try {
        if (isDriveLocation(folder)) {
          if (!driveSync?.ready()) throw new Error(t('errors:sharing.no-drive-account'))
          await driveSync.setAsideSpace(folder, new Date())
        } else {
          setAsideFolderSpace(folder, new Date(), fs)
        }
      } catch (error) {
        console.error('[devices] Could not set the old personal space aside:', error)
        throw new Error(t('errors:personalSpace.setAsideFailed'))
      }
      requested = false
      chosenSpace = null
      await syncService.createPersonalSpaceAt(folder, deviceName(name)).catch(refuse)
      return stateOf()
    }
  )

  handleApi('allowDevice', async (_event, deviceId: unknown): Promise<PersonalSpaceState> => {
    await syncService.allowDevice(requireSpace(), requireDeviceId(deviceId)).catch(refuse)
    return stateOf()
  })

  handleApi('removeDevice', async (_event, deviceId: unknown): Promise<PersonalSpaceState> => {
    await syncService.removePersonalDevice(requireSpace(), requireDeviceId(deviceId)).catch(refuse)
    return stateOf()
  })
}
