/**
 * The personal space: one person's devices keep their personal data in one share, and a
 * new device joins it with a six-digit code (docs/plans/people-and-devices/overview.md,
 * D13 one personal share, D16 pairing, D20 removing a device).
 *
 * The space is a folder `<root>/Ostler/` that a synced provider keeps in step:
 *   Personal/                  the personal share (share.json, members/, changes/, snapshots/ …)
 *   devices/requests/<id>.ostlerrequest   a new device asks to join; signed by the device, not encrypted
 *   devices/<id>.ostlerdevice  the device certificate, signed by the person key (sync-keys.ts)
 *   devices/<id>.ostlerkeys    the person key and the personal share's keys, wrapped to the device's box key
 *   devices/<id>.ostlerrevoked a removal, signed by the person key
 * `<id>` is the first 32 hex digits of SHA-256 of the device's identity public key, so a
 * device has one name in the folder and no state is needed to find its own files.
 *
 * Pairing: the new device (B) writes a request. Both PCs show the same six-digit code,
 * computed from the device key and the person key. The PC that is already paired (A) allows
 * it: A writes the certificate and the keys file, which also carries A's Me person. B reads
 * them, checks them, takes that Me as its own (so the person has one Me id on every device,
 * overview section 2), and joins the personal share as a new member. Removing a device (D20) removes its member from the
 * personal share and from each project share it is in, then writes the revocation.
 *
 * Plan sections: prompt 09 of docs/plans/people-and-devices. Folder access goes through a
 * `FolderTransport`; keys stay in the main process (sealed with sync-keys).
 */
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type Database from 'better-sqlite3'
import { newDeviceId } from '@shared/sync/clock'
import { newProjectKey } from './change-file'
import { openFolderTransport } from './folder-transport'
import { isDriveLocation } from './drive-transport'
import { wrapForBoxKey, removeMember } from './rotation'
import { joinPlace, SHARE_FORMAT_VERSION, writeMember, type Invite } from './sharing'
import type { FinderFs } from './share-folder-finder'
import { writeSnapshot } from './snapshots'
import { PERSONAL_PROJECT_ID } from './synced-tables'
import {
  PERSONAL_FOLDER,
  PersonalSpaceError,
  SPACE_FOLDER,
  SPACE_OWN_FOLDERS,
  oldSpaceFolderName,
  REQUEST_PATTERN,
  DEVICE_ID_PATTERN,
  checkedName,
  devicesFolder,
  isCertified,
  openSignedJson,
  pairingCode,
  pairingContext,
  pairingDeviceId,
  personalShareOf,
  readCertificate,
  readRequest,
  signedJson,
  writeIfMissing,
  completePairing as completePairingIn,
  pairingCodeInSpace as pairingCodeInSpaceIn,
  requestPairing as requestPairingIn,
  type KeysPayload,
  type OpenTransport
} from './pairing'
import {
  certifyDevice,
  identityKeys,
  keyGenerationOf,
  personKeys,
  projectKeyring,
  storeProjectKey,
  thisDeviceCertificate
} from './sync-keys'
import type { MePerson } from './sharing'

// The new device's half of pairing lives in pairing.ts (a core file the phone shares); these
// names stay importable from here.
export {
  DEVICES_FOLDER,
  PERSONAL_FOLDER,
  PersonalSpaceError,
  SPACE_FOLDER,
  pairingCode,
  pairingDeviceId,
  type OpenTransport
} from './pairing'

/** A device asking to join, as listed to the PC that is already paired. */
export interface PendingRequest {
  deviceId: string
  deviceName: string
  /** The six-digit code both PCs show. */
  code: string
}

/** Asks to join the personal share (B's side); see pairing.ts. */
export function requestPairing(
  db: Database.Database,
  spaceFolder: string,
  deviceName: string,
  openTransport: OpenTransport = openFolderTransport
): Promise<string> {
  return requestPairingIn(db, spaceFolder, deviceName, openTransport)
}

/** The code a joining PC shows for its own request; see pairing.ts. */
export function pairingCodeInSpace(
  db: Database.Database,
  spaceFolder: string,
  openTransport: OpenTransport = openFolderTransport
): Promise<string | null> {
  return pairingCodeInSpaceIn(db, spaceFolder, openTransport)
}

/** B's side once A has allowed it; see pairing.ts. */
export function completePairing(
  db: Database.Database,
  spaceFolder: string,
  openTransport: OpenTransport = openFolderTransport
): Promise<'waiting' | 'paired'> {
  return completePairingIn(db, spaceFolder, openTransport)
}

/** A device of this person, as the settings show it. */
export interface PersonalDevice {
  deviceId: string
  name: string
  isThisDevice: boolean
  revoked: boolean
}

/**
 * The folder that holds `Personal/` and `devices/` for a space. In Google Drive the root already
 * is Ostler's own folder, so it is the space itself.
 */
export function spaceFolderUnder(root: string): string {
  return isDriveLocation(root) ? root : path.join(root, SPACE_FOLDER)
}

/**
 * The space folder (`…/Ostler`) that holds a personal share, found under the synced roots:
 * a breadth-first search like the one that finds a joined project's folder
 * (share-folder-finder.ts). Null when there is none. Synchronous: it only lists folders.
 */
export function findPersonalSpace(
  roots: readonly string[],
  fsImpl: FinderFs = fs,
  limits = { maxDepth: 5, maxFolders: 5000 }
): string | null {
  const queue = roots.map((folder) => ({ folder, depth: 0 }))
  for (let index = 0; index < queue.length && index < limits.maxFolders; index++) {
    const { folder, depth } = queue[index]
    if (
      path.basename(folder) === SPACE_FOLDER &&
      fsImpl.existsSync(path.join(folder, PERSONAL_FOLDER, 'share.json'))
    ) {
      return folder
    }
    if (depth >= limits.maxDepth) continue
    let entries: fs.Dirent[]
    try {
      entries = fsImpl.readdirSync(folder, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue
      queue.push({ folder: path.join(folder, entry.name), depth: depth + 1 })
    }
  }
  return null
}

/** What a folder the person chose holds: a personal space, one made by a newer Ostler, or none. */
export type SpaceInFolder = { kind: 'found'; folder: string } | { kind: 'newer' } | { kind: 'none' }

/**
 * The personal space in a folder the person chose: the space's own folder (whatever it is called),
 * its `Personal` folder, or a folder it is somewhere below. A space whose `share.json` has a
 * newer format version is `newer`, so the person is asked to update rather than told it's missing.
 */
export function personalSpaceIn(chosen: string, fsImpl: FinderFs = fs): SpaceInFolder {
  const holds = (folder: string) =>
    fsImpl.existsSync(path.join(folder, PERSONAL_FOLDER, 'share.json'))
  let space: string | null
  if (holds(chosen)) space = chosen
  else if (path.basename(chosen) === PERSONAL_FOLDER && holds(path.dirname(chosen))) {
    space = path.dirname(chosen)
  } else space = findPersonalSpace([chosen], fsImpl)
  if (!space) return { kind: 'none' }
  try {
    const text = fsImpl.readFileSync(path.join(space, PERSONAL_FOLDER, 'share.json'), 'utf8')
    const { formatVersion } = JSON.parse(text) as { formatVersion?: unknown }
    if (typeof formatVersion === 'number' && formatVersion > SHARE_FORMAT_VERSION) {
      return { kind: 'newer' }
    }
  } catch {
    // Not readable yet (still syncing): pairing reads it again and reports what it finds.
  }
  return { kind: 'found', folder: space }
}

/**
 * Moves the own folders (`Personal/`, `devices/`) of the personal space in the folder `space` into
 * a new "Old personal space …" folder inside it, so a new space can start there; the sync app
 * carries the move to the other devices. Nothing is deleted. Returns that folder's name.
 * Google Drive spaces go through `DriveSyncSettings.setAsideSpace`.
 */
export function setAsideFolderSpace(space: string, now: Date, fsImpl: typeof fs = fs): string {
  const name = oldSpaceFolderName(now, new Set(fsImpl.readdirSync(space)))
  const own = SPACE_OWN_FOLDERS.filter((folder) => fsImpl.existsSync(path.join(space, folder)))
  if (own.length === 0) return name
  fsImpl.mkdirSync(path.join(space, name))
  for (const folder of own) {
    fsImpl.renameSync(path.join(space, folder), path.join(space, name, folder))
  }
  return name
}

/**
 * Makes this PC's personal share in `root`: a new person key if there is none, the share
 * with its key, this PC's member file and a first snapshot. Returns the space folder.
 */
export function createPersonalSpace(
  db: Database.Database,
  root: string,
  deviceName: string,
  openTransport: OpenTransport = openFolderTransport
): Promise<string> {
  return createPersonalSpaceAt(db, spaceFolderUnder(root), deviceName, openTransport)
}

/** As `createPersonalSpace`, in the space folder itself (one whose old space was set aside). */
export async function createPersonalSpaceAt(
  db: Database.Database,
  space: string,
  deviceName: string,
  openTransport: OpenTransport = openFolderTransport
): Promise<string> {
  if (personalShareOf(db)) throw new PersonalSpaceError('already-personal')
  const name = checkedName(deviceName)
  const personal = joinPlace(space, PERSONAL_FOLDER)
  const transport = openTransport(personal)
  if ((await transport.list('')).includes('share.json')) {
    throw new PersonalSpaceError('wrong-folder')
  }

  const identity = identityKeys(db)
  personKeys(db)
  const shareId = randomUUID()
  const memberId = randomUUID()
  const projectKey = newProjectKey()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at, kind)
       VALUES (@projectId, @shareId, @folder, @memberId, @deviceId, @formatVersion, @createdAt, 'personal')`
    ).run({
      projectId: PERSONAL_PROJECT_ID,
      shareId,
      folder: personal,
      memberId,
      deviceId: newDeviceId(),
      formatVersion: SHARE_FORMAT_VERSION,
      createdAt: Date.now()
    })
    storeProjectKey(db, PERSONAL_PROJECT_ID, projectKey, 0)
  })()
  await transport.writeOnce(
    'share.json',
    Buffer.from(
      JSON.stringify({
        formatVersion: SHARE_FORMAT_VERSION,
        shareId,
        projectId: PERSONAL_PROJECT_ID
      }),
      'utf8'
    )
  )
  const invite: Invite = {
    shareId,
    projectId: PERSONAL_PROJECT_ID,
    projectKey,
    generation: 0,
    previousKeys: []
  }
  await writeMember(db, transport, invite, memberId, name, null)
  await writeSnapshot(db, transport, PERSONAL_PROJECT_ID, {
    projectKey,
    privateKey: identity.privateKey
  })
  // This device's own certificate: a PC that joins reads the person key from it (pairingCodeInSpace).
  await writeIfMissing(
    devicesFolder(space, openTransport),
    `${pairingDeviceId(identity.publicKey)}.ostlerdevice`,
    Buffer.from(JSON.stringify(thisDeviceCertificate(db, name)), 'utf8')
  )
  return space
}

/**
 * The requests this PC (already paired) has not answered yet, with their codes. A request
 * that already has a certificate is not listed, and one whose signature or file name does
 * not check is ignored.
 */
export async function pendingRequests(
  db: Database.Database,
  spaceFolder: string,
  openTransport: OpenTransport = openFolderTransport
): Promise<PendingRequest[]> {
  const devices = devicesFolder(spaceFolder, openTransport)
  const person = personKeys(db).publicKey
  const pending: PendingRequest[] = []
  for (const relativePath of await devices.list('requests')) {
    const match = REQUEST_PATTERN.exec(relativePath)
    if (!match) continue
    const request = await readRequest(devices, match[1])
    if (!request) continue
    if (await isCertified(devices, match[1])) continue
    pending.push({
      deviceId: match[1],
      deviceName: request.deviceName,
      code: pairingCode(request.devicePublicKey, person)
    })
  }
  return pending
}

/**
 * Allows a requesting device (A's side): writes its certificate, then the keys file wrapped
 * to its box key. Writing either again is harmless, so a retry finishes a half-done allow.
 */
export async function allowDevice(
  db: Database.Database,
  spaceFolder: string,
  deviceId: string,
  openTransport: OpenTransport = openFolderTransport
): Promise<void> {
  const personal = personalShareOf(db)
  if (!personal) throw new PersonalSpaceError('no-personal-space')
  const devices = devicesFolder(spaceFolder, openTransport)
  const request = DEVICE_ID_PATTERN.test(deviceId) ? await readRequest(devices, deviceId) : null
  if (!request) throw new PersonalSpaceError('no-such-request')

  const person = personKeys(db)
  const certificate = certifyDevice(person, {
    publicKey: request.devicePublicKey,
    boxPublicKey: request.deviceBoxPublicKey,
    name: request.deviceName
  })
  await writeIfMissing(
    devices,
    `${deviceId}.ostlerdevice`,
    Buffer.from(JSON.stringify(certificate), 'utf8')
  )

  const generation = keyGenerationOf(db, PERSONAL_PROJECT_ID)
  const keyring = projectKeyring(db, PERSONAL_PROJECT_ID)
  const projectKeys: string[] = []
  for (let older = 0; older <= generation; older++) {
    const key = keyring(older)
    if (!key) throw new PersonalSpaceError('no-key')
    projectKeys.push(key.toString('base64'))
  }
  const me = db
    .prepare('SELECT id AS personId, name, initials, color FROM people WHERE is_me = 1')
    .get() as MePerson | undefined
  const payload: KeysPayload = {
    personPrivateKey: person.privateKey,
    personPublicKey: person.publicKey,
    shareId: personal.share_id,
    generation,
    projectKeys,
    me: me ?? null
  }
  const wrapped = wrapForBoxKey(
    Buffer.from(JSON.stringify(payload), 'utf8'),
    request.deviceBoxPublicKey,
    pairingContext(deviceId)
  )
  await writeIfMissing(devices, `${deviceId}.ostlerkeys`, wrapped)
}

/**
 * Removes one of this person's devices (D20): its member goes from the personal share and
 * from every project share it is in, then the revocation is written, signed by the person
 * key. `openTransport` opens a project share's folder (the service passes its own).
 */
export async function removeDevice(
  db: Database.Database,
  spaceFolder: string,
  deviceId: string,
  openTransport: OpenTransport = openFolderTransport
): Promise<void> {
  const personal = personalShareOf(db)
  if (!personal) throw new PersonalSpaceError('no-personal-space')
  if (!DEVICE_ID_PATTERN.test(deviceId)) throw new PersonalSpaceError('no-such-device')
  const devices = devicesFolder(spaceFolder, openTransport)
  const certificate = await readCertificate(devices, deviceId)
  const person = personKeys(db)
  if (!certificate || certificate.personPublicKey !== person.publicKey) {
    throw new PersonalSpaceError('no-such-device')
  }
  if (certificate.devicePublicKey === identityKeys(db).publicKey) {
    throw new PersonalSpaceError('this-device')
  }

  const memberships = db
    .prepare(
      `SELECT s.project_id, s.folder, s.kind, m.member_id
       FROM sync_members m JOIN sync_shares s ON s.share_id = m.share_id
       WHERE m.public_key = @devicePublicKey AND m.removed_at IS NULL`
    )
    .all({ devicePublicKey: certificate.devicePublicKey }) as {
    project_id: string
    folder: string
    kind: 'project' | 'personal'
    member_id: string
  }[]
  for (const row of memberships) {
    await removeMember(db, openTransport(row.folder), row.project_id, row.member_id)
  }

  const revocation = {
    v: 1,
    deviceId,
    devicePublicKey: certificate.devicePublicKey,
    revokedAt: Date.now()
  }
  await writeIfMissing(devices, `${deviceId}.ostlerrevoked`, signedJson(revocation, person))
}

/**
 * Marks as removed every personal member whose device a revocation file names (signed by
 * this person's key). Runs on each pull of the personal share; a revocation for a device
 * this PC can't check is ignored.
 */
export async function applyRevocations(
  db: Database.Database,
  spaceFolder: string,
  openTransport: OpenTransport = openFolderTransport
): Promise<number> {
  const personal = personalShareOf(db)
  if (!personal) return 0
  const devices = devicesFolder(spaceFolder, openTransport)
  const person = personKeys(db).publicKey
  let applied = 0
  for (const relativePath of await devices.list('')) {
    if (!relativePath.endsWith('.ostlerrevoked')) continue
    let body: { devicePublicKey?: unknown }
    try {
      body = openSignedJson(await devices.read(relativePath), person)
    } catch {
      continue
    }
    if (typeof body.devicePublicKey !== 'string') continue
    applied += db
      .prepare(
        `UPDATE sync_members SET removed_at = @now
         WHERE share_id = @shareId AND public_key = @devicePublicKey AND removed_at IS NULL`
      )
      .run({
        now: Date.now(),
        shareId: personal.share_id,
        devicePublicKey: body.devicePublicKey
      }).changes
  }
  return applied
}

/**
 * This person's devices as the personal share knows them: each with its id, its name, whether
 * it is this PC, and whether it has been removed. Reads the database only.
 */
export function devicesOf(db: Database.Database): PersonalDevice[] {
  const rows = db
    .prepare(
      `SELECT m.member_id, m.name, m.public_key, m.removed_at, s.member_id AS this_member
       FROM sync_members m JOIN sync_shares s ON s.share_id = m.share_id
       WHERE s.kind = 'personal' ORDER BY m.joined_at, m.name`
    )
    .all() as {
    member_id: string
    name: string
    public_key: string
    removed_at: number | null
    this_member: string
  }[]
  return rows.map((row) => ({
    deviceId: pairingDeviceId(row.public_key),
    name: row.name,
    isThisDevice: row.member_id === row.this_member,
    revoked: row.removed_at !== null
  }))
}

// ─── Helpers ────────────────────────────────────────────────────────────
