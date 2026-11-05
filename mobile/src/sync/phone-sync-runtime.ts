import { Platform } from 'react-native'
import { DriveChangesPoller } from '../../../electron/services/sync/drive-changes'
import { DriveTransport, pollerSubscription } from '../../../electron/services/sync/drive-transport'
import { PERSONAL_PROJECT_ID } from '../../../electron/services/sync/synced-tables'
import {
  isR2Location,
  R2Changes,
  R2Client,
  r2Location,
  R2Transport
} from '../../../electron/services/sync/r2-transport'
import type { R2Setup } from '../../../electron/services/sync/r2-setup-code'
import { PERSONAL_FOLDER } from '../../../electron/services/sync/pairing'
import { joinPlace, readShareFile } from '../../../electron/services/sync/sharing'
import { SyncTransportError } from '../../../electron/services/sync/transport-paths'
import { BRAND } from '../../../src/shared/brand'
import type { OstlerDatabase } from '../db/database'
import { createPhoneDriveClient } from '../google/drive'
import { phoneLibraryFiles } from '../data/voice-memo-files'
import { PhoneSync, type SyncDatabase } from './phone-sync'
import { PhonePairing } from './phone-pairing'
import { rememberProjectColor, rememberProjectName } from './project-names'
import { phoneR2Usage } from './r2-phone-settings'

/** A name the other members will recognise: the phone's model, else the app's name. */
function deviceName(): string {
  const model = (Platform.constants as { Model?: string }).Model
  return model ? `${model} (${BRAND.name})` : `${BRAND.name} phone`
}

/** The phone's sync loop and the pairing that hands it the personal share, on one Drive client and poller. */
export interface PhoneDevices {
  sync: PhoneSync
  pairing: PhonePairing
  /** Advanced sync: asks the bucket what changed now (Sync now); null without a bucket. */
  r2Changes: R2Changes | null
}

/** Where the phone's shares are kept: Google Drive (signed in), an R2 bucket, or both. */
export interface PhoneSyncPlaces {
  drive: boolean
  r2: R2Setup | null
}

/**
 * The phone's sync loop on its real parts: the one Drive client of the signed-in account, the
 * account's one change poller, and the open database. Created after sign-in; the app starts and
 * stops it with the foreground.
 */
export function createPhoneSync(
  db: OstlerDatabase,
  onChanged: (projectId: string) => void,
  places: PhoneSyncPlaces = { drive: true, r2: null }
): PhoneDevices {
  const client = createPhoneDriveClient()
  const poller = new DriveChangesPoller(client)
  const r2 = places.r2
  const bucket = r2
    ? new R2Client(r2.config, { fetch: (url, init) => fetch(url, init), usage: phoneR2Usage() })
    : null
  const r2Changes = bucket
    ? new R2Changes(bucket, {
        intervalMs: r2 && r2.checkMinutes > 0 ? r2.checkMinutes * 60_000 : null,
        log: (message, error) =>
          console.log(`OSTLER11 ${message}`, error instanceof Error ? error.message : '')
      })
    : null
  const openTransport = (place: string) => {
    if (isR2Location(place)) {
      if (!bucket) throw new SyncTransportError('bad-path')
      return new R2Transport(bucket, place, r2Changes)
    }
    return new DriveTransport(client, place, { subscribe: pollerSubscription(poller) })
  }
  // With a bucket, a share kept in a folder on the PC is reached at the same path in the bucket.
  const placeFor = r2
    ? async (written: string, belowRoot: boolean): Promise<string | null> => {
        if (isR2Location(written)) return written
        if (!belowRoot) return null
        const segments = written.split('/').filter((part) => part !== '')
        try {
          return r2Location(segments.join('/'))
        } catch {
          return null
        }
      }
    : undefined
  const sync = new PhoneSync({
    // The adapter has the calls the engine's core files make (report 07).
    db: db as unknown as SyncDatabase,
    openTransport,
    ...(places.drive && !r2 ? { findInRoot: (name: string) => client.findInRoot(name) } : {}),
    ...(placeFor ? { placeFor } : {}),
    poller,
    // Voice memos recorded here go to the project's share; the PC's files are not fetched.
    library: phoneLibraryFiles,
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
    ...(r2
      ? {
          findSpace: async () => {
            const space = r2Location(r2.space)
            try {
              await readShareFile(openTransport(joinPlace(space, PERSONAL_FOLDER)))
              return space
            } catch {
              return null
            }
          },
          newSpace: r2Location(r2.space)
        }
      : {}),
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
  return { sync, pairing, r2Changes }
}
