/**
 * Roles in a shared project (docs/plans/people-and-devices/overview.md, D1, D6, D7, D8).
 *
 * An Owner invites, changes roles and removes people. An Editor changes the
 * project's content and may invite (never as Owner) but cannot change roles or remove. A Viewer reads
 * and may add, edit and delete only its own comments. A Contributor works only the
 * tasks assigned to them and comments. Anyone with no known role counts as a Viewer.
 *
 * A role change is `roles/<stamp>.ostlerrole`, a sealed envelope (envelope.ts)
 * signed by an Owner's device key. Its payload names the person, the role they
 * now have, the role before it and `cutoffs`: how far each device's change files
 * had been applied when the change was written. A change file counts under the
 * role its person had at that file's sequence (`roleAtSequence`), so edits made
 * before a demotion still apply and later ones do not.
 *
 * An invite may carry a grant (D8): the role a joiner gets, signed with an
 * Owner's or an Editor's person key (an Editor's only for Editor, Contributor or Viewer) over `{ v: 2, shareId, role, inviteId, invitePublicKey }`.
 * The invite also carries the matching invite private key (derived from the
 * Owner's person key, the share and the role, so it never changes), and the
 * joiner's member file proves it holds it by signing its own person key with
 * it. A grant copied out of someone else's member file has no proof for the
 * copier's person, so it counts for nothing. A grant that does not verify, or
 * has no proof, gives Viewer; so does a new person with no grant.
 *
 * `refreshRoles` runs after the member files and before the change files
 * (sync-service.ts), so the signers and people it names are already known. A
 * file refused because its signer or person is not known yet, or its signer is
 * not an Owner yet, is read again on the next pull.
 *
 * A share from before roles has no role files. The first Owner PC that pulls
 * after upgrading writes them (`ensureRoleFiles`): its own founder file and one
 * for each other Owner, so a new joiner learns who the Owners are. A PC that
 * knows no Owner of a share (one that joined from an invite with no `founder`)
 * takes the first founder file, one whose signer names itself with no role
 * before, as the founder: trust on first use.
 */
import { createHash, createPrivateKey, createPublicKey, hkdfSync, sign, verify } from './platform'
import type Database from 'better-sqlite3'
import type { ShareRole } from '@shared/ostler-api/sharing-types'
import { Refusal } from '@shared/refusal'
import { localStamp } from './capture'
import {
  openEnvelope,
  sealEnvelope,
  type EnvelopeKind,
  type KeySource,
  type SyncFileRefusal
} from './envelope'
import type { SyncTransport } from './folder-transport'
import { personOfMemberFile } from './sharing'
import {
  ed25519PublicKey,
  identityKeys,
  keyGenerationOf,
  personKeys,
  projectKeyFor,
  projectKeyring
} from './sync-keys'

export const ROLES: readonly ShareRole[] = ['owner', 'editor', 'contributor', 'viewer']
const ROLE_FILE_PATTERN = /^roles\/([^/]+)\.ostlerrole$/
const CHANGE_FILE_PATTERN = /^(\d{6,})\.ostlerchanges$/

/** A grant as an invite carries it (D8). */
export interface Grant {
  role: ShareRole
  inviteId: string
  /** The Owner's person public key that signed the grant. */
  signedBy: string
  /** The invite's public key (SPKI DER, base64); absent in a grant from before 2026-10-25. */
  invitePublicKey?: string
  /** Ed25519 signature over the canonical JSON of `{ v, shareId, role, inviteId, invitePublicKey }`, base64. */
  signature: string
}

/** PKCS8 DER prefix of an Ed25519 private key; the 32-byte seed follows. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

export interface RoleProblem {
  path: string
  reason: string
}

export interface RolesResult {
  /** Role change files read this time (applied or refused). */
  read: number
  problems: RoleProblem[]
}

export class RoleError extends Error {
  constructor(readonly reason: 'not-shared' | 'not-a-member' | 'last-owner') {
    super(`Changing a role refused: ${reason}`)
    this.name = 'RoleError'
  }
}

type RoleFileReason =
  SyncFileRefusal | 'bad-role' | 'mismatch' | 'not-a-member' | 'not-an-owner' | 'no-owner'

class RoleFileError extends Error {
  constructor(readonly reason: RoleFileReason) {
    super(`Role change refused: ${reason}`)
  }
}

const ROLE_FILE: EnvelopeKind = {
  magic: Buffer.from('OSTLERRL', 'ascii'),
  version: 1,
  maxBytes: 64 * 1024,
  refuse: (reason) => {
    throw new RoleFileError(reason)
  }
}

interface RoleHeader {
  shareId: string
  memberId: string
  publicKey: string
}

interface RolePayload {
  person: string
  role: ShareRole
  previousRole: ShareRole | null
  cutoffs: Record<string, number>
}

interface ShareRow {
  share_id: string
  member_id: string
  device_id: string
}

interface MemberRow {
  person: string
  public_key: string
}

/** What one role change file did, for the row kept in `sync_role_files`. */
interface RoleRecord extends Partial<RolePayload> {
  reason: string | null
  /** Refused only for now: read the file again on the next pull. */
  retry?: boolean
  /** The person who signed the file, when it was applied. */
  signedBy?: string
}

/**
 * The role a person has in a share: the role on record. A person with no role
 * yet is a Viewer, a person this PC has not finished reading is never more than
 * that. A share with no roles recorded at all is from before roles: everyone in
 * it is an Owner (D6).
 */
export function roleOf(db: Database.Database, shareId: string, personKey: string): ShareRole {
  const recorded = recordedRole(db, shareId, personKey)
  if (recorded) return recorded
  const anyRole = db.prepare('SELECT 1 FROM sync_roles WHERE share_id = @shareId LIMIT 1').get({
    shareId
  })
  return anyRole ? 'viewer' : 'owner'
}

/**
 * Whether a person is recorded as an Owner. Only a recorded role counts here: the
 * fallback in `roleOf` must never grant authority (a signer, a grant, a removal).
 */
export function isOwner(db: Database.Database, shareId: string, personKey: string): boolean {
  return recordedRole(db, shareId, personKey) === 'owner'
}

/** The role on record for a person, or null when none is recorded. */
export function recordedRole(
  db: Database.Database,
  shareId: string,
  personKey: string
): ShareRole | null {
  const row = db
    .prepare(
      'SELECT role FROM sync_roles WHERE share_id = @shareId AND person_public_key = @personKey'
    )
    .get({ shareId, personKey }) as { role: ShareRole } | undefined
  return row?.role ?? null
}

/** Whether this PC's own person is an Owner of the project; false when it is not shared. */
export function isOwnerHere(db: Database.Database, projectId: string): boolean {
  const share = shareRowOf(db, projectId)
  return share !== null && isOwner(db, share.share_id, personKeys(db).publicKey)
}

/** Refuses (a `Refusal`) unless this PC's person is an Owner of the project. */
export function assertOwner(db: Database.Database, projectId: string): void {
  if (!isOwnerHere(db, projectId)) throw new Refusal('not-an-owner')
}

/**
 * The role a person had at a change file's sequence (D7). Each role change
 * names the cutoff for the device that wrote the file: its files up to the
 * cutoff counted under the role before the change, later ones under the new
 * role. With no role changes read, the person has their current role.
 */
export function roleAtSequence(
  db: Database.Database,
  shareId: string,
  personKey: string,
  deviceId: string,
  sequence: number
): ShareRole {
  const files = db
    .prepare(
      `SELECT role, previous_role, cutoffs FROM sync_role_files
       WHERE share_id = @shareId AND person_public_key = @personKey AND applied = 1
       ORDER BY stamp`
    )
    .all({ shareId, personKey }) as {
    role: ShareRole
    previous_role: ShareRole | null
    cutoffs: string | null
  }[]
  if (files.length === 0) return roleOf(db, shareId, personKey)
  let role: ShareRole = files[0].previous_role ?? 'viewer'
  for (const file of files) {
    if (sequence > (cutoffsOf(file.cutoffs)[deviceId] ?? 0)) role = file.role
  }
  return role
}

/**
 * Makes this PC's person the Owner of a share it has just started (D6). Writes
 * the first role change, with no role before it, so later joiners can read it.
 */
export async function recordFounder(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string
): Promise<void> {
  const share = shareRowOf(db, projectId)
  if (!share) throw new RoleError('not-shared')
  const person = personKeys(db).publicKey
  await writeRoleFile(db, transport, projectId, share, {
    person,
    role: 'owner',
    previousRole: null,
    cutoffs: {}
  })
}

/**
 * Writes the role files a share from before roles lacks, so people who join it
 * later see its Owners (D6). Does nothing unless this PC's person is an Owner and
 * the folder has no role files: this person's founder file first, then one for
 * each other current Owner.
 */
export async function ensureRoleFiles(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string
): Promise<void> {
  const share = shareRowOf(db, projectId)
  if (!share || !isOwnerHere(db, projectId)) return
  if ((await transport.list('roles')).some((path) => ROLE_FILE_PATTERN.test(path))) return
  const me = personKeys(db).publicKey
  await writeRoleFile(db, transport, projectId, share, {
    person: me,
    role: 'owner',
    previousRole: null,
    cutoffs: {}
  })
  const owners = db
    .prepare(
      `SELECT r.person_public_key AS person FROM sync_roles AS r
       WHERE r.share_id = @shareId AND r.role = 'owner' AND r.person_public_key != @me
       ORDER BY r.person_public_key`
    )
    .all({ shareId: share.share_id, me }) as { person: string }[]
  for (const { person } of owners) {
    if (!isCurrentPerson(db, share.share_id, person)) continue
    await writeRoleFile(db, transport, projectId, share, {
      person,
      role: 'owner',
      previousRole: 'owner',
      cutoffs: {}
    })
  }
}

/**
 * Seeds the founder from an invite as Owner, so their first role change and
 * their grants can be checked before the role file itself is read.
 */
export function seedFounder(db: Database.Database, shareId: string, personKey: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO sync_roles (share_id, person_public_key, role, since_stamp, granted_by, cutoffs)
     VALUES (@shareId, @personKey, 'owner', '0', NULL, NULL)`
  ).run({ shareId, personKey })
}

/**
 * Gives a person their role from the grant in their member file, the first
 * time it is read (D8). The grant counts only with a proof, signed with the
 * invite's private key, naming this person. A grant that does not verify, has
 * no such proof, or none, gives Viewer. A grant counts when its signer is an
 * Owner, or an Editor granting Editor, Contributor or Viewer (D13). A grant whose
 * signer has no such role here yet, including an Editor demoted before the
 * joiner's member file is read, is left for a later read.
 */
export function assignGrantedRole(
  db: Database.Database,
  shareId: string,
  personKey: string,
  grant: unknown,
  proof: unknown
): void {
  if (recordedRole(db, shareId, personKey)) return
  const verified = verifyGrant(grant, shareId)
  if (!verified || !verifyGrantProof(verified, shareId, personKey, proof)) {
    insertRole(db, shareId, personKey, 'viewer', '0', null)
  } else if (
    isOwner(db, shareId, verified.signedBy) ||
    recordedRole(db, shareId, verified.signedBy) === 'editor'
  ) {
    // verifyGrant refuses a grant for Owner, whoever signs it.
    insertRole(db, shareId, personKey, verified.role, '0', verified.signedBy)
  }
}

/** Signs a grant of `role` with this PC's person key. The caller checks that this PC is an Owner or an Editor. */
export function signGrant(db: Database.Database, shareId: string, role: Grant['role']): Grant {
  const person = personKeys(db)
  // Derived from the share and the role, so the same invite always reads the same (the
  // signature is deterministic too). Nothing needs a random id: an invite is a share's grant.
  const inviteId = createHash('sha256')
    .update(`${shareId}:${role}`)
    .digest('base64url')
    .slice(0, 22)
  const invitePublicKey = inviteKeyFor(db, shareId, role).publicKey
  const key = createPrivateKey({
    key: Buffer.from(person.privateKey, 'base64'),
    format: 'der',
    type: 'pkcs8'
  })
  const signature = sign(
    null,
    Buffer.from(grantBody(shareId, role, inviteId, invitePublicKey)),
    key
  )
  return {
    role,
    inviteId,
    signedBy: person.publicKey,
    invitePublicKey,
    signature: signature.toString('base64')
  }
}

/**
 * The invite key pair of a share and role (Ed25519, DER base64): derived from this PC's
 * person private key, so the same invite always carries the same pair. The private key is
 * a secret of the invite: it is never written to the folder, the database or a log.
 */
export function inviteKeyFor(
  db: Database.Database,
  shareId: string,
  role: ShareRole
): { privateKey: string; publicKey: string } {
  const seed = Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(personKeys(db).privateKey, 'base64'),
      shareId,
      `ostler-invite-key:${role}`,
      32
    )
  )
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8'
  })
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKey: createPublicKey(privateKey)
      .export({ type: 'spki', format: 'der' })
      .toString('base64')
  }
}

/** A joiner's proof that it holds the invite's private key: its person key, signed with it, base64. */
export function signGrantProof(
  shareId: string,
  inviteId: string,
  personPublicKey: string,
  invitePrivateKey: string
): string {
  const key = createPrivateKey({
    key: Buffer.from(invitePrivateKey, 'base64'),
    format: 'der',
    type: 'pkcs8'
  })
  return sign(null, Buffer.from(proofBody(shareId, inviteId, personPublicKey)), key).toString(
    'base64'
  )
}

function verifyGrantProof(
  grant: Grant,
  shareId: string,
  personKey: string,
  proof: unknown
): boolean {
  if (!grant.invitePublicKey || typeof proof !== 'string') return false
  try {
    return verify(
      null,
      Buffer.from(proofBody(shareId, grant.inviteId, personKey)),
      ed25519PublicKey(grant.invitePublicKey),
      Buffer.from(proof, 'base64')
    )
  } catch {
    return false
  }
}

/** The grant when it has the right shape and its signature verifies for this share; else null. */
export function verifyGrant(value: unknown, shareId: string): Grant | null {
  const grant = grantOf(value)
  // A grant gives an Editor, Contributor or Viewer only; Owners are made by role changes (D1, D8).
  if (!grant || grant.role === 'owner') return null
  try {
    const valid = verify(
      null,
      Buffer.from(grantBody(shareId, grant.role, grant.inviteId, grant.invitePublicKey)),
      ed25519PublicKey(grant.signedBy),
      Buffer.from(grant.signature, 'base64')
    )
    return valid ? grant : null
  } catch {
    return null
  }
}

/** A grant's fields when the value has them as text and a role name; else null. Checks no signature. */
export function grantOf(value: unknown): Grant | null {
  if (!value || typeof value !== 'object') return null
  const grant = value as Record<string, unknown>
  if (
    typeof grant.role !== 'string' ||
    !ROLES.includes(grant.role as ShareRole) ||
    typeof grant.inviteId !== 'string' ||
    typeof grant.signedBy !== 'string' ||
    typeof grant.signature !== 'string' ||
    (grant.invitePublicKey !== undefined && typeof grant.invitePublicKey !== 'string')
  ) {
    return null
  }
  return {
    role: grant.role as ShareRole,
    inviteId: grant.inviteId,
    signedBy: grant.signedBy,
    ...(typeof grant.invitePublicKey === 'string'
      ? { invitePublicKey: grant.invitePublicKey }
      : {}),
    signature: grant.signature
  }
}

/**
 * Changes a person's role (Owner only; D1). Refuses to demote the last Owner.
 * Reads the role files first, so the change starts from the current roles.
 */
export async function writeRoleChange(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string,
  personKey: string,
  role: ShareRole
): Promise<void> {
  const share = shareRowOf(db, projectId)
  if (!share) throw new RoleError('not-shared')
  assertOwner(db, projectId)
  await refreshRoles(db, transport, share.share_id, projectKeyring(db, projectId))
  if (!isCurrentPerson(db, share.share_id, personKey)) throw new RoleError('not-a-member')
  const before = roleOf(db, share.share_id, personKey)
  if (before === role) return
  if (before === 'owner' && role !== 'owner' && ownerCount(db, share.share_id) <= 1) {
    throw new RoleError('last-owner')
  }
  await writeRoleFile(db, transport, projectId, share, {
    person: personKey,
    role,
    previousRole: before,
    cutoffs: await cutoffsNow(db, transport, share)
  })
}

/**
 * Reads the role change files this PC has not read yet, in stamp order. Each
 * is applied when its signer is a current Owner and at least one Owner would
 * remain; any other is refused and reported. Stops at a file it cannot open,
 * to retry next time.
 */
export async function refreshRoles(
  db: Database.Database,
  transport: SyncTransport,
  shareId: string,
  keys: KeySource
): Promise<RolesResult> {
  const result: RolesResult = { read: 0, problems: [] }
  const seen = new Set(
    (
      db.prepare('SELECT path FROM sync_role_files WHERE share_id = @shareId').all({ shareId }) as {
        path: string
      }[]
    ).map((row) => row.path)
  )
  const paths = (await transport.list('roles'))
    .filter((path) => ROLE_FILE_PATTERN.test(path) && !seen.has(path))
    .sort()
  for (const path of paths) {
    const stamp = (ROLE_FILE_PATTERN.exec(path) as RegExpExecArray)[1]
    let opened: { header: RoleHeader; payload: unknown }
    try {
      let named: RoleHeader | null = null
      const { header, payload } = openEnvelope(
        ROLE_FILE,
        await transport.read(path),
        // Signed with the key its header names; the project key proves it is from a member.
        { projectKey: keys, publicKeyFor: () => named?.publicKey ?? null },
        (raw) => (named = parseRoleHeader(raw))
      )
      opened = { header, payload }
    } catch (error) {
      result.problems.push({
        path,
        reason: error instanceof RoleFileError ? error.reason : 'unreadable'
      })
      break
    }
    // A signer this PC has no record of (its member file is sealed with a key older than the
    // invite's, so it arrives with a key change) is read from its member file instead.
    const fileSigner = memberRecorded(db, shareId, opened.header.memberId)
      ? null
      : await personOfMemberFile(
          transport,
          shareId,
          opened.header.memberId,
          opened.header.publicKey,
          keys
        )
    const record = db.transaction(() => {
      const outcome = acceptRoleFile(db, shareId, stamp, opened.header, opened.payload, fileSigner)
      // Not known yet, or not an Owner yet: read it again once the members or roles have arrived.
      if (outcome.retry) return outcome
      db.prepare(
        `INSERT INTO sync_role_files (share_id, path, stamp, person_public_key, role, previous_role, cutoffs, applied, signed_by, applied_at)
         VALUES (@shareId, @path, @stamp, @person, @role, @previousRole, @cutoffs, @applied, @signedBy, @appliedAt)`
      ).run({
        shareId,
        path,
        stamp,
        person: outcome.person ?? null,
        role: outcome.role ?? null,
        previousRole: outcome.previousRole ?? null,
        cutoffs: outcome.cutoffs ? JSON.stringify(outcome.cutoffs) : null,
        applied: outcome.reason === null ? 1 : 0,
        // Who signed it and when this PC applied it, for the membership history.
        signedBy: outcome.reason === null ? (outcome.signedBy ?? null) : null,
        appliedAt: outcome.reason === null ? Date.now() : null
      })
      return outcome
    })()
    result.read++
    if (record.reason) result.problems.push({ path, reason: record.reason })
  }
  recordMyRole(db, shareId)
  return result
}

/**
 * Keeps `sync_shares.my_role` in step with this PC's own person (D9): the
 * database guard on a Viewer's PC reads it instead of the role rows. Called
 * whenever roles are read, so a promotion or demotion applies after the next pull.
 *
 * Owner only when it is on record, the same rule as `isOwner`, so the screen never offers
 * what `assertOwner` refuses. With no role on record, `roleOf`'s fallback stands, short of
 * Owner: in a share with no roles at all this PC may still edit.
 */
export function recordMyRole(db: Database.Database, shareId: string): void {
  const me = personKeys(db).publicKey
  const fallback = roleOf(db, shareId, me) === 'owner' ? 'editor' : 'viewer'
  db.prepare('UPDATE sync_shares SET my_role = @role WHERE share_id = @shareId').run({
    shareId,
    role: recordedRole(db, shareId, me) ?? fallback
  })
}

/** This PC's own role in a shared project, or null when the project is not shared. */
export function myRoleOf(db: Database.Database, projectId: string): ShareRole | null {
  const row = db
    .prepare('SELECT my_role FROM sync_shares WHERE project_id = @projectId')
    .get({ projectId }) as { my_role: ShareRole } | undefined
  return row?.my_role ?? null
}

/** Applies one read role change, or refuses it with the reason. Runs inside a transaction. */
function acceptRoleFile(
  db: Database.Database,
  shareId: string,
  stamp: string,
  header: RoleHeader,
  payload: unknown,
  fileSigner: string | null
): RoleRecord {
  const refuse = (reason: string): RoleRecord => ({ reason })
  if (header.shareId !== shareId) return refuse('mismatch')
  const member = memberOf(db, shareId, header.memberId)
  const signer =
    member && member.public_key === header.publicKey
      ? member
      : fileSigner
        ? { person: fileSigner, public_key: header.publicKey }
        : null
  // A signer this PC has never recorded may still arrive; a removed one never comes back.
  if (!signer) {
    return { reason: 'not-a-member', retry: !memberRecorded(db, shareId, header.memberId) }
  }
  const change = parseRolePayload(payload)
  // A PC that knows no Owner takes the first founder file it reads: one whose signer
  // names itself with no role before (trust on first use; an invite with no founder).
  const founder =
    change !== null &&
    change.previousRole === null &&
    change.role === 'owner' &&
    change.person === signer.person &&
    !hasOwner(db, shareId)
  if (!founder && !isOwner(db, shareId, signer.person)) {
    return { reason: 'not-an-owner', retry: true }
  }
  if (!change) return refuse('bad-role')
  if (!isCurrentPerson(db, shareId, change.person)) {
    return { reason: 'not-a-member', retry: !personRecorded(db, shareId, change.person) }
  }
  if (
    isOwner(db, shareId, change.person) &&
    change.role !== 'owner' &&
    ownerCount(db, shareId) <= 1
  ) {
    return { ...change, reason: 'no-owner' }
  }
  storeRole(db, shareId, stamp, signer.person, change)
  return { ...change, reason: null, signedBy: signer.person }
}

/** Writes this PC's own role change: the file, then the record it makes. */
async function writeRoleFile(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string,
  share: ShareRow,
  change: RolePayload
): Promise<void> {
  const projectKey = projectKeyFor(db, projectId)
  if (!projectKey) throw new RoleError('not-shared')
  const identity = identityKeys(db)
  const stamp = localStamp(share.device_id)
  const bytes = sealEnvelope(
    ROLE_FILE,
    {
      formatVersion: 1,
      shareId: share.share_id,
      memberId: share.member_id,
      publicKey: identity.publicKey
    },
    {
      personPublicKey: change.person,
      role: change.role,
      previousRole: change.previousRole,
      cutoffs: change.cutoffs
    },
    {
      projectKey,
      keyGeneration: keyGenerationOf(db, projectId),
      privateKey: identity.privateKey
    }
  )
  await transport.writeOnce(`roles/${stamp}.ostlerrole`, bytes)
  db.transaction(() => {
    storeRole(db, share.share_id, stamp, personKeys(db).publicKey, change)
    db.prepare(
      `INSERT INTO sync_role_files (share_id, path, stamp, person_public_key, role, previous_role, cutoffs, applied, signed_by, applied_at)
       VALUES (@shareId, @path, @stamp, @person, @role, @previousRole, @cutoffs, 1, @signedBy, @appliedAt)`
    ).run({
      signedBy: personKeys(db).publicKey,
      appliedAt: Date.now(),
      shareId: share.share_id,
      path: `roles/${stamp}.ostlerrole`,
      stamp,
      person: change.person,
      role: change.role,
      previousRole: change.previousRole,
      cutoffs: JSON.stringify(change.cutoffs)
    })
  })()
}

/** Sets a person's role and the record of the change that set it, when it is newer than the one on record. */
function storeRole(
  db: Database.Database,
  shareId: string,
  stamp: string,
  grantedBy: string,
  change: RolePayload
): void {
  const existing = db
    .prepare(
      'SELECT since_stamp FROM sync_roles WHERE share_id = @shareId AND person_public_key = @person'
    )
    .get({ shareId, person: change.person }) as { since_stamp: string } | undefined
  if (existing && stamp <= existing.since_stamp) return
  db.prepare(
    `INSERT OR REPLACE INTO sync_roles (share_id, person_public_key, role, since_stamp, granted_by, cutoffs)
     VALUES (@shareId, @person, @role, @stamp, @grantedBy, @cutoffs)`
  ).run({
    shareId,
    person: change.person,
    role: change.role,
    stamp,
    grantedBy,
    cutoffs: JSON.stringify(change.cutoffs)
  })
}

function insertRole(
  db: Database.Database,
  shareId: string,
  personKey: string,
  role: ShareRole,
  sinceStamp: string,
  grantedBy: string | null
): void {
  db.prepare(
    `INSERT INTO sync_roles (share_id, person_public_key, role, since_stamp, granted_by, cutoffs)
     VALUES (@shareId, @personKey, @role, @sinceStamp, @grantedBy, NULL)`
  ).run({ shareId, personKey, role, sinceStamp, grantedBy })
}

/** This PC's cutoffs for a role change: how far every device's files were applied, and this device's own last file. */
async function cutoffsNow(
  db: Database.Database,
  transport: SyncTransport,
  share: ShareRow
): Promise<Record<string, number>> {
  const cutoffs: Record<string, number> = {}
  for (const row of db
    .prepare('SELECT device_id, last_sequence FROM sync_applied WHERE share_id = @shareId')
    .all({ shareId: share.share_id }) as { device_id: string; last_sequence: number }[]) {
    cutoffs[row.device_id] = row.last_sequence
  }
  cutoffs[share.device_id] = await highestOwnSequence(transport, share.device_id)
  return cutoffs
}

async function highestOwnSequence(transport: SyncTransport, deviceId: string): Promise<number> {
  let highest = 0
  for (const path of await transport.list(`changes/${deviceId}`)) {
    const match = CHANGE_FILE_PATTERN.exec(path.slice(path.lastIndexOf('/') + 1))
    if (match && Number(match[1]) > highest) highest = Number(match[1])
  }
  return highest
}

/** Whether any Owner is recorded for the share. */
function hasOwner(db: Database.Database, shareId: string): boolean {
  return (
    db
      .prepare("SELECT 1 FROM sync_roles WHERE share_id = @shareId AND role = 'owner' LIMIT 1")
      .get({ shareId }) !== undefined
  )
}

/** How many Owners the share has among its current members. */
function ownerCount(db: Database.Database, shareId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM sync_roles AS r
         WHERE r.share_id = @shareId AND r.role = 'owner'
           AND EXISTS (
             SELECT 1 FROM sync_members AS m
             WHERE m.share_id = r.share_id AND m.removed_at IS NULL
               AND COALESCE(m.person_public_key, m.public_key) = r.person_public_key
           )`
      )
      .get({ shareId }) as { n: number }
  ).n
}

function isCurrentPerson(db: Database.Database, shareId: string, personKey: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM sync_members
         WHERE share_id = @shareId AND removed_at IS NULL
           AND COALESCE(person_public_key, public_key) = @personKey`
      )
      .get({ shareId, personKey }) !== undefined
  )
}

/** Whether this PC has recorded the member at all, removed or not. */
function memberRecorded(db: Database.Database, shareId: string, memberId: string): boolean {
  return (
    db
      .prepare('SELECT 1 FROM sync_members WHERE share_id = @shareId AND member_id = @memberId')
      .get({ shareId, memberId }) !== undefined
  )
}

/** Whether this PC has recorded any member of the person, removed or not. */
function personRecorded(db: Database.Database, shareId: string, personKey: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM sync_members
         WHERE share_id = @shareId AND COALESCE(person_public_key, public_key) = @personKey`
      )
      .get({ shareId, personKey }) !== undefined
  )
}

function memberOf(db: Database.Database, shareId: string, memberId: string): MemberRow | null {
  const row = db
    .prepare(
      `SELECT COALESCE(person_public_key, public_key) AS person, public_key FROM sync_members
       WHERE share_id = @shareId AND member_id = @memberId AND removed_at IS NULL`
    )
    .get({ shareId, memberId }) as { person: string; public_key: string } | undefined
  return row ? { person: row.person, public_key: row.public_key } : null
}

/**
 * The person of a member this PC has read with that device key, removed later or not;
 * null when it has not read one. Used to check who signed a key change (rotation.ts).
 */
export function signerOf(
  db: Database.Database,
  shareId: string,
  memberId: string,
  publicKey: string
): string | null {
  const row = db
    .prepare(
      `SELECT COALESCE(person_public_key, public_key) AS person FROM sync_members
       WHERE share_id = @shareId AND member_id = @memberId AND public_key = @publicKey`
    )
    .get({ shareId, memberId, publicKey }) as { person: string } | undefined
  return row?.person ?? null
}

/**
 * Whether a person is or was an Owner of the share: a key change read late may be
 * signed by an Owner who has been demoted since (D1).
 */
export function wasOwner(db: Database.Database, shareId: string, personKey: string): boolean {
  if (isOwner(db, shareId, personKey)) return true
  return (
    db
      .prepare(
        `SELECT 1 FROM sync_role_files
         WHERE share_id = @shareId AND person_public_key = @personKey AND applied = 1
           AND (role = 'owner' OR previous_role = 'owner')`
      )
      .get({ shareId, personKey }) !== undefined
  )
}

function shareRowOf(db: Database.Database, projectId: string): ShareRow | null {
  return (
    (db
      .prepare(
        'SELECT share_id, member_id, device_id FROM sync_shares WHERE project_id = @projectId'
      )
      .get({ projectId }) as ShareRow | undefined) ?? null
  )
}

function cutoffsOf(text: string | null): Record<string, number> {
  if (!text) return {}
  try {
    return (JSON.parse(text) as Record<string, number>) ?? {}
  } catch {
    return {}
  }
}

function grantBody(
  shareId: string,
  role: ShareRole,
  inviteId: string,
  invitePublicKey: string | undefined
): string {
  // Version 1 (no invite key) still verifies, but has no proof, so it gives Viewer.
  return invitePublicKey === undefined
    ? JSON.stringify({ v: 1, shareId, role, inviteId })
    : JSON.stringify({ v: 2, shareId, role, inviteId, invitePublicKey })
}

function proofBody(shareId: string, inviteId: string, personPublicKey: string): string {
  return JSON.stringify({ v: 1, shareId, inviteId, personPublicKey })
}

function parseRoleHeader(header: Record<string, unknown>): RoleHeader {
  if (
    header.formatVersion !== 1 ||
    typeof header.shareId !== 'string' ||
    typeof header.memberId !== 'string' ||
    typeof header.publicKey !== 'string'
  ) {
    throw new RoleFileError('not-a-change-file')
  }
  return { shareId: header.shareId, memberId: header.memberId, publicKey: header.publicKey }
}

function parseRolePayload(value: unknown): RolePayload | null {
  if (typeof value !== 'object' || value === null) return null
  const { personPublicKey, role, previousRole, cutoffs } = value as Record<string, unknown>
  if (typeof personPublicKey !== 'string' || !isRole(role)) return null
  if (previousRole !== null && previousRole !== undefined && !isRole(previousRole)) return null
  if (typeof cutoffs !== 'object' || cutoffs === null || Array.isArray(cutoffs)) return null
  if (!Object.values(cutoffs).every((n) => typeof n === 'number' && Number.isSafeInteger(n))) {
    return null
  }
  return {
    person: personPublicKey,
    role,
    previousRole: (previousRole as ShareRole | null | undefined) ?? null,
    cutoffs: cutoffs as Record<string, number>
  }
}

function isRole(value: unknown): value is ShareRole {
  return typeof value === 'string' && ROLES.includes(value as ShareRole)
}
