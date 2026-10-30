/**
 * The new device's half of pairing, and the helpers both halves share (people-and-devices
 * D16). Core file: the phone reuses it, so it imports nothing from Node or Electron except
 * through `./platform`. `personal-space.ts` (desktop) re-exports everything here and adds
 * the folder search, creating a space, allowing a device and removing one.
 */
import { createPrivateKey, createPublicKey, createHash, randomUUID, sign, verify } from './platform'
import type Database from 'better-sqlite3'
import { newDeviceId } from '@shared/sync/clock'
import { quote, tableShape } from '../change-history/table-shape'
import { withSyncApplying } from './capture'
import type { IdentityKeys } from './change-file'
import type { SyncTransport } from './folder-transport'
import { SyncTransportError } from './transport-paths'
import { openEnvelope, type EnvelopeKind, type SyncFileRefusal } from './envelope'
import { unwrapWithBoxKey, refreshKeys } from './rotation'
import {
  joinPlace,
  parseInvite,
  readShareFile,
  refreshMembers,
  SHARE_FORMAT_VERSION,
  writeMember,
  type Invite,
  type MePerson
} from './sharing'
import { loadSnapshot, readSnapshotFile, snapshotsNewestFirst } from './snapshots'
import { PERSON_COLUMN } from './records'
import { PERSONAL_PROJECT_ID, PERSONAL_TABLES, SYNCED_TABLES } from './synced-tables'
import {
  boxKeys,
  deviceIdOf,
  identityKeys,
  projectKeyring,
  storePersonKeys,
  storeProjectKey,
  verifyDeviceCertificate,
  type DeviceCertificate
} from './sync-keys'

/** The folder of the personal space, under the root the person picks. */
export const SPACE_FOLDER = 'Ostler'
/** The personal share's folder inside the space. */
export const PERSONAL_FOLDER = 'Personal'
/** The folder for pairing and revocation files, next to the personal share. */
export const DEVICES_FOLDER = 'devices'
/** A space's own folders: the ones a space set aside is moved out of, so a new one can start there. */
export const SPACE_OWN_FOLDERS = [PERSONAL_FOLDER, DEVICES_FOLDER] as const

/**
 * The folder, inside the space, that an old personal space's own folders are moved into when this
 * device starts a new one in its place: "Old personal space 2026-10-29", then "… (2)" when taken.
 */
export function oldSpaceFolderName(now: Date, taken: ReadonlySet<string>): string {
  const base = `Old personal space ${now.toISOString().slice(0, 10)}`
  const lower = new Set([...taken].map((name) => name.toLowerCase()))
  let name = base
  for (let n = 2; lower.has(name.toLowerCase()); n += 1) name = `${base} (${n})`
  return name
}

export const REQUEST_MAGIC = Buffer.from('OSTLERDR', 'ascii')
export const REQUEST_VERSION = 1
export const REQUEST_PATTERN = /^requests\/([0-9a-f]{32})\.ostlerrequest$/
export const DEVICE_ID_PATTERN = /^[0-9a-f]{32}$/
export const DEVICE_NAME_MAX_LENGTH = 100
export const ED25519_SIGNATURE_BYTES = 64

export class PersonalSpaceError extends Error {
  constructor(
    readonly reason:
      | 'already-personal'
      | 'no-personal-space'
      | 'wrong-folder'
      | 'bad-name'
      | 'no-such-request'
      | 'no-such-device'
      | 'this-device'
      | 'bad-keys'
      | 'no-key'
  ) {
    super(`Personal space refused: ${reason}`)
    this.name = 'PersonalSpaceError'
  }
}

export interface PersonalShareRow {
  share_id: string
  member_id: string
  folder: string
}

export interface RequestBody {
  devicePublicKey: string
  deviceBoxPublicKey: string
  deviceName: string
  createdAt: number
}

/**
 * Opens the transport for a place: a folder on this PC or a Drive place (the service passes its
 * own; without one, a place is a folder).
 */
export type OpenTransport = (place: string) => SyncTransport

/**
 * The six-digit code for a pairing: SHA-256 of the device's public key and the person's,
 * the first 20 bits as a number, taken modulo 10^6 and zero-padded to six digits. Both PCs
 * compute it from the same two keys, so the person can check it matches on both screens.
 */
export function pairingCode(devicePublicKey: string, personPublicKey: string): string {
  const digest = createHash('sha256')
    .update(Buffer.from(devicePublicKey, 'base64'))
    .update(Buffer.from(personPublicKey, 'base64'))
    .digest()
  const twentyBits = (digest[0] << 12) | (digest[1] << 4) | (digest[2] >> 4)
  return String(twentyBits % 1_000_000).padStart(6, '0')
}

/** The `<id>` of a device's files: the first 32 hex digits of SHA-256 of its identity public key. */
export const pairingDeviceId = deviceIdOf

/**
 * Asks to join the personal share from the space in `spaceFolder` (B's side). Writes the
 * request, signed by the device key and not encrypted. Returns the device id it is filed
 * under. Writing it again is harmless.
 */
export async function requestPairing(
  db: Database.Database,
  spaceFolder: string,
  deviceName: string,
  openTransport: OpenTransport
): Promise<string> {
  if (personalShareOf(db)) throw new PersonalSpaceError('already-personal')
  const name = checkedName(deviceName)
  const identity = identityKeys(db)
  const body: RequestBody = {
    devicePublicKey: identity.publicKey,
    deviceBoxPublicKey: boxKeys(db).publicKey,
    deviceName: name,
    createdAt: Date.now()
  }
  const deviceId = pairingDeviceId(identity.publicKey)
  await writeIfMissing(
    devicesFolder(spaceFolder, openTransport),
    `requests/${deviceId}.ostlerrequest`,
    signedRequest(Buffer.from(JSON.stringify(body), 'utf8'), identity)
  )
  return deviceId
}

/**
 * The code a joining PC shows for its own request. It takes the person key from a
 * certificate already in the space (any device of the person wrote one) and checks it, so it
 * matches the code the paired PC shows. Null when the space holds no valid certificate yet.
 */
export async function pairingCodeInSpace(
  db: Database.Database,
  spaceFolder: string,
  openTransport: OpenTransport
): Promise<string | null> {
  const devices = devicesFolder(spaceFolder, openTransport)
  for (const relativePath of await devices.list('')) {
    if (!relativePath.endsWith('.ostlerdevice')) continue
    const certificate = await readCertificateFile(devices, relativePath)
    if (certificate) {
      return pairingCode(identityKeys(db).publicKey, certificate.personPublicKey)
    }
  }
  return null
}

/**
 * B's side, once A has allowed it: reads its keys file, checks it against the certificate
 * from the person's key, stores the person key as paired, joins the personal share as a new
 * member and loads its newest snapshot. Returns `'waiting'` until the keys file is there.
 */
export async function completePairing(
  db: Database.Database,
  spaceFolder: string,
  openTransport: OpenTransport
): Promise<'waiting' | 'paired'> {
  if (personalShareOf(db)) return 'paired'
  const identity = identityKeys(db)
  const box = boxKeys(db)
  const deviceId = pairingDeviceId(identity.publicKey)
  const devices = devicesFolder(spaceFolder, openTransport)
  const wrapped = await readOrNull(devices, `${deviceId}.ostlerkeys`)
  if (!wrapped) return 'waiting'

  const certificate = await readCertificate(devices, deviceId)
  if (
    !certificate ||
    certificate.devicePublicKey !== identity.publicKey ||
    certificate.deviceBoxPublicKey !== box.publicKey
  ) {
    throw new PersonalSpaceError('bad-keys')
  }
  const opened = unwrapWithBoxKey(wrapped, box.privateKey, pairingContext(deviceId))
  const payload = opened ? parseKeysPayload(opened) : null
  if (!payload || payload.personPublicKey !== certificate.personPublicKey) {
    throw new PersonalSpaceError('bad-keys')
  }

  const personFolder = joinPlace(spaceFolder, PERSONAL_FOLDER)
  const personalTransport = openTransport(personFolder)
  // The share file must be the one the keys were made for.
  const share = await readShareFile(personalTransport).catch(() => null)
  if (!share || share.shareId !== payload.shareId || share.projectId !== PERSONAL_PROJECT_ID) {
    throw new PersonalSpaceError('wrong-folder')
  }

  const memberId = randomUUID()
  const keys = payload.projectKeys.map((key) => Buffer.from(key, 'base64'))
  db.transaction(() => {
    storePersonKeys(
      db,
      { publicKey: payload.personPublicKey, privateKey: payload.personPrivateKey },
      'paired'
    )
    // Rotations are read from the first one, so a removal made before this PC joined is known.
    db.prepare(
      `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at, kind)
       VALUES (@projectId, @shareId, @folder, @memberId, @deviceId, @formatVersion, @createdAt, 'personal')`
    ).run({
      projectId: PERSONAL_PROJECT_ID,
      shareId: payload.shareId,
      folder: personFolder,
      memberId,
      deviceId: newDeviceId(),
      formatVersion: SHARE_FORMAT_VERSION,
      createdAt: Date.now()
    })
    keys.forEach((key, generation) => storeProjectKey(db, PERSONAL_PROJECT_ID, key, generation))
  })()

  const invite: Invite = {
    shareId: payload.shareId,
    projectId: PERSONAL_PROJECT_ID,
    projectKey: keys[keys.length - 1],
    generation: payload.generation,
    previousKeys: keys.slice(0, -1)
  }
  // Before any member file is written, so each one this device writes names the person's one Me.
  if (payload.me) adoptMe(db, payload.me)
  await writeMember(db, personalTransport, invite, memberId, certificate.deviceName, null)
  await refreshKeys(db, personalTransport, PERSONAL_PROJECT_ID)
  const keyring = projectKeyring(db, PERSONAL_PROJECT_ID)
  await refreshMembers(db, personalTransport, payload.shareId, keyring)
  for (const snapshotPath of await snapshotsNewestFirst(personalTransport)) {
    try {
      const snapshot = await readSnapshotFile(
        db,
        personalTransport,
        payload.shareId,
        snapshotPath,
        keyring
      )
      loadSnapshot(db, PERSONAL_PROJECT_ID, snapshot)
      break
    } catch {
      continue
    }
  }
  return 'paired'
}

export function personalShareOf(db: Database.Database): PersonalShareRow | null {
  return (
    (db
      .prepare(
        `SELECT share_id, member_id, folder FROM sync_shares
         WHERE project_id = @projectId AND kind = 'personal'`
      )
      .get({ projectId: PERSONAL_PROJECT_ID }) as PersonalShareRow | undefined) ?? null
  )
}

export function devicesFolder(spaceFolder: string, openTransport: OpenTransport): SyncTransport {
  return openTransport(joinPlace(spaceFolder, DEVICES_FOLDER))
}

export function pairingContext(deviceId: string): string {
  return `ostler-pairing:${deviceId}`
}

export function checkedName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > DEVICE_NAME_MAX_LENGTH) throw new PersonalSpaceError('bad-name')
  return trimmed
}

/** A request file: magic, version, length, the JSON body, then the device key's signature over all of it. */
export function signedRequest(body: Buffer, identity: IdentityKeys): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  const unsigned = Buffer.concat([REQUEST_MAGIC, Buffer.from([REQUEST_VERSION]), length, body])
  return Buffer.concat([unsigned, sign(null, unsigned, privateKeyOf(identity.privateKey))])
}

/** The body of a request whose signature checks against the device key it names; else null. */
export async function readRequest(
  devices: SyncTransport,
  deviceId: string
): Promise<RequestBody | null> {
  const bytes = await readOrNull(devices, `requests/${deviceId}.ostlerrequest`)
  if (!bytes || bytes.length < REQUEST_MAGIC.length + 5 + ED25519_SIGNATURE_BYTES) return null
  try {
    if (!bytes.subarray(0, REQUEST_MAGIC.length).equals(REQUEST_MAGIC)) return null
    if (bytes[REQUEST_MAGIC.length] !== REQUEST_VERSION) return null
    const bodyEnd = REQUEST_MAGIC.length + 5 + bytes.readUInt32BE(REQUEST_MAGIC.length + 1)
    if (bodyEnd + ED25519_SIGNATURE_BYTES !== bytes.length) return null
    const body = JSON.parse(
      bytes.subarray(REQUEST_MAGIC.length + 5, bodyEnd).toString('utf8')
    ) as Partial<RequestBody>
    if (
      typeof body.devicePublicKey !== 'string' ||
      typeof body.deviceBoxPublicKey !== 'string' ||
      typeof body.deviceName !== 'string' ||
      body.deviceName.length > DEVICE_NAME_MAX_LENGTH ||
      typeof body.createdAt !== 'number'
    ) {
      return null
    }
    if (pairingDeviceId(body.devicePublicKey) !== deviceId) return null
    const valid = verify(
      null,
      bytes.subarray(0, bodyEnd),
      publicKeyOf(body.devicePublicKey),
      bytes.subarray(bodyEnd)
    )
    return valid ? (body as RequestBody) : null
  } catch {
    return null
  }
}

export async function isCertified(devices: SyncTransport, deviceId: string): Promise<boolean> {
  return (await readOrNull(devices, `${deviceId}.ostlerdevice`)) !== null
}

export async function readCertificate(
  devices: SyncTransport,
  deviceId: string
): Promise<DeviceCertificate | null> {
  return readCertificateFile(devices, `${deviceId}.ostlerdevice`)
}

/** A certificate file, when it is a valid certificate (signed by its own person key); else null. */
export async function readCertificateFile(
  devices: SyncTransport,
  relativePath: string
): Promise<DeviceCertificate | null> {
  const bytes = await readOrNull(devices, relativePath)
  if (!bytes) return null
  try {
    return verifyDeviceCertificate(JSON.parse(bytes.toString('utf8')))
  } catch {
    return null
  }
}

/**
 * Makes `me` this PC's Me person (F4 of the people-and-devices sign-off): adds its row if
 * missing, points every person column of the synced and personal tables from the old Me
 * to it, and archives the old Me. The rewrites are captured, so the person's other devices
 * and the people they share with see the one Me; rows of a project where this PC is a
 * Viewer are rewritten here only (its guard refuses them as local edits). A fresh device
 * has nothing to rewrite.
 */
export function adoptMe(db: Database.Database, me: MePerson): void {
  const old = db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
    { id: string } | undefined
  if (old?.id === me.personId) return
  const now = Date.now()
  db.transaction(() => {
    withSyncApplying(() => {
      db.prepare(
        `INSERT INTO people (id, name, initials, color, is_me, archived_at, created_at, updated_at)
         VALUES (@personId, @name, @initials, @color, 0, NULL, @now, @now)
         ON CONFLICT(id) DO NOTHING`
      ).run({ ...me, now })
    })
    if (old) {
      for (const [table, entry] of Object.entries(SYNCED_TABLES)) {
        const shape = tableShape(db, table)
        if (!shape) continue
        const project =
          'column' in entry.project
            ? quote(entry.project.column)
            : `(SELECT v.project_id FROM ${quote(entry.project.via.table)} AS v
                WHERE v.id = ${quote(table)}.${quote(entry.project.via.column)})`
        for (const column of shape.columns.filter((name) => PERSON_COLUMN.test(name))) {
          db.prepare(
            `UPDATE ${quote(table)} SET ${quote(column)} = @to
             WHERE ${quote(column)} = @from
               AND ${project} NOT IN (SELECT project_id FROM sync_shares WHERE my_role IN ('viewer', 'contributor'))`
          ).run({ from: old.id, to: me.personId })
          withSyncApplying(() =>
            db
              .prepare(
                `UPDATE ${quote(table)} SET ${quote(column)} = @to WHERE ${quote(column)} = @from`
              )
              .run({ from: old.id, to: me.personId })
          )
        }
      }
      for (const table of Object.keys(PERSONAL_TABLES)) {
        const shape = tableShape(db, table)
        if (!shape) continue
        for (const column of shape.columns.filter((name) => PERSON_COLUMN.test(name))) {
          db.prepare(
            `UPDATE ${quote(table)} SET ${quote(column)} = @to WHERE ${quote(column)} = @from`
          ).run({ from: old.id, to: me.personId })
        }
      }
    }
    // The Me row never travels (synced-tables.ts), so neither change is captured.
    withSyncApplying(() => {
      if (old) {
        db.prepare(
          'UPDATE people SET is_me = 0, archived_at = @now, updated_at = @now WHERE id = @id'
        ).run({ id: old.id, now })
      }
      db.prepare('UPDATE people SET is_me = 1, archived_at = NULL WHERE id = @id').run({
        id: me.personId
      })
    })
  })()
}

/** What A puts in a device's keys file, before it is wrapped to the device's box key. */
export interface KeysPayload {
  personPrivateKey: string
  personPublicKey: string
  shareId: string
  /** The personal share's current key generation; `projectKeys` holds 0 to this. */
  generation: number
  projectKeys: string[]
  /** A's Me person, which B takes as its own; absent from a keys file made before 2026-10-25. */
  me?: MePerson | null
}

export function parseKeysPayload(bytes: Buffer): KeysPayload | null {
  try {
    const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
    if (
      typeof value.personPrivateKey !== 'string' ||
      typeof value.personPublicKey !== 'string' ||
      typeof value.shareId !== 'string' ||
      typeof value.generation !== 'number' ||
      !Number.isSafeInteger(value.generation) ||
      value.generation < 0 ||
      !Array.isArray(value.projectKeys) ||
      value.projectKeys.length !== value.generation + 1 ||
      !value.projectKeys.every((key) => typeof key === 'string')
    ) {
      return null
    }
    const me = value.me as Record<string, unknown> | null | undefined
    const meFits =
      me === undefined ||
      me === null ||
      (typeof me === 'object' &&
        ['personId', 'name', 'initials', 'color'].every((field) => typeof me[field] === 'string'))
    if (!meFits) return null
    return value as unknown as KeysPayload
  } catch {
    return null
  }
}

/** A JSON body and its person-key signature, both base64, in one file. */
export function signedJson(body: Record<string, unknown>, person: IdentityKeys): Buffer {
  const json = Buffer.from(JSON.stringify(body), 'utf8')
  const signature = sign(null, json, privateKeyOf(person.privateKey))
  return Buffer.from(
    JSON.stringify({ body: json.toString('base64'), signature: signature.toString('base64') }),
    'utf8'
  )
}

export function openSignedJson(bytes: Buffer, personPublicKey: string): Record<string, unknown> {
  const { body, signature } = JSON.parse(bytes.toString('utf8')) as {
    body: string
    signature: string
  }
  const json = Buffer.from(body, 'base64')
  if (!verify(null, json, publicKeyOf(personPublicKey), Buffer.from(signature, 'base64'))) {
    throw new PersonalSpaceError('bad-keys')
  }
  return JSON.parse(json.toString('utf8')) as Record<string, unknown>
}

export function privateKeyOf(base64: string) {
  return createPrivateKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'pkcs8' })
}

export function publicKeyOf(base64: string) {
  return createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' })
}

export async function readOrNull(
  transport: SyncTransport,
  relativePath: string
): Promise<Buffer | null> {
  try {
    return await transport.read(relativePath)
  } catch {
    return null
  }
}

/** Writes a file unless it is already there; a file already there is left as it is. */
export async function writeIfMissing(
  transport: SyncTransport,
  relativePath: string,
  bytes: Buffer
): Promise<void> {
  try {
    await transport.writeOnce(relativePath, bytes)
  } catch (error) {
    if (!(error instanceof SyncTransportError && error.reason === 'exists')) throw error
  }
}

// ─── The personal share's project entries (every project on every device) ───

/** The folder of the personal share's entries. */
export const SHARES_FOLDER = 'shares'

const ENTRY_PATTERN = /^shares\/([A-Za-z0-9-]+)\/([^/]+)\.ostlershare$/

export class ShareEntryError extends Error {
  constructor(readonly reason: SyncFileRefusal) {
    super(`Share entry refused: ${reason}`)
    this.name = 'ShareEntryError'
  }
}

export const SHARE_ENTRY_FILE: EnvelopeKind = {
  magic: Buffer.from('OSTLERSH', 'ascii'),
  version: 1,
  maxBytes: 256 * 1024,
  refuse: (reason) => {
    throw new ShareEntryError(reason)
  }
}

/** One project's entry, as the newest file for it says. */
export interface ShareEntry {
  projectId: string
  /** The invite the project's share is joined with (a secret; never shown or logged). */
  invite: string
  /** The folder relative to the synced root that holds the space, with `/` separators; null when none. */
  folderRelativeToRoot: string | null
  /** The sync server address the share is kept on; null for a folder. */
  location: string | null
  addedAt: number
  /** The person deleted the project or left its share: the other devices leave it and keep their copy. */
  removed: boolean
}

export interface ShareEntryProblem {
  path: string
  reason: string
}

export interface EntryHeader {
  shareId: string
  memberId: string
  projectId: string
  stamp: string
}

/**
 * Reads every entry in the personal share, keeping the newest per project. Entries whose seal does
 * not check, or whose writer is not a current device of this person, are reported and skipped.
 */
export async function readShareEntries(
  db: Database.Database,
  transport: SyncTransport
): Promise<{ entries: ShareEntry[]; problems: ShareEntryProblem[] }> {
  const personal = personalShareRow(db)
  const newest = new Map<string, { stamp: string; entry: ShareEntry }>()
  const problems: ShareEntryProblem[] = []
  if (!personal) return { entries: [], problems }
  const members = db.prepare(
    `SELECT public_key FROM sync_members
     WHERE share_id = @shareId AND member_id = @memberId AND removed_at IS NULL`
  )
  for (const relativePath of await transport.list(SHARES_FOLDER)) {
    const match = ENTRY_PATTERN.exec(relativePath)
    if (!match) continue
    try {
      const { header, payload } = openEnvelope(
        SHARE_ENTRY_FILE,
        await transport.read(relativePath),
        {
          projectKey: projectKeyring(db, PERSONAL_PROJECT_ID),
          publicKeyFor: (memberId) =>
            (
              members.get({ shareId: personal.share_id, memberId }) as
                { public_key: string } | undefined
            )?.public_key ?? null
        },
        parseEntryHeader
      )
      if (
        header.shareId !== personal.share_id ||
        header.projectId !== match[1] ||
        header.stamp !== match[2]
      ) {
        problems.push({ path: relativePath, reason: 'mismatch' })
        continue
      }
      const entry = entryOf(payload)
      if (!entry || entry.projectId !== match[1]) {
        problems.push({ path: relativePath, reason: 'not-a-change-file' })
        continue
      }
      const known = newest.get(entry.projectId)
      if (!known || header.stamp > known.stamp)
        newest.set(entry.projectId, { stamp: header.stamp, entry })
    } catch (error) {
      problems.push({
        path: relativePath,
        reason: error instanceof ShareEntryError ? error.reason : 'unreadable'
      })
    }
  }
  return { entries: [...newest.values()].map((value) => value.entry), problems }
}

/** The shareId an invite names, or null when the text is not an invite. */
export function inviteShareId(invite: string): string | null {
  try {
    return parseInvite(invite).shareId
  } catch {
    return null
  }
}

export function personalShareRow(
  db: Database.Database
): { share_id: string; member_id: string; device_id: string } | null {
  return (
    (db
      .prepare("SELECT share_id, member_id, device_id FROM sync_shares WHERE kind = 'personal'")
      .get() as { share_id: string; member_id: string; device_id: string } | undefined) ?? null
  )
}

export function parseEntryHeader(header: Record<string, unknown>): EntryHeader {
  if (
    header.formatVersion !== 1 ||
    typeof header.shareId !== 'string' ||
    typeof header.memberId !== 'string' ||
    typeof header.projectId !== 'string' ||
    typeof header.stamp !== 'string'
  ) {
    throw new ShareEntryError('not-a-change-file')
  }
  return {
    shareId: header.shareId,
    memberId: header.memberId,
    projectId: header.projectId,
    stamp: header.stamp
  }
}

/** The entry in a payload, when every field has its type; else null. */
export function entryOf(value: unknown): ShareEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Record<string, unknown>
  if (
    typeof entry.projectId !== 'string' ||
    typeof entry.invite !== 'string' ||
    (entry.folderRelativeToRoot !== null && typeof entry.folderRelativeToRoot !== 'string') ||
    (entry.location !== null && typeof entry.location !== 'string') ||
    typeof entry.addedAt !== 'number' ||
    typeof entry.removed !== 'boolean'
  ) {
    return null
  }
  return {
    projectId: entry.projectId,
    invite: entry.invite,
    folderRelativeToRoot: entry.folderRelativeToRoot as string | null,
    location: entry.location as string | null,
    addedAt: entry.addedAt,
    removed: entry.removed
  }
}
