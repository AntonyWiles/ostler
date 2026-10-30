/**
 * Removing someone from a shared project (docs/plans/integrations/shared-folder-sync.md,
 * decision 4, S7d). They keep what they already have; everything after uses a
 * new project key they never get.
 *
 * Removing writes `keys/<generation>.ostlerrotation`, a sealed envelope
 * (envelope.ts) encrypted with the key being replaced and signed by the member
 * who removed. Its header names that member and their public key; its payload
 * holds the member removed, how far each device's change files had been applied
 * (their files up to there still count), every remaining member, and the new key
 * encrypted to each remaining member's X25519 key (ephemeral X25519, HKDF-SHA256,
 * AES-256-GCM). The file is written once, so two PCs removing at the same time
 * can't both make the same generation: the second reads the first and tries the
 * next one.
 *
 * Every PC reads the key changes in order before it reads anything else
 * (`refreshKeys`): it learns the new key, marks the member removed, and adds
 * the remaining members, so a PC that joins later knows the members from
 * before the change.
 *
 * "Stop old invites" is the same file with `removed: null`: a new key for every member, no one
 * removed. An invite made before it only holds the older key, so a member file made from it is
 * refused (`old-invite`, sharing.ts). An older Ostler cannot read `removed: null`, so it is
 * written only when every member's PC says it understands 'invite-reset' (share-capabilities.ts).
 */
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes
} from './platform'
import type Database from 'better-sqlite3'
import { newProjectKey } from './change-file'
import { openEnvelope, sealEnvelope, type EnvelopeKind, type SyncFileRefusal } from './envelope'
import { SyncTransportError } from './transport-paths'
import type { SyncTransport } from './folder-transport'
import { signerOf, wasOwner } from './roles'
import { personOfMemberFile } from './sharing'
import {
  boxKeys,
  identityKeys,
  keyGenerationOf,
  personKeys,
  projectKeyFor,
  projectKeyring,
  storeProjectKey
} from './sync-keys'

const ROTATION_PATTERN = /^keys\/(\d{1,9})\.ostlerrotation$/

export interface KeyProblem {
  generation: number
  reason: SyncFileRefusal | 'unreadable' | 'mismatch' | 'no-key' | 'not-an-owner' | 'unknown-signer'
}

export interface KeysResult {
  /** Key changes read this time. */
  read: number
  /** True when this PC has itself been removed from the share. */
  removed: boolean
  problems: KeyProblem[]
}

export class RemoveMemberError extends Error {
  constructor(readonly reason: 'not-shared' | 'not-a-member' | 'this-pc' | 'busy') {
    super(`Removing a member refused: ${reason}`)
    this.name = 'RemoveMemberError'
  }
}

class RotationFileError extends Error {
  constructor(readonly reason: SyncFileRefusal) {
    super(`Key change refused: ${reason}`)
  }
}

const ROTATION_FILE: EnvelopeKind = {
  magic: Buffer.from('OSTLERKY', 'ascii'),
  version: 1,
  maxBytes: 4 * 1024 * 1024,
  refuse: (reason) => {
    throw new RotationFileError(reason)
  }
}

interface RotationHeader {
  shareId: string
  memberId: string
  publicKey: string
  generation: number
}

interface RosterMember {
  memberId: string
  name: string
  publicKey: string
  boxPublicKey: string | null
  joinedAt: number
}

interface WrappedKey {
  ephemeralPublicKey: string
  iv: string
  tag: string
  ciphertext: string
}

interface RotationPayload {
  /** The member removed; null when the key changed only to stop old invites. */
  removed: RosterMember | null
  cutoffs: Record<string, number>
  members: RosterMember[]
  keys: Record<string, WrappedKey>
}

interface ShareRow {
  share_id: string
  member_id: string
  rotations_read: number
  kind: 'project' | 'personal'
}

interface MemberRow {
  member_id: string
  name: string
  public_key: string
  box_public_key: string | null
  joined_at: number
  removed_at: number | null
}

/** Most tries at a new generation when another PC changed the key at the same time. */
const MAX_TRIES = 3

/** True when the folder has a key change newer than `generation`. */
export async function newerGeneration(
  transport: SyncTransport,
  generation: number
): Promise<boolean> {
  return (await rotationFiles(transport)).some((file) => file.generation > generation)
}

/**
 * Removes a member: makes the next key generation, writes it for every other
 * member, and starts using it here. Returns the new generation. The caller
 * writes a fresh snapshot with the new key.
 */
export async function removeMember(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string,
  memberId: string
): Promise<number> {
  return rotateKey(db, transport, projectId, memberId)
}

/**
 * Makes the next key generation and gives it to every member still in the project. With a member
 * id, that member is removed; with `null`, no one is (stopping old invites). Returns the new
 * generation. The caller writes a fresh snapshot with the new key.
 */
export async function rotateKey(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string,
  memberId: string | null
): Promise<number> {
  for (let tries = 1; ; tries++) {
    await refreshKeys(db, transport, projectId)
    const share = shareOf(db, projectId)
    if (!share) throw new RemoveMemberError('not-shared')
    if (memberId !== null && memberId === share.member_id) {
      throw new RemoveMemberError('this-pc')
    }
    const members = membersOf(db, share.share_id)
    const removed =
      memberId === null ? null : (members.find((member) => member.member_id === memberId) ?? null)
    if (memberId !== null && !removed) throw new RemoveMemberError('not-a-member')
    // Another PC removed them first.
    if (removed && removed.removed_at !== null) return keyGenerationOf(db, projectId)

    const current = keyGenerationOf(db, projectId)
    const currentKey = projectKeyFor(db, projectId)
    if (!currentKey) throw new RemoveMemberError('not-shared')
    const generation = current + 1
    const newKey = newProjectKey()
    const remaining = members.filter(
      (member) => member.removed_at === null && member.member_id !== memberId
    )
    const keys: Record<string, WrappedKey> = {}
    for (const member of remaining) {
      // A member whose PC never said its box key can't be given the new one (shared-folder-sync.md, known gaps).
      if (member.box_public_key) {
        keys[member.member_id] = wrapKey(newKey, member.box_public_key, share.share_id, generation)
      }
    }
    const cutoffs: Record<string, number> = {}
    for (const row of db
      .prepare('SELECT device_id, last_sequence FROM sync_applied WHERE share_id = @shareId')
      .all({ shareId: share.share_id }) as { device_id: string; last_sequence: number }[]) {
      cutoffs[row.device_id] = row.last_sequence
    }
    const payload: RotationPayload = {
      removed: removed ? toRoster(removed) : null,
      cutoffs,
      members: remaining.map(toRoster),
      keys
    }
    const identity = identityKeys(db)
    const bytes = sealEnvelope(
      ROTATION_FILE,
      {
        formatVersion: 1,
        shareId: share.share_id,
        memberId: share.member_id,
        publicKey: identity.publicKey,
        generation
      },
      payload,
      { projectKey: currentKey, keyGeneration: current, privateKey: identity.privateKey }
    )
    try {
      await transport.writeOnce(rotationPath(generation), bytes)
    } catch (error) {
      if (error instanceof SyncTransportError && error.reason === 'exists') {
        if (tries >= MAX_TRIES) throw new RemoveMemberError('busy')
        continue
      }
      throw error
    }
    db.transaction(() => {
      storeProjectKey(db, projectId, newKey, generation)
      applyRotation(db, share.share_id, payload)
      if (!removed) recordInvitesReset(db, share.share_id, personKeys(db).publicKey)
      db.prepare(
        'UPDATE sync_shares SET rotations_read = @generation WHERE project_id = @projectId'
      ).run({ generation, projectId })
    })()
    return generation
  }
}

/**
 * Reads the key changes this PC hasn't read yet, in order: stores each new key
 * it was given, marks who was removed, and adds the remaining members. Runs
 * before every pull. Stops at the first one it can't read, to retry next time.
 */
export async function refreshKeys(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string
): Promise<KeysResult> {
  const result: KeysResult = { read: 0, removed: false, problems: [] }
  const share = shareOf(db, projectId)
  if (!share) return result
  const files = new Map(
    (await rotationFiles(transport)).map((file) => [file.generation, file.path])
  )
  for (let generation = share.rotations_read + 1; files.has(generation); generation++) {
    // Made afresh each time: the key stored by the step before is the one this step opens with.
    const keyring = projectKeyring(db, projectId)
    const path = files.get(generation) as string
    let opened: { header: RotationHeader; payload: unknown; keyGeneration: number }
    try {
      let named: RotationHeader | null = null
      opened = openEnvelope(
        ROTATION_FILE,
        await transport.read(path),
        // Signed with the key its header names; the replaced key proves it is from a member.
        { projectKey: keyring, publicKeyFor: () => named?.publicKey ?? null },
        (raw) => (named = parseHeader(raw))
      )
    } catch (error) {
      result.problems.push({
        generation,
        reason: error instanceof RotationFileError ? error.reason : 'unreadable'
      })
      break
    }
    const { header, payload, keyGeneration } = opened
    const rotation = parsePayload(payload)
    if (
      !rotation ||
      header.shareId !== share.share_id ||
      header.generation !== generation ||
      keyGeneration !== generation - 1 ||
      !rotation.members.some(
        (member) => member.memberId === header.memberId && member.publicKey === header.publicKey
      ) ||
      (rotation.removed !== null &&
        rotation.members.some((member) => member.memberId === rotation.removed?.memberId))
    ) {
      result.problems.push({ generation, reason: 'mismatch' })
      break
    }
    // Only an Owner, or one who was, may remove someone (D1). The signer's person comes from
    // their member file: recorded here, or read from the folder when this PC joined after it
    // (sealed with a key older than the invite's). A signer with no member file is refused
    // until it arrives. The personal share has no roles: its signer must be this person (D13).
    const signer =
      signerOf(db, share.share_id, header.memberId, header.publicKey) ??
      (await personOfMemberFile(
        transport,
        share.share_id,
        header.memberId,
        header.publicKey,
        keyring
      ))
    if (signer === null) {
      result.problems.push({ generation, reason: 'unknown-signer' })
      break
    }
    const signerAllowed =
      share.kind === 'personal'
        ? signer === personKeys(db).publicKey
        : wasOwner(db, share.share_id, signer)
    if (!signerAllowed) {
      result.problems.push({ generation, reason: 'not-an-owner' })
      break
    }

    const removedHere = rotation.removed?.memberId === share.member_id
    let newKey: Buffer | null = null
    if (!removedHere) {
      const wrapped = rotation.keys[share.member_id]
      newKey = wrapped ? unwrapKey(db, wrapped, share.share_id, generation) : null
      // Not given the new key (and no invite carried it): this PC can't follow the share any more.
      if (!newKey && !keyring(generation)) {
        result.problems.push({ generation, reason: 'no-key' })
        break
      }
    }
    db.transaction(() => {
      if (newKey) storeProjectKey(db, projectId, newKey, generation)
      applyRotation(db, share.share_id, rotation)
      if (!rotation.removed) recordInvitesReset(db, share.share_id, signer)
      db.prepare(
        'UPDATE sync_shares SET rotations_read = @generation WHERE project_id = @projectId'
      ).run({ generation, projectId })
    })()
    result.read++
    // This PC was removed: it never gets the keys after this one.
    if (removedHere) break
  }
  result.removed =
    (
      db
        .prepare(
          'SELECT removed_at FROM sync_members WHERE share_id = @shareId AND member_id = @memberId'
        )
        .get({ shareId: share.share_id, memberId: share.member_id }) as
        { removed_at: number | null } | undefined
    )?.removed_at != null
  return result
}

/**
 * The members (`<member id> <public key>`) that the key changes this PC has not read
 * yet say remain. A PC that joined after a key change reads their member files, sealed
 * with an older key, before it can check who signed the change (sharing.ts): only
 * these are taken, so a removed member's old invite still adds no one.
 */
export async function unreadRoster(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string
): Promise<Set<string>> {
  const roster = new Set<string>()
  const share = shareOf(db, projectId)
  if (!share) return roster
  const keyring = projectKeyring(db, projectId)
  for (const file of await rotationFiles(transport)) {
    if (file.generation <= share.rotations_read) continue
    try {
      let named: RotationHeader | null = null
      const { header, payload } = openEnvelope(
        ROTATION_FILE,
        await transport.read(file.path),
        { projectKey: keyring, publicKeyFor: () => named?.publicKey ?? null },
        (raw) => (named = parseHeader(raw))
      )
      const rotation = parsePayload(payload)
      if (!rotation || header.shareId !== share.share_id) continue
      for (const member of rotation.members) roster.add(`${member.memberId} ${member.publicKey}`)
    } catch {
      continue
    }
  }
  return roster
}

/** Notes that old invites were stopped, and by which person (their public key). */
function recordInvitesReset(db: Database.Database, shareId: string, byPersonKey: string): void {
  db.prepare(
    'UPDATE sync_shares SET invites_reset_at = @now, invites_reset_by = @by WHERE share_id = @shareId'
  ).run({ now: Date.now(), by: byPersonKey, shareId })
}

function applyRotation(db: Database.Database, shareId: string, rotation: RotationPayload): void {
  const add = db.prepare(
    `INSERT INTO sync_members (share_id, member_id, person_id, name, public_key, box_public_key, joined_at)
     VALUES (@shareId, @memberId, NULL, @name, @publicKey, @boxPublicKey, @joinedAt)
     ON CONFLICT(share_id, member_id) DO UPDATE SET
       box_public_key = COALESCE(sync_members.box_public_key, excluded.box_public_key)
     WHERE sync_members.public_key = excluded.public_key`
  )
  for (const member of rotation.removed
    ? [...rotation.members, rotation.removed]
    : rotation.members) {
    add.run({ shareId, ...member })
  }
  if (!rotation.removed) return
  db.prepare(
    `UPDATE sync_members SET removed_at = COALESCE(removed_at, @now), removed_cutoffs = @cutoffs
     WHERE share_id = @shareId AND member_id = @memberId`
  ).run({
    shareId,
    memberId: rotation.removed.memberId,
    now: Date.now(),
    cutoffs: JSON.stringify(rotation.cutoffs)
  })
}

function wrapKey(
  key: Buffer,
  boxPublicKey: string,
  shareId: string,
  generation: number
): WrappedKey {
  const ephemeral = generateKeyPairSync('x25519')
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: createPublicKey({
      key: Buffer.from(boxPublicKey, 'base64'),
      format: 'der',
      type: 'spki'
    })
  })
  const ephemeralPublicKey = ephemeral.publicKey
    .export({ type: 'spki', format: 'der' })
    .toString('base64')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', wrappingKey(shared, shareId, generation), iv)
  cipher.setAAD(Buffer.from(ephemeralPublicKey, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()])
  return {
    ephemeralPublicKey,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
}

function unwrapKey(
  db: Database.Database,
  wrapped: WrappedKey,
  shareId: string,
  generation: number
): Buffer | null {
  try {
    const shared = diffieHellman({
      privateKey: createPrivateKey({
        key: Buffer.from(boxKeys(db).privateKey, 'base64'),
        format: 'der',
        type: 'pkcs8'
      }),
      publicKey: createPublicKey({
        key: Buffer.from(wrapped.ephemeralPublicKey, 'base64'),
        format: 'der',
        type: 'spki'
      })
    })
    const decipher = createDecipheriv(
      'aes-256-gcm',
      wrappingKey(shared, shareId, generation),
      Buffer.from(wrapped.iv, 'base64')
    )
    decipher.setAAD(Buffer.from(wrapped.ephemeralPublicKey, 'utf8'))
    decipher.setAuthTag(Buffer.from(wrapped.tag, 'base64'))
    const key = Buffer.concat([
      decipher.update(Buffer.from(wrapped.ciphertext, 'base64')),
      decipher.final()
    ])
    return key.length === 32 ? key : null
  } catch {
    return null
  }
}

function wrappingKey(shared: Buffer, shareId: string, generation: number): Buffer {
  return deriveWrappingKey(shared, shareId, `ostler-project-key:${generation}`)
}

function deriveWrappingKey(shared: Buffer, salt: string, info: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', shared, Buffer.from(salt, 'utf8'), Buffer.from(info, 'utf8'), 32)
  )
}

/** An X25519 public key in SPKI DER is always this long. */
const X25519_SPKI_BYTES = 44
const WRAP_IV_BYTES = 12
const WRAP_TAG_BYTES = 16

/**
 * Encrypts `plaintext` to one recipient's box public key (X25519, SPKI DER, base64): the
 * same wrapping a removed-member key uses (above), with `context` as its label. Packed as
 * the ephemeral public key, the IV, the GCM tag, then the ciphertext. Used for the pairing
 * keys a new device gets (sync-keys, personal-space.ts).
 */
export function wrapForBoxKey(
  plaintext: Buffer,
  recipientBoxPublicKey: string,
  context: string
): Buffer {
  const ephemeral = generateKeyPairSync('x25519')
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: createPublicKey({
      key: Buffer.from(recipientBoxPublicKey, 'base64'),
      format: 'der',
      type: 'spki'
    })
  })
  const ephemeralPublicKey = ephemeral.publicKey.export({ type: 'spki', format: 'der' })
  const iv = randomBytes(WRAP_IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', deriveWrappingKey(shared, 'ostler-box', context), iv)
  cipher.setAAD(ephemeralPublicKey)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([ephemeralPublicKey, iv, cipher.getAuthTag(), ciphertext])
}

/**
 * Opens a `wrapForBoxKey` result with this PC's box private key (PKCS8 DER, base64). Null
 * for anything that does not open under that key and `context`; never throws.
 */
export function unwrapWithBoxKey(
  wrapped: Buffer,
  boxPrivateKey: string,
  context: string
): Buffer | null {
  const headerBytes = X25519_SPKI_BYTES + WRAP_IV_BYTES + WRAP_TAG_BYTES
  if (wrapped.length < headerBytes) return null
  try {
    const ephemeralPublicKey = wrapped.subarray(0, X25519_SPKI_BYTES)
    const ivEnd = X25519_SPKI_BYTES + WRAP_IV_BYTES
    const shared = diffieHellman({
      privateKey: createPrivateKey({
        key: Buffer.from(boxPrivateKey, 'base64'),
        format: 'der',
        type: 'pkcs8'
      }),
      publicKey: createPublicKey({ key: ephemeralPublicKey, format: 'der', type: 'spki' })
    })
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveWrappingKey(shared, 'ostler-box', context),
      wrapped.subarray(X25519_SPKI_BYTES, ivEnd)
    )
    decipher.setAAD(ephemeralPublicKey)
    decipher.setAuthTag(wrapped.subarray(ivEnd, headerBytes))
    return Buffer.concat([decipher.update(wrapped.subarray(headerBytes)), decipher.final()])
  } catch {
    return null
  }
}

async function rotationFiles(
  transport: SyncTransport
): Promise<{ generation: number; path: string }[]> {
  const files: { generation: number; path: string }[] = []
  for (const relativePath of await transport.list('keys')) {
    const match = ROTATION_PATTERN.exec(relativePath)
    if (match) files.push({ generation: Number(match[1]), path: relativePath })
  }
  return files
}

function rotationPath(generation: number): string {
  return `keys/${generation}.ostlerrotation`
}

function shareOf(db: Database.Database, projectId: string): ShareRow | null {
  return (
    (db
      .prepare(
        'SELECT share_id, member_id, rotations_read, kind FROM sync_shares WHERE project_id = @projectId'
      )
      .get({ projectId }) as ShareRow | undefined) ?? null
  )
}

function membersOf(db: Database.Database, shareId: string): MemberRow[] {
  return db
    .prepare(
      `SELECT member_id, name, public_key, box_public_key, joined_at, removed_at
       FROM sync_members WHERE share_id = @shareId`
    )
    .all({ shareId }) as MemberRow[]
}

function toRoster(member: MemberRow): RosterMember {
  return {
    memberId: member.member_id,
    name: member.name,
    publicKey: member.public_key,
    boxPublicKey: member.box_public_key,
    joinedAt: member.joined_at
  }
}

function parseHeader(header: Record<string, unknown>): RotationHeader {
  if (
    header.formatVersion !== 1 ||
    typeof header.shareId !== 'string' ||
    typeof header.memberId !== 'string' ||
    typeof header.publicKey !== 'string' ||
    typeof header.generation !== 'number' ||
    !Number.isSafeInteger(header.generation) ||
    header.generation < 1
  ) {
    throw new RotationFileError('not-a-change-file')
  }
  return {
    shareId: header.shareId,
    memberId: header.memberId,
    publicKey: header.publicKey,
    generation: header.generation
  }
}

function parsePayload(value: unknown): RotationPayload | null {
  if (typeof value !== 'object' || value === null) return null
  const { removed, cutoffs, members, keys } = value as Record<string, unknown>
  if (
    (removed !== null && !isRosterMember(removed)) ||
    !Array.isArray(members) ||
    !members.every(isRosterMember)
  ) {
    return null
  }
  if (typeof cutoffs !== 'object' || cutoffs === null || Array.isArray(cutoffs)) return null
  if (!Object.values(cutoffs).every((n) => typeof n === 'number' && Number.isSafeInteger(n))) {
    return null
  }
  if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) return null
  if (!Object.values(keys).every(isWrappedKey)) return null
  return {
    removed: removed as RosterMember | null,
    cutoffs: cutoffs as Record<string, number>,
    members,
    keys: keys as Record<string, WrappedKey>
  }
}

function isRosterMember(value: unknown): value is RosterMember {
  if (typeof value !== 'object' || value === null) return false
  const { memberId, name, publicKey, boxPublicKey, joinedAt } = value as Record<string, unknown>
  return (
    typeof memberId === 'string' &&
    /^[A-Za-z0-9-]+$/.test(memberId) &&
    typeof name === 'string' &&
    typeof publicKey === 'string' &&
    (boxPublicKey === null || typeof boxPublicKey === 'string') &&
    typeof joinedAt === 'number'
  )
}

function isWrappedKey(value: unknown): value is WrappedKey {
  if (typeof value !== 'object' || value === null) return false
  const { ephemeralPublicKey, iv, tag, ciphertext } = value as Record<string, unknown>
  return (
    typeof ephemeralPublicKey === 'string' &&
    typeof iv === 'string' &&
    typeof tag === 'string' &&
    typeof ciphertext === 'string'
  )
}
