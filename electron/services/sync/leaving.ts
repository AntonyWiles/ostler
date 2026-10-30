/**
 * Leaving a shared project on one's own. Before a PC stops syncing a project it writes a "left"
 * note to the shared folder (`left/<memberId>.ostlerleft`), sealed with the project key and signed
 * with the device's key, so the others can tell who left and when. They keep the person in the
 * member list, shown as left, and keep everything they did: it was theirs to do. Removal by an
 * Owner is different (rotation.ts): the key changes and the person's newer files are refused.
 */
import type Database from 'better-sqlite3'
import {
  openEnvelope,
  sealEnvelope,
  type EnvelopeKind,
  type KeySource,
  type SealKeys
} from './envelope'
import { SyncTransportError } from './transport-paths'
import type { SyncTransport } from './folder-transport'

export class LeftFileError extends Error {
  constructor(readonly reason: string) {
    super(`Left note refused: ${reason}`)
    this.name = 'LeftFileError'
  }
}

const LEFT_FILE: EnvelopeKind = {
  magic: Buffer.from('OSTLERLF', 'ascii'),
  version: 1,
  maxBytes: 64 * 1024,
  refuse: (reason) => {
    throw new LeftFileError(reason)
  }
}

const LEFT_PATH = /^left\/([^/]+)\.ostlerleft$/

export interface LeftProblem {
  path: string
  reason: string
}

/** Writes this device's left note. A note already there (left before, then joined again) stays. */
export async function writeLeftNote(
  transport: SyncTransport,
  share: { shareId: string; memberId: string },
  keys: SealKeys,
  leftAt: number = Date.now()
): Promise<void> {
  const bytes = sealEnvelope(
    LEFT_FILE,
    { formatVersion: 1, shareId: share.shareId, memberId: share.memberId },
    { leftAt },
    keys
  )
  try {
    await transport.writeOnce(`left/${share.memberId}.ostlerleft`, bytes)
  } catch (error) {
    if (!(error instanceof SyncTransportError && error.reason === 'exists')) throw error
  }
}

/**
 * Reads the left notes and marks those members left. Returns the person keys of the people who
 * have now left with every device they had in the share, newly since the last read, so each is
 * told once. Runs after `refreshMembers`, which knows the signers.
 */
export async function refreshLeft(
  db: Database.Database,
  transport: SyncTransport,
  shareId: string,
  projectKey: KeySource
): Promise<{ newlyLeft: { personKey: string; name: string }[]; problems: LeftProblem[] }> {
  const member = db.prepare(
    `SELECT public_key, left_at, COALESCE(person_public_key, public_key) AS person_key
     FROM sync_members WHERE share_id = @shareId AND member_id = @memberId`
  )
  const mark = db.prepare(
    'UPDATE sync_members SET left_at = @leftAt WHERE share_id = @shareId AND member_id = @memberId AND left_at IS NULL'
  )
  const problems: LeftProblem[] = []
  const touched = new Set<string>()
  for (const relativePath of await transport.list('left')) {
    const match = LEFT_PATH.exec(relativePath)
    if (!match) continue
    const known = member.get({ shareId, memberId: match[1] }) as
      { public_key: string; left_at: number | null; person_key: string } | undefined
    // Already marked, or a member this PC doesn't know yet (read again once it does).
    if (!known || known.left_at !== null) continue
    try {
      const { header, payload } = openEnvelope(
        LEFT_FILE,
        await transport.read(relativePath),
        {
          projectKey,
          publicKeyFor: (memberId) => (memberId === match[1] ? known.public_key : null)
        },
        parseHeader
      )
      const leftAt = (payload as { leftAt?: unknown } | null)?.leftAt
      if (header.shareId !== shareId || typeof leftAt !== 'number') {
        problems.push({ path: relativePath, reason: 'mismatch' })
        continue
      }
      mark.run({ shareId, memberId: header.memberId, leftAt })
      touched.add(known.person_key)
    } catch (error) {
      problems.push({
        path: relativePath,
        reason: error instanceof LeftFileError ? error.reason : 'unreadable'
      })
    }
  }
  const newlyLeft: { personKey: string; name: string }[] = []
  for (const personKey of touched) {
    const devices = db
      .prepare(
        `SELECT name, me, left_at FROM sync_members
         WHERE share_id = @shareId AND removed_at IS NULL AND COALESCE(person_public_key, public_key) = @personKey
         ORDER BY joined_at`
      )
      .all({ shareId, personKey }) as { name: string; me: string | null; left_at: number | null }[]
    if (devices.length === 0 || devices.some((device) => device.left_at === null)) continue
    const last = devices[devices.length - 1]
    newlyLeft.push({ personKey, name: meNameOf(last.me) ?? last.name })
  }
  return { newlyLeft, problems }
}

function meNameOf(me: string | null): string | null {
  if (!me) return null
  try {
    const name = (JSON.parse(me) as { name?: unknown }).name
    return typeof name === 'string' && name.trim() ? name : null
  } catch {
    return null
  }
}

function parseHeader(header: Record<string, unknown>): { shareId: string; memberId: string } {
  if (
    header.formatVersion !== 1 ||
    typeof header.shareId !== 'string' ||
    typeof header.memberId !== 'string'
  ) {
    throw new LeftFileError('not-a-change-file')
  }
  return { shareId: header.shareId, memberId: header.memberId }
}
