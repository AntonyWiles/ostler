/**
 * Which newer sharing features each PC in a shared project understands. Every PC writes a
 * capabilities note (`capabilities/<memberId>-v<version>.ostlercaps`), sealed with the project key
 * and signed with the device's key, once per version of the list. The others read them back and
 * work out which features every member's PC has, so an Owner can use a feature (such as the
 * Contributor role) only when no member's older Ostler would read it differently.
 *
 * Why not the member file: it is written once, when a PC joins (`writeMember`), so a member who
 * joined before a feature existed could never add a field to theirs. A note per version can be
 * written at any time. A PC with no note advertises nothing, so one old PC empties the shared list.
 */
import type Database from 'better-sqlite3'
import { CAPABILITIES_VERSION, MY_SHARE_CAPABILITIES } from '../../../src/shared/share-capabilities'
import {
  openEnvelope,
  sealEnvelope,
  type EnvelopeKind,
  type KeySource,
  type SealKeys
} from './envelope'
import { SyncTransportError, type SyncTransport } from './folder-transport'

class CapabilitiesFileError extends Error {
  constructor(readonly reason: string) {
    super(`Capabilities note refused: ${reason}`)
    this.name = 'CapabilitiesFileError'
  }
}

const CAPABILITIES_FILE: EnvelopeKind = {
  magic: Buffer.from('OSTLERCP', 'ascii'),
  version: 1,
  maxBytes: 64 * 1024,
  refuse: (reason) => {
    throw new CapabilitiesFileError(reason)
  }
}

const CAPABILITIES_PATH = /^capabilities\/(.+)-v(\d+)\.ostlercaps$/

export interface CapabilitiesProblem {
  path: string
  reason: string
}

/** Writes this device's capabilities note for the current version. One already there stays. */
export async function writeMyCapabilities(
  db: Database.Database,
  transport: SyncTransport,
  shareId: string,
  keys: SealKeys
): Promise<void> {
  const row = db
    .prepare('SELECT member_id FROM sync_shares WHERE share_id = @shareId')
    .get({ shareId }) as { member_id: string } | undefined
  if (!row) return
  const bytes = sealEnvelope(
    CAPABILITIES_FILE,
    { formatVersion: 1, shareId, memberId: row.member_id },
    { capabilities: [...MY_SHARE_CAPABILITIES], writtenAt: Date.now() },
    keys
  )
  try {
    await transport.writeOnce(
      `capabilities/${row.member_id}-v${CAPABILITIES_VERSION}.ostlercaps`,
      bytes
    )
  } catch (error) {
    if (!(error instanceof SyncTransportError && error.reason === 'exists')) throw error
  }
}

/**
 * Reads the capabilities notes of the members this PC knows, keeping the highest version read
 * per member. Runs after `refreshMembers`, which knows the signers. Returns how many were stored.
 */
export async function refreshCapabilities(
  db: Database.Database,
  transport: SyncTransport,
  shareId: string,
  projectKey: KeySource
): Promise<{ read: number; problems: CapabilitiesProblem[] }> {
  const member = db.prepare(
    'SELECT public_key FROM sync_members WHERE share_id = @shareId AND member_id = @memberId'
  )
  const stored = db.prepare(
    'SELECT version FROM sync_member_capabilities WHERE share_id = @shareId AND member_id = @memberId'
  )
  const store = db.prepare(
    `INSERT INTO sync_member_capabilities (share_id, member_id, version, capabilities)
     VALUES (@shareId, @memberId, @version, @capabilities)
     ON CONFLICT (share_id, member_id) DO UPDATE SET version = excluded.version, capabilities = excluded.capabilities`
  )
  const problems: CapabilitiesProblem[] = []
  let read = 0
  for (const relativePath of await transport.list('capabilities')) {
    const match = CAPABILITIES_PATH.exec(relativePath)
    if (!match) continue
    const memberId = match[1]
    const version = Number(match[2])
    const known = member.get({ shareId, memberId }) as { public_key: string } | undefined
    // A member this PC doesn't know yet is read again once it does.
    if (!known) continue
    const have = stored.get({ shareId, memberId }) as { version: number } | undefined
    if (have && have.version >= version) continue
    try {
      const { header, payload } = openEnvelope(
        CAPABILITIES_FILE,
        await transport.read(relativePath),
        { projectKey, publicKeyFor: (id) => (id === memberId ? known.public_key : null) },
        parseHeader
      )
      const list = (payload as { capabilities?: unknown } | null)?.capabilities
      if (
        header.shareId !== shareId ||
        header.memberId !== memberId ||
        !Array.isArray(list) ||
        !list.every((item) => typeof item === 'string')
      ) {
        problems.push({ path: relativePath, reason: 'mismatch' })
        continue
      }
      store.run({ shareId, memberId, version, capabilities: JSON.stringify(list) })
      read++
    } catch (error) {
      problems.push({
        path: relativePath,
        reason: error instanceof CapabilitiesFileError ? error.reason : 'unreadable'
      })
    }
  }
  return { read, problems }
}

/**
 * The capabilities every device of every member who has not left and was not removed has
 * advertised. A device with no note advertises nothing; with no such member the list is empty.
 */
export function sharedCapabilities(db: Database.Database, shareId: string): string[] {
  const rows = db
    .prepare(
      `SELECT c.capabilities AS capabilities
       FROM sync_members m
       LEFT JOIN sync_member_capabilities c
         ON c.share_id = m.share_id AND c.member_id = m.member_id
       WHERE m.share_id = @shareId AND m.removed_at IS NULL AND m.left_at IS NULL`
    )
    .all({ shareId }) as { capabilities: string | null }[]
  if (rows.length === 0) return []
  let shared: string[] | null = null
  for (const row of rows) {
    const list = row.capabilities ? parseList(row.capabilities) : []
    shared = shared === null ? list : shared.filter((item) => list.includes(item))
  }
  return shared ?? []
}

function parseList(text: string): string[] {
  try {
    const value = JSON.parse(text) as unknown
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function parseHeader(header: Record<string, unknown>): { shareId: string; memberId: string } {
  if (
    header.formatVersion !== 1 ||
    typeof header.shareId !== 'string' ||
    typeof header.memberId !== 'string'
  ) {
    throw new CapabilitiesFileError('not-a-change-file')
  }
  return { shareId: header.shareId, memberId: header.memberId }
}
