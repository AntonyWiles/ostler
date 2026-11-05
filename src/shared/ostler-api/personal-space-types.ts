/**
 * The personal space: this person's devices, and the code a new device shows (people and
 * devices, D13, D16, D20). Keys, certificates and the folder's files stay in the main process;
 * the renderer only sees the state below.
 */

/** One of this person's devices, as the personal space shows it. */
export interface PersonalDeviceView {
  /** The device's id in the space's files (its pairing id). */
  deviceId: string
  name: string
  /** This PC. */
  isThisDevice: boolean
  /** Removed: it no longer receives this person's personal data. */
  revoked: boolean
}

/** A device asking to join the personal space, with the code both screens show. */
export interface PairingRequestView {
  deviceId: string
  deviceName: string
  /** Six digits. The person checks it is the same on the new device before allowing it. */
  code: string
}

/** A sync app Ostler recognises on a PC. */
export type SyncProvider = 'onedrive' | 'google-drive' | 'dropbox'

/** A sync app's folder on this PC, offered as a place for the personal space. */
export interface SyncPlaceView {
  provider: SyncProvider
  folder: string
}

/**
 * The `place` that `createPersonalSpace` takes for "keep it in Google Drive": the space goes in
 * Ostler's own folder in My Drive, not in a folder on this PC.
 */
export const DRIVE_PLACE_CHOICE = 'gdrive:'

/**
 * The `place` that `createPersonalSpace` takes for "keep it in my own R2 bucket": the space goes
 * in `Ostler/` in the bucket saved under Advanced sync (`r2:Ostler/Personal`, projects in
 * `r2:Ostler/Projects/…`), not in a folder on this PC.
 */
export const R2_PLACE_CHOICE = 'r2:'

export interface PersonalSpaceState {
  /** This PC has a personal space. */
  on: boolean
  /** The space's folder on this PC (its `Ostler` folder), when one is found; else null. */
  folder: string | null
  /** This PC asked to join and is waiting for a device that is already in the space to allow it. */
  waitingForApproval: boolean
  /** This PC's name as the other devices show it (the name it asks to join with). */
  thisDeviceName: string
  /** While this PC waits to join: the six-digit code the other device shows too; else null. */
  joinCode: string | null
  /** This PC has the personal space and has pulled it once in full: its people, projects and settings are here. */
  pulled: boolean
  /** This person's devices, when the space is on this PC. */
  devices: PersonalDeviceView[]
  /** Devices asking to join, when the space is on this PC. */
  requests: PairingRequestView[]
  /** While the space is off: the sync apps' folders on this PC it can be kept in. */
  places: SyncPlaceView[]
  /** Google Drive sync is ready (a connected account can use Drive), so the space can be kept there. */
  driveReady: boolean
  /** Moving the space from Drive or a folder into the R2 bucket; absent when there is nothing to show. */
  move?: SpaceMoveView
}

/** Moving the personal space into the R2 bucket set up under Advanced sync. */
export interface SpaceMoveView {
  /** The space is in Drive or a folder and a bucket is set up, so it can be moved. */
  canMove: boolean
  /** A move is under way. */
  running: boolean
  /** Files copied into the bucket so far, of `total` the bucket lacked. */
  copied: number
  total: number
  /** How the last move on this run ended; null before one. */
  result: 'done' | 'failed' | null
  /** Why the last move failed, in the person's words. */
  error: string | null
  /** Shares that stayed where they are (a sync server, another Drive folder). */
  kept: number
  /** Another device moved the space into R2 and this PC has no bucket set up to follow it. */
  movedElsewhere: boolean
}

/**
 * Advanced sync: this PC copies its personal space folder to and from a Cloudflare R2 bucket (or
 * another S3-compatible store), so a phone can sync through the bucket. The secret key never
 * comes back to the renderer.
 */
export interface R2SyncState {
  /** A bucket is set up. */
  configured: boolean
  /** Copying is on. */
  enabled: boolean
  accountId: string
  bucket: string
  prefix: string
  endpoint: string
  accessKeyId: string
  hasSecret: boolean
  /** How often to look for other devices' changes, in minutes; 0 = only on Sync now. */
  checkMinutes: number
  /** Send this PC's changes soon after they happen (at most every 30 s), not only at the check. */
  uploadSoon: boolean
  /** The personal space folder that is copied; null when there is none on this PC (or it is in Drive, not a folder). */
  spaceFolder: string | null
  /** Share folders that are not below the space's parent, so they can't be copied. */
  skippedFolders: number
  running: boolean
  lastRunAt: number | null
  /** The last run's error, already in the person's language; null after a good run. */
  lastError: string | null
  /** This PC's calls to the bucket this calendar month, by R2's billing class. */
  usage: {
    month: string
    /** Class A: writes and listings (a million a month are free, for every device together). */
    writes: number
    /** Class B: reads and change checks (ten million a month are free). */
    reads: number
    /** This PC alone has used half of either free allowance. */
    nearFreeTier: boolean
  }
  lastUploaded: number
  lastDownloaded: number
}

export interface SetR2SyncInput {
  accountId: string
  bucket: string
  prefix?: string
  endpoint?: string
  accessKeyId: string
  /** Blank keeps the saved one. */
  secretAccessKey?: string
  checkMinutes: number
  uploadSoon: boolean
  enabled: boolean
}

/** A sealed setup code and the passphrase that opens it, shown once. */
export interface R2SetupCodeView {
  code: string
  passphrase: string
}
