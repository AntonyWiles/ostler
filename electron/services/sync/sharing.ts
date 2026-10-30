/**
 * Sharing a project through a folder, and joining one from an invite
 * (docs/plans/integrations/shared-folder-sync.md, "Joining and catching up", S7c).
 *
 * The folder holds `share.json` (`{ formatVersion, shareId, projectId }`, not
 * secret), one `members/<member id>.ostlermember` per member, `snapshots/` and
 * `changes/`. A member file is a sealed envelope (envelope.ts) whose plain header
 * carries the member's public key; it is signed with that key and encrypted with
 * the project key, so only someone holding the invite can add a member
 * (decision 2: anyone with the invite is an editor).
 *
 * The invite is `ostler-invite:1:` plus base64url JSON `{ shareId, projectId,
 * projectKey, generation, previousKeys }`: the current key, its generation and
 * every older one, so a new member can read files from before a removal (S7d;
 * the last two are absent while no one has been removed), and `location`, the
 * server space, when the project is shared through a sync server (phase 7), so
 * the person joining needs no folder. It is a secret: it goes to the clipboard, never to a log or the
 * renderer. This module only touches the database and the folder; the project's
 * entry in the config store (name, colour, no folder) is made by the caller from
 * what `joinShare` returns.
 */
import { createHash, randomUUID, path } from './platform'
import { initialsFromName } from '@shared/people'
import { paletteColorFor } from '@shared/project-colors'
import type Database from 'better-sqlite3'
import type { ShareRole } from '@shared/ostler-api/sharing-types'
import { newDeviceId } from '@shared/sync/clock'
import { INVITE_PREFIX } from '@shared/deep-link'
import { withSyncApplying } from './capture'
import { newProjectKey } from './change-file'
import {
  openEnvelope,
  PROJECT_KEY_BYTES,
  sealEnvelope,
  type EnvelopeKind,
  type KeySource
} from './envelope'
import { SyncTransportError } from './transport-paths'
import type { SyncTransport } from './folder-transport'
import { driveLocation, isDriveLocation, parseDriveLocation } from './drive-transport'
import { type SnapshotProject } from './snapshot-file'
import { loadSnapshot, readSnapshotFile, snapshotsNewestFirst, writeSnapshot } from './snapshots'
import { newerGeneration, refreshKeys, unreadRoster } from './rotation'
import {
  boxKeys,
  identityKeys,
  keyGenerationOf,
  personKeys,
  projectKeyFor,
  projectKeyring,
  storeProjectKey,
  thisDeviceCertificate,
  verifyDeviceCertificate,
  type DeviceCertificate
} from './sync-keys'
import { pullChanges, type PullResult } from './sync-runner'
import {
  assignGrantedRole,
  grantOf,
  inviteKeyFor,
  recordedRole,
  recordFounder,
  recordMyRole,
  refreshRoles,
  seedFounder,
  signGrant,
  signGrantProof,
  type Grant
} from './roles'

export const SHARE_FORMAT_VERSION = 1
const MEMBER_PATTERN = /^members\/([A-Za-z0-9-]+)\.ostlermember$/

export interface Invite {
  shareId: string
  projectId: string
  /** The current key and its generation (0 until someone is removed). */
  projectKey: Buffer
  generation: number
  /** Generations 0 to `generation - 1`, in order. */
  previousKeys: Buffer[]
  /** The sync server space it is shared through; absent for a folder. */
  location?: string
  /** The founder's person public key (D6); absent for an invite from before roles. */
  founder?: string
  /** The role the joiner gets, signed by an Owner (D8); absent for an invite from before roles. */
  grant?: Grant
  /**
   * The grant's invite private key (PKCS8 DER, base64): the joiner signs its person key with it
   * to prove the grant is its own (roles.ts). A secret, like `projectKey`.
   */
  invitePrivateKey?: string
}

/** A share kept on a sync server: its `folder` is the space's https address. */
export function isServerLocation(folder: string): boolean {
  return /^https?:\/\//i.test(folder)
}

/**
 * A place inside another place: a Drive place extends its sub-path, a folder is joined with the
 * path rules of this PC. A sync server space is refused (the personal space is never on a server).
 */
export function joinPlace(place: string, child: string): string {
  if (isDriveLocation(place)) {
    const { folderId, subPath } = parseDriveLocation(place)
    return driveLocation(folderId, subPath === '' ? child : `${subPath}/${child}`)
  }
  if (isServerLocation(place)) throw new SharingError('not-an-invite')
  return path.join(place, child)
}

/** The place that holds `place` (`path.dirname` for a folder); a Drive folder with no sub-path is returned as it is. */
export function parentPlace(place: string): string {
  if (isDriveLocation(place)) {
    const { folderId, subPath } = parseDriveLocation(place)
    return driveLocation(folderId, subPath.split('/').filter(Boolean).slice(0, -1).join('/'))
  }
  return path.dirname(place)
}

/** A share kept somewhere other than a folder on this PC: a sync server space or a Drive folder. */
export function isSharedPlace(folder: string): boolean {
  return isServerLocation(folder) || isDriveLocation(folder)
}

export interface MemberProblem {
  path: string
  reason: string
}

/** This PC's Me person, sent with its member file so the others can show who it is. */
export interface MePerson {
  personId: string
  name: string
  initials: string
  color: string
}

export interface JoinResult {
  projectId: string
  /** The project's own settings from the newest snapshot; null when it has none. */
  project: SnapshotProject | null
  pulled: PullResult
}

export class SharingError extends Error {
  constructor(
    readonly reason:
      | 'already-shared'
      | 'not-an-invite'
      | 'wrong-folder'
      | 'not-a-share-folder'
      | 'no-snapshot'
      | 'old-invite'
      | 'invite-does-not-fit'
      | 'no-sync-server'
      | 'no-drive-account'
      | 'cannot-write-folder'
  ) {
    super(`Sharing refused: ${reason}`)
    this.name = 'SharingError'
  }
}

class MemberFileError extends Error {
  constructor(readonly reason: string) {
    super(`Member file refused: ${reason}`)
  }
}

export const MEMBER_FILE: EnvelopeKind = {
  magic: Buffer.from('OSTLERMB', 'ascii'),
  version: 1,
  maxBytes: 64 * 1024,
  refuse: (reason) => {
    throw new MemberFileError(reason)
  }
}

interface MemberHeader {
  shareId: string
  memberId: string
  publicKey: string
}

/**
 * Starts sharing a project through `folder` (already opened as `transport`):
 * writes this PC's share, member and first snapshot, and returns the invite.
 */
export async function shareProject(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string,
  options: { folder: string; memberName: string; project: SnapshotProject; me?: MePerson | null }
): Promise<string> {
  if (db.prepare('SELECT 1 FROM sync_shares WHERE project_id = @projectId').get({ projectId })) {
    throw new SharingError('already-shared')
  }
  if ((await transport.list('')).includes('share.json')) throw new SharingError('wrong-folder')

  const invite: Invite = {
    shareId: randomUUID(),
    projectId,
    projectKey: newProjectKey(),
    generation: 0,
    previousKeys: []
  }
  const memberId = randomUUID()
  insertShare(db, invite, options.folder, memberId)

  // All or nothing: a share that stops partway is forgotten, so the project is as it was.
  try {
    await transport.writeOnce(
      'share.json',
      Buffer.from(
        JSON.stringify({
          formatVersion: SHARE_FORMAT_VERSION,
          shareId: invite.shareId,
          projectId
        }),
        'utf8'
      )
    )
    await writeMember(db, transport, invite, memberId, options.memberName, options.me ?? null)
    // The first Owner: this PC, whose first role change later joiners read (D6).
    await recordFounder(db, transport, projectId)
    recordMyRole(db, invite.shareId)
    await writeSnapshot(
      db,
      transport,
      projectId,
      { projectKey: invite.projectKey, privateKey: identityKeys(db).privateKey },
      options.project
    )
    // The whole project is in the folder now: it is in step.
    markSynced(db, projectId)
    // The founder's own invite: an Editor, with the founder named so joiners know the Owner (D6, D8).
    return formatInvite({
      ...invite,
      founder: personKeys(db).publicKey,
      grant: signGrant(db, invite.shareId, 'editor'),
      invitePrivateKey: inviteKeyFor(db, invite.shareId, 'editor').privateKey
    })
  } catch (error) {
    forgetShare(db, projectId)
    throw error
  }
}

/**
 * The invite for a project this PC shares, giving the joiner `role` (an Editor
 * by default). Null when it isn't shared, or when this PC's person is neither an
 * Owner nor an Editor (D1, D13). A secret: never log it.
 */
export function inviteFor(
  db: Database.Database,
  projectId: string,
  role: Exclude<ShareRole, 'owner'> = 'editor'
): string | null {
  const share = db
    .prepare('SELECT share_id, folder FROM sync_shares WHERE project_id = @projectId')
    .get({ projectId }) as { share_id: string; folder: string } | undefined
  const projectKey = projectKeyFor(db, projectId)
  if (!share || !projectKey) return null
  const myRole = recordedRole(db, share.share_id, personKeys(db).publicKey)
  if (myRole !== 'owner' && myRole !== 'editor') return null
  const generation = keyGenerationOf(db, projectId)
  const keyring = projectKeyring(db, projectId)
  const previousKeys: Buffer[] = []
  for (let older = 0; older < generation; older++) {
    const key = keyring(older)
    if (!key) return null
    previousKeys.push(key)
  }
  return formatInvite({
    shareId: share.share_id,
    projectId,
    projectKey,
    generation,
    previousKeys,
    ...(isSharedPlace(share.folder) ? { location: share.folder } : {}),
    ...founderField(db, share.share_id),
    grant: signGrant(db, share.share_id, role),
    invitePrivateKey: inviteKeyFor(db, share.share_id, role).privateKey
  })
}

/**
 * The founder of a share as this PC knows it: the person of its first role
 * change, which has no role before it. Empty for a share from before roles.
 */
function founderField(db: Database.Database, shareId: string): { founder?: string } {
  const row = db
    .prepare(
      `SELECT person_public_key FROM sync_role_files
       WHERE share_id = @shareId AND applied = 1 AND previous_role IS NULL
       ORDER BY stamp LIMIT 1`
    )
    .get({ shareId }) as { person_public_key: string | null } | undefined
  return row?.person_public_key ? { founder: row.person_public_key } : {}
}

/**
 * Joins a shared project from an invite, through `folder` (already opened as
 * `transport`): adds this PC as a member, loads the newest snapshot and pulls.
 */
export async function joinShare(
  db: Database.Database,
  transport: SyncTransport,
  inviteText: string,
  options: { folder: string; memberName: string; me?: MePerson | null }
): Promise<JoinResult> {
  const invite = parseInvite(inviteText)
  const share = await readShareFile(transport)
  if (share.shareId !== invite.shareId || share.projectId !== invite.projectId) {
    throw new SharingError('wrong-folder')
  }
  if (
    db
      .prepare('SELECT 1 FROM sync_shares WHERE project_id = @projectId')
      .get({ projectId: invite.projectId })
  ) {
    throw new SharingError('already-shared')
  }

  // Someone was removed after this invite was copied: it no longer lets anyone in.
  if (await newerGeneration(transport, invite.generation)) throw new SharingError('old-invite')

  const memberId = randomUUID()
  insertShare(db, invite, options.folder, memberId)
  // All or nothing until the project has arrived: a join that stops before then is forgotten.
  let snapshot: Awaited<ReturnType<typeof readSnapshotFile>> | null = null
  let keyring: ReturnType<typeof projectKeyring>
  try {
    // The founder is an Owner before anything is read, so the grants and the first role change can be checked.
    if (invite.founder) seedFounder(db, invite.shareId, invite.founder)
    // Key changes first: they name the members from before them, whose own files use an older key.
    // A key change signed by an Owner made after the founder is read once roles are known, so
    // keys, members and roles go round twice. A grant can be signed by an Owner who was only
    // just read: members again at the end.
    for (let round = 0; round < 2; round++) {
      await refreshKeys(db, transport, invite.projectId)
      const keys = projectKeyring(db, invite.projectId)
      await refreshMembers(db, transport, invite.shareId, keys)
      await refreshRoles(db, transport, invite.shareId, keys)
    }
    keyring = projectKeyring(db, invite.projectId)
    const members = await refreshMembers(db, transport, invite.shareId, keyring)
    // Member files are here but the invite's key opens none: no amount of waiting will help.
    if (
      members.members === 0 &&
      members.problems.some((problem) => problem.reason === 'cannot-decrypt')
    ) {
      throw new SharingError('invite-does-not-fit')
    }

    // The newest one this PC can trust: one from a removed member, or half-synced, is passed over.
    for (const path of await snapshotsNewestFirst(transport)) {
      try {
        snapshot = await readSnapshotFile(db, transport, invite.shareId, path, keyring)
        break
      } catch {
        continue
      }
    }
    if (!snapshot) throw new SharingError('no-snapshot')

    // Only now, with the project read, does this PC add itself to the folder: a join refused
    // above (a wrong key, or a folder still syncing) leaves no member file for the others to
    // trip over. Members and roles once more, so this PC's own grant gives it its role.
    await writeMember(
      db,
      transport,
      invite,
      memberId,
      options.memberName,
      options.me ?? null,
      invite.grant
    )
    await refreshMembers(db, transport, invite.shareId, keyring)
    await refreshRoles(db, transport, invite.shareId, keyring)

    // The project arrives here: a join whose snapshot or first pull fails is forgotten too, so
    // it is tried again from the start instead of staying a share that never syncs.
    loadSnapshot(db, invite.projectId, snapshot)
    const pulled = await pullChanges(db, transport, invite.projectId, { projectKey: keyring })
    markSynced(db, invite.projectId)
    return { projectId: invite.projectId, project: snapshot.project ?? null, pulled }
  } catch (error) {
    forgetShare(db, invite.projectId)
    throw error
  }
}

/**
 * Reads every member file and records the members in `sync_members`, so their
 * change files can be checked. Runs before every pull.
 *
 * Once someone has been removed, a member this PC doesn't know yet is only
 * taken from a file sealed with the current key: an old invite, which the
 * removed member still has, adds no one. Members from before the removal
 * arrive with the new key's file instead (rotation.ts).
 */
export async function refreshMembers(
  db: Database.Database,
  transport: SyncTransport,
  shareId: string,
  projectKey: KeySource
): Promise<{ members: number; problems: MemberProblem[] }> {
  const upsert = db.prepare(
    `INSERT INTO sync_members (share_id, member_id, person_id, name, public_key, box_public_key, joined_at, person_public_key, certificate, me)
     VALUES (@shareId, @memberId, NULL, @name, @publicKey, @boxPublicKey, @joinedAt, @personPublicKey, @certificate, @me)
     ON CONFLICT(share_id, member_id) DO UPDATE SET name = excluded.name, joined_at = excluded.joined_at,
       box_public_key = COALESCE(excluded.box_public_key, sync_members.box_public_key),
       person_public_key = excluded.person_public_key, certificate = excluded.certificate, me = excluded.me
     WHERE sync_members.public_key = excluded.public_key`
  )
  const known = db.prepare(
    'SELECT 1 FROM sync_members WHERE share_id = @shareId AND member_id = @memberId'
  )
  const current =
    (
      db.prepare('SELECT key_generation FROM sync_shares WHERE share_id = @shareId').get({
        shareId
      }) as { key_generation: number } | undefined
    )?.key_generation ?? 0
  const personal =
    (
      db.prepare('SELECT kind FROM sync_shares WHERE share_id = @shareId').get({ shareId }) as
        { kind: string } | undefined
    )?.kind === 'personal'
  const ownPublicKey = identityKeys(db).publicKey
  // Members named by key changes not read yet; looked up only when an older file needs it.
  let roster: Set<string> | null = null
  const problems: MemberProblem[] = []
  // A person's role comes from the grant on their first device (the one that joined first). A new
  // device of an existing person carries the grant of the invite it joined with, not the role (D8).
  const firstGrants = new Map<string, { joinedAt: number; grant: unknown; proof: unknown }>()
  let members = 0
  for (const relativePath of await transport.list('members')) {
    const match = MEMBER_PATTERN.exec(relativePath)
    if (!match) continue
    try {
      // A member file is signed with the key its own header names; the project key proves it is from a member.
      let named: MemberHeader | null = null
      const { header, payload, keyGeneration } = openEnvelope(
        MEMBER_FILE,
        await transport.read(relativePath),
        { projectKey, publicKeyFor: () => named?.publicKey ?? null },
        (raw) => (named = parseMemberHeader(raw))
      )
      if (header.shareId !== shareId || header.memberId !== match[1]) {
        problems.push({ path: relativePath, reason: 'mismatch' })
        continue
      }
      const { name, joinedAt, boxPublicKey, personPublicKey, certificate, me, grant, grantProof } =
        payload as {
          name?: unknown
          joinedAt?: unknown
          boxPublicKey?: unknown
          personPublicKey?: unknown
          certificate?: unknown
          me?: unknown
          grant?: unknown
          grantProof?: unknown
        }
      if (
        typeof name !== 'string' ||
        typeof joinedAt !== 'number' ||
        (boxPublicKey !== undefined && typeof boxPublicKey !== 'string')
      ) {
        problems.push({ path: relativePath, reason: 'not-a-change-file' })
        continue
      }
      if (keyGeneration < current && !known.get({ shareId, memberId: header.memberId })) {
        roster ??= await rosterOf(db, transport, shareId)
        if (!roster.has(`${header.memberId} ${header.publicKey}`)) {
          problems.push({ path: relativePath, reason: 'old-invite' })
          continue
        }
      }
      // A device counts as one person's only with a certificate from that person's key
      // that names this device's key. Otherwise it is a person of its own (D5).
      const hasPersonFields = personPublicKey !== undefined || certificate !== undefined
      const verified = hasPersonFields
        ? certificateFor(header.publicKey, personPublicKey, certificate)
        : null
      // The personal share holds only this person's devices (D13): anything else is not one.
      if (personal && verified?.personPublicKey !== personKeys(db).publicKey) {
        problems.push({ path: relativePath, reason: 'not-this-person' })
        continue
      }
      if (hasPersonFields && !verified) {
        problems.push({ path: relativePath, reason: 'bad-certificate' })
      }
      const verifiedMe = verified ? meOf(me) : null
      upsert.run({
        shareId,
        memberId: header.memberId,
        name,
        publicKey: header.publicKey,
        boxPublicKey: boxPublicKey ?? null,
        joinedAt,
        personPublicKey: verified ? (personPublicKey as string) : header.publicKey,
        certificate: verified ? JSON.stringify(verified) : null,
        me: verifiedMe ? JSON.stringify(verifiedMe) : null
      })
      const person = verified ? (personPublicKey as string) : header.publicKey
      if (verifiedMe) linkMemberPerson(db, shareId, header.memberId, verifiedMe)
      // This PC's own member is Me here, whatever its file says.
      else if (!personal && header.publicKey !== ownPublicKey) {
        ensureMemberPerson(db, shareId, header.memberId, person, name)
      }
      const first = firstGrants.get(person)
      if (!first || joinedAt < first.joinedAt) {
        firstGrants.set(person, { joinedAt, grant, proof: grantProof })
      }
      members++
    } catch (error) {
      if (error instanceof MemberFileError) {
        problems.push({ path: relativePath, reason: error.reason })
        continue
      }
      problems.push({ path: relativePath, reason: 'unreadable' })
    }
  }
  for (const [person, { grant, proof }] of firstGrants) {
    assignGrantedRole(db, shareId, person, grant, proof)
  }
  return { members, problems }
}

/**
 * The person of one member file, read straight from the folder: for a key change
 * signed by a member this PC has not recorded, such as one from before the key a
 * new PC joined with (rotation.ts). Null when the file is missing, is not that
 * member's with that device key, or its certificate does not verify.
 */
export async function personOfMemberFile(
  transport: SyncTransport,
  shareId: string,
  memberId: string,
  publicKey: string,
  projectKey: KeySource
): Promise<string | null> {
  if (!/^[A-Za-z0-9-]+$/.test(memberId)) return null
  try {
    let named: MemberHeader | null = null
    const { header, payload } = openEnvelope(
      MEMBER_FILE,
      await transport.read(`members/${memberId}.ostlermember`),
      { projectKey, publicKeyFor: () => named?.publicKey ?? null },
      (raw) => (named = parseMemberHeader(raw))
    )
    if (header.shareId !== shareId || header.memberId !== memberId) return null
    if (header.publicKey !== publicKey) return null
    const { personPublicKey, certificate } = payload as Record<string, unknown>
    if (personPublicKey === undefined && certificate === undefined) return header.publicKey
    return certificateFor(header.publicKey, personPublicKey, certificate)?.personPublicKey ?? null
  } catch {
    return null
  }
}

async function rosterOf(
  db: Database.Database,
  transport: SyncTransport,
  shareId: string
): Promise<Set<string>> {
  const share = db
    .prepare('SELECT project_id FROM sync_shares WHERE share_id = @shareId')
    .get({ shareId }) as { project_id: string } | undefined
  return share ? unreadRoster(db, transport, share.project_id) : new Set()
}

export function formatInvite(invite: Invite): string {
  return (
    INVITE_PREFIX +
    Buffer.from(
      JSON.stringify({
        shareId: invite.shareId,
        projectId: invite.projectId,
        projectKey: invite.projectKey.toString('base64'),
        ...(invite.generation > 0
          ? {
              generation: invite.generation,
              previousKeys: invite.previousKeys.map((key) => key.toString('base64'))
            }
          : {}),
        ...(invite.location ? { location: invite.location } : {}),
        ...(invite.founder ? { founder: invite.founder } : {}),
        ...(invite.grant ? { grant: invite.grant } : {}),
        ...(invite.invitePrivateKey ? { invitePrivateKey: invite.invitePrivateKey } : {})
      }),
      'utf8'
    ).toString('base64url')
  )
}

export function parseInvite(text: string): Invite {
  const trimmed = text.trim()
  if (!trimmed.startsWith(INVITE_PREFIX)) throw new SharingError('not-an-invite')
  let parsed: unknown
  try {
    parsed = JSON.parse(
      Buffer.from(trimmed.slice(INVITE_PREFIX.length), 'base64url').toString('utf8')
    )
  } catch {
    throw new SharingError('not-an-invite')
  }
  const {
    shareId,
    projectId,
    projectKey,
    generation,
    previousKeys,
    location,
    founder,
    grant,
    invitePrivateKey
  } = (parsed ?? {}) as Record<string, unknown>
  const olderKeys = previousKeys ?? []
  const keyGeneration = generation ?? 0
  if (
    typeof shareId !== 'string' ||
    typeof projectId !== 'string' ||
    typeof projectKey !== 'string' ||
    typeof keyGeneration !== 'number' ||
    !Number.isSafeInteger(keyGeneration) ||
    keyGeneration < 0 ||
    !Array.isArray(olderKeys) ||
    olderKeys.length !== keyGeneration ||
    !olderKeys.every((key) => typeof key === 'string') ||
    (location !== undefined && !locationFits(location)) ||
    (invitePrivateKey !== undefined && typeof invitePrivateKey !== 'string')
  ) {
    throw new SharingError('not-an-invite')
  }
  const keys = [...(olderKeys as string[]), projectKey].map((key) => Buffer.from(key, 'base64'))
  if (keys.some((key) => key.length !== PROJECT_KEY_BYTES)) throw new SharingError('not-an-invite')
  // A grant that is malformed is dropped: the joiner then gets Viewer, as one with none does.
  const validGrant = grantOf(grant)
  return {
    shareId,
    projectId,
    projectKey: keys[keys.length - 1],
    generation: keyGeneration,
    previousKeys: keys.slice(0, -1),
    ...(typeof location === 'string' ? { location } : {}),
    ...(typeof founder === 'string' ? { founder } : {}),
    ...(validGrant ? { grant: validGrant } : {}),
    ...(typeof invitePrivateKey === 'string' ? { invitePrivateKey } : {})
  }
}

/**
 * A Drive place, or an https space address with no user name or password (http only on this
 * computer).
 */
function locationFits(location: unknown): location is string {
  if (typeof location !== 'string' || location.length > 2048) return false
  if (isDriveLocation(location)) return true
  try {
    const url = new URL(location)
    if (url.username || url.password || url.search || url.hash) return false
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

/** `share.json` of a shared folder. */
export async function readShareFile(
  transport: SyncTransport
): Promise<{ shareId: string; projectId: string }> {
  let text: string
  try {
    text = (await transport.read('share.json')).toString('utf8')
  } catch {
    throw new SharingError('not-a-share-folder')
  }
  const share = shareFileFrom(text)
  if (!share) throw new SharingError('not-a-share-folder')
  return share
}

/**
 * The ids in a `share.json`'s text, or null when it is not one. Shared by reading a
 * folder here and finding one on this PC (`share-folder-finder.ts`).
 */
export function shareFileFrom(text: string): { shareId: string; projectId: string } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const { formatVersion, shareId, projectId } = (parsed ?? {}) as Record<string, unknown>
  if (
    formatVersion !== SHARE_FORMAT_VERSION ||
    typeof shareId !== 'string' ||
    typeof projectId !== 'string'
  ) {
    return null
  }
  return { shareId, projectId }
}

function insertShare(
  db: Database.Database,
  invite: Invite,
  folder: string,
  memberId: string
): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at)
       VALUES (@projectId, @shareId, @folder, @memberId, @deviceId, @formatVersion, @createdAt)`
    ).run({
      projectId: invite.projectId,
      shareId: invite.shareId,
      folder,
      memberId,
      deviceId: newDeviceId(),
      formatVersion: SHARE_FORMAT_VERSION,
      createdAt: Date.now()
    })
    invite.previousKeys.forEach((key, generation) => {
      storeProjectKey(db, invite.projectId, key, generation)
    })
    storeProjectKey(db, invite.projectId, invite.projectKey, invite.generation)
    // No role is recorded yet, so the share is not this PC's to manage until one is.
    recordMyRole(db, invite.shareId)
  })()
}

/** Tables that hold a share's rows by `share_id`, and by `project_id`. */
const SHARE_TABLES = [
  'sync_members',
  'sync_applied',
  'sync_pending',
  'sync_records',
  'sync_keys',
  'sync_roles',
  'sync_role_files',
  'sync_person_link_answers'
] as const
const SHARE_PROJECT_TABLES = ['sync_outbox', 'sync_field_stamps', 'sync_shares'] as const

/**
 * Forgets this PC's share of a project: every row the share kept here. The project itself
 * stays, and nothing in the shared folder changes. Used to stop sharing, and to undo a
 * share or join that stopped partway.
 */
export function forgetShare(db: Database.Database, projectId: string): void {
  const share = db
    .prepare('SELECT share_id FROM sync_shares WHERE project_id = @projectId')
    .get({ projectId }) as { share_id: string } | undefined
  if (!share) return
  db.transaction(() => {
    for (const table of SHARE_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE share_id = @shareId`).run({ shareId: share.share_id })
    }
    for (const table of SHARE_PROJECT_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE project_id = @projectId`).run({ projectId })
    }
  })()
}

/**
 * Forgets the shares that never finished: ones with no member row for this PC, which
 * sharing, joining and the personal space all write before they are done. Such a share
 * can never sync or be managed. Returns the projects it was for.
 */
export function forgetUnfinishedShares(db: Database.Database): string[] {
  const unfinished = db
    .prepare(
      `SELECT s.project_id FROM sync_shares AS s
       WHERE NOT EXISTS (
         SELECT 1 FROM sync_members AS m
         WHERE m.share_id = s.share_id AND m.member_id = s.member_id
       )`
    )
    .all() as { project_id: string }[]
  for (const { project_id } of unfinished) forgetShare(db, project_id)
  return unfinished.map((row) => row.project_id)
}

/** Records that a project's share is in step with its folder now. */
function markSynced(db: Database.Database, projectId: string): void {
  db.prepare('UPDATE sync_shares SET last_synced_at = @now WHERE project_id = @projectId').run({
    now: Date.now(),
    projectId
  })
}

/**
 * Writes this PC's member file into a share and records the member here. Shared by
 * sharing a project, joining one and the personal share (personal-space.ts).
 */
export async function writeMember(
  db: Database.Database,
  transport: SyncTransport,
  invite: Invite,
  memberId: string,
  name: string,
  me: MePerson | null,
  grant?: Grant
): Promise<void> {
  const identity = identityKeys(db)
  const boxPublicKey = boxKeys(db).publicKey
  const joinedAt = Date.now()
  const certificate = thisDeviceCertificate(db, name)
  const personPublicKey = personKeys(db).publicKey
  // Proves the grant was given to this person (roles.ts); the invite private key itself stays here.
  const grantProof =
    grant && invite.invitePrivateKey
      ? signGrantProof(invite.shareId, grant.inviteId, personPublicKey, invite.invitePrivateKey)
      : undefined
  const bytes = sealEnvelope(
    MEMBER_FILE,
    { formatVersion: 1, shareId: invite.shareId, memberId, publicKey: identity.publicKey },
    { name, joinedAt, boxPublicKey, personPublicKey, certificate, me, grant, grantProof },
    {
      projectKey: invite.projectKey,
      keyGeneration: invite.generation,
      privateKey: identity.privateKey
    }
  )
  try {
    await transport.writeOnce(`members/${memberId}.ostlermember`, bytes)
  } catch (error) {
    if (!(error instanceof SyncTransportError && error.reason === 'exists')) throw error
  }
  db.prepare(
    `INSERT OR REPLACE INTO sync_members (share_id, member_id, person_id, name, public_key, box_public_key, joined_at, person_public_key, certificate, me)
     VALUES (@shareId, @memberId, NULL, @name, @publicKey, @boxPublicKey, @joinedAt, @personPublicKey, @certificate, @me)`
  ).run({
    shareId: invite.shareId,
    memberId,
    name,
    publicKey: identity.publicKey,
    boxPublicKey,
    joinedAt,
    personPublicKey,
    certificate: JSON.stringify(certificate),
    me: me ? JSON.stringify(me) : null
  })
}

/** The certificate, when it is from `personPublicKey` and names this device's key; else null. Never throws. */
function certificateFor(
  devicePublicKey: string,
  personPublicKey: unknown,
  certificate: unknown
): DeviceCertificate | null {
  const verified = verifyDeviceCertificate(certificate)
  if (!verified || typeof personPublicKey !== 'string') return null
  if (verified.devicePublicKey !== devicePublicKey) return null
  if (verified.personPublicKey !== personPublicKey) return null
  return verified
}

/** The Me card from a member file, when it has the four fields as text; else null. */
/**
 * Makes the member's Me person known on this PC (D12): a person row for it when
 * none has its id, not Me and not archived, and `sync_members.person_id` naming
 * it. The row is written as a change from another PC, so it is not captured.
 */
function linkMemberPerson(
  db: Database.Database,
  shareId: string,
  memberId: string,
  me: MePerson
): void {
  const known = db.prepare('SELECT 1 FROM people WHERE id = @id').get({ id: me.personId })
  if (!known) {
    const now = Date.now()
    withSyncApplying(() =>
      db
        .prepare(
          `INSERT INTO people (id, name, initials, color, is_me, archived_at, created_at, updated_at)
           VALUES (@id, @name, @initials, @color, 0, NULL, @now, @now)`
        )
        .run({ id: me.personId, name: me.name, initials: me.initials, color: me.color, now })
    )
  }
  db.prepare(
    'UPDATE sync_members SET person_id = @personId WHERE share_id = @shareId AND member_id = @memberId'
  ).run({ personId: me.personId, shareId, memberId })
}

/**
 * Gives a member with no Me card (an Ostler from before Me cards, or no person certificate) a
 * person of their own all the same, so they can be assigned work and show in People. Its id comes
 * from their person key, so every PC in the share makes the same person, and the work assigned to
 * it on one PC names the same person on the others. A member already linked keeps their person.
 */
function ensureMemberPerson(
  db: Database.Database,
  shareId: string,
  memberId: string,
  personKey: string,
  name: string
): void {
  const linked = db
    .prepare(
      'SELECT person_id FROM sync_members WHERE share_id = @shareId AND member_id = @memberId'
    )
    .get({ shareId, memberId }) as { person_id: string | null } | undefined
  if (linked?.person_id) return
  const personId = memberPersonId(personKey)
  const shown = name.trim() || 'Ostler user'
  linkMemberPerson(db, shareId, memberId, {
    personId,
    name: shown,
    initials: initialsFromName(shown),
    color: paletteColorFor(personId)
  })
}

/** The person id for a member with no Me card: the same on every PC, as a UUID made from their person key. */
export function memberPersonId(personKey: string): string {
  const hex = createHash('sha256').update(`ostler-member-person:${personKey}`).digest('hex')
  // Shaped as a version 8 (custom) UUID, like the other ids in the people table.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hex.slice(18, 20),
    hex.slice(20, 32)
  ].join('-')
}

function meOf(value: unknown): MePerson | null {
  if (!value || typeof value !== 'object') return null
  const me = value as Record<string, unknown>
  if (
    typeof me.personId !== 'string' ||
    typeof me.name !== 'string' ||
    typeof me.initials !== 'string' ||
    typeof me.color !== 'string'
  ) {
    return null
  }
  return { personId: me.personId, name: me.name, initials: me.initials, color: me.color }
}

function parseMemberHeader(header: Record<string, unknown>): MemberHeader {
  if (
    header.formatVersion !== 1 ||
    typeof header.shareId !== 'string' ||
    typeof header.memberId !== 'string' ||
    typeof header.publicKey !== 'string'
  ) {
    throw new MemberFileError('not-a-change-file')
  }
  return { shareId: header.shareId, memberId: header.memberId, publicKey: header.publicKey }
}
