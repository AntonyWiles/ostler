import { Platform } from 'react-native'
import { DriveChangesPoller } from '../../../electron/services/sync/drive-changes'
import { DriveTransport, pollerSubscription } from '../../../electron/services/sync/drive-transport'
import { PERSONAL_PROJECT_ID } from '../../../electron/services/sync/synced-tables'
import { BRAND } from '../../../src/shared/brand'
import type { OstlerDatabase } from '../db/database'
import { createPhoneDriveClient } from '../google/drive'
import { PhoneSync, type SyncDatabase } from './phone-sync'
import { PhonePairing } from './phone-pairing'
import { rememberProjectColor, rememberProjectName } from './project-names'

/** A name the other members will recognise: the phone's model, else the app's name. */
function deviceName(): string {
  const model = (Platform.constants as { Model?: string }).Model
  return model ? `${model} (${BRAND.name})` : `${BRAND.name} phone`
}

/** The phone's sync loop and the pairing that hands it the personal share, on one Drive client and poller. */
export interface PhoneDevices {
  sync: PhoneSync
  pairing: PhonePairing
}

/**
 * The phone's sync loop on its real parts: the one Drive client of the signed-in account, the
 * account's one change poller, and the open database. Created after sign-in; the app starts and
 * stops it with the foreground.
 */
export function createPhoneSync(
  db: OstlerDatabase,
  onChanged: (projectId: string) => void
): PhoneDevices {
  const client = createPhoneDriveClient()
  const poller = new DriveChangesPoller(client)
  const openTransport = (place: string) =>
    new DriveTransport(client, place, { subscribe: pollerSubscription(poller) })
  const sync = new PhoneSync({
    // The adapter has the calls the engine's core files make (report 07).
    db: db as unknown as SyncDatabase,
    openTransport,
    findInRoot: (name) => client.findInRoot(name),
    poller,
    now: Date.now,
    deviceName: deviceName(),
    // Only the message of an error is logged, never a request or a key.
    log: (message, error) =>
      console.log(`OSTLER09 ${message}`, error instanceof Error ? error.message : ''),
    // Projects that arrive from the personal space have no screen to name them, so they are named here.
    onJoined: (result) => {
      if (result.project?.name) rememberProjectName(result.projectId, result.project.name)
      rememberProjectColor(result.projectId, result.project?.color)
    },
    onChanged
  })
  const pairing = new PhonePairing({
    db: db as unknown as SyncDatabase,
    client,
    openTransport,
    deviceName: deviceName(),
    // The personal share is joined: run it, so its projects arrive.
    onPaired: () => {
      sync.startPersonal()
      onChanged(PERSONAL_PROJECT_ID)
    },
    log: (message, error) =>
      console.log(
        `OSTLER10 ${message}`,
        error instanceof Error ? error.message : typeof error === 'string' ? error : ''
      )
  })
  return { sync, pairing }
}
