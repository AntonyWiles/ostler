/**
 * Library files of a shared project (docs/plans/integrations/shared-folder-sync.md,
 * "What is shared", S8).
 *
 * A Library item's row travels in change files like any other row; its file
 * travels separately as `files/<sha256>.ostlerfile`, a sealed envelope
 * (envelope.ts) holding the bytes, encrypted with the project key and signed by
 * the member who wrote it. A file is named by its content, so it is written once
 * and never changed, and two PCs writing the same file write the same name.
 *
 * Push writes every item's file the folder doesn't have yet; pull fetches every
 * item's file this PC doesn't have yet, checks its hash, and hands it to the
 * Library, which stores it and makes its own thumbnail and text.
 */
import { createHash } from './platform'
import type Database from 'better-sqlite3'
import {
  openEnvelope,
  sealEnvelope,
  type EnvelopeKind,
  type SyncFileRefusal,
  type SealKeys,
  type KeySource
} from './envelope'
import { SyncTransportError } from './transport-paths'
import type { SyncTransport } from './folder-transport'

/** Larger files are reported as a problem, never silently skipped. */
export const MAX_LIBRARY_FILE_BYTES = 512 * 1024 * 1024

const SHA256 = /^[0-9a-f]{64}$/

/** What the Library does for sync (LibraryService implements it). */
export interface LibraryFileStore {
  syncedOriginal(projectId: string, itemId: string): Buffer | null
  receiveSyncedOriginal(projectId: string, itemId: string, bytes: Buffer): Promise<void>
}

export interface LibraryFileProblem {
  itemId: string
  reason: SyncFileRefusal | 'missing-here' | 'unreadable' | 'hash-mismatch' | 'cannot-store'
}

export interface LibraryFilesResult {
  files: number
  problems: LibraryFileProblem[]
}

class LibraryFileError extends Error {
  constructor(readonly reason: SyncFileRefusal) {
    super(`Library file refused: ${reason}`)
  }
}

const LIBRARY_FILE: EnvelopeKind = {
  magic: Buffer.from('OSTLERFL', 'ascii'),
  version: 1,
  // Base64 in the payload grows a file by a third, before gzip.
  maxBytes: Math.ceil(MAX_LIBRARY_FILE_BYTES * 1.4),
  refuse: (reason) => {
    throw new LibraryFileError(reason)
  }
}

interface ShareRow {
  share_id: string
  member_id: string
}

interface ItemRow {
  id: string
  sha256: string
}

/** Writes the file of every Library item of the project that the folder doesn't have yet. */
export async function pushLibraryFiles(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string,
  keys: SealKeys,
  store: LibraryFileStore
): Promise<LibraryFilesResult> {
  const share = shareOf(db, projectId)
  const present = new Set(await transport.list('files'))
  const result: LibraryFilesResult = { files: 0, problems: [] }
  for (const item of itemsWithFiles(db, projectId)) {
    const path = filePath(item.sha256)
    if (present.has(path)) continue
    const bytes = store.syncedOriginal(projectId, item.id)
    if (!bytes) {
      // Not on this PC either (it came from another PC that hasn't written it yet).
      continue
    }
    if (bytes.length > MAX_LIBRARY_FILE_BYTES) {
      result.problems.push({ itemId: item.id, reason: 'too-large' })
      continue
    }
    if (sha256(bytes) !== item.sha256) {
      result.problems.push({ itemId: item.id, reason: 'hash-mismatch' })
      continue
    }
    const sealed = sealEnvelope(
      LIBRARY_FILE,
      { formatVersion: 1, shareId: share.share_id, memberId: share.member_id, sha256: item.sha256 },
      bytes.toString('base64'),
      keys
    )
    try {
      await transport.writeOnce(path, sealed)
      result.files++
    } catch (error) {
      // Another PC wrote the same content first: nothing to do.
      if (!(error instanceof SyncTransportError && error.reason === 'exists')) throw error
    }
    present.add(path)
  }
  return result
}

/** Fetches the file of every Library item of the project that this PC doesn't have yet. */
export async function pullLibraryFiles(
  db: Database.Database,
  transport: SyncTransport,
  projectId: string,
  keys: { projectKey: KeySource },
  store: LibraryFileStore
): Promise<LibraryFilesResult> {
  const share = shareOf(db, projectId)
  const present = new Set(await transport.list('files'))
  const memberKey = db.prepare(
    'SELECT public_key FROM sync_members WHERE share_id = @shareId AND member_id = @memberId'
  )
  const result: LibraryFilesResult = { files: 0, problems: [] }
  for (const item of itemsWithFiles(db, projectId)) {
    if (store.syncedOriginal(projectId, item.id)) continue
    const path = filePath(item.sha256)
    // Not written yet by the PC that has it: tried again on the next pull.
    if (!present.has(path)) continue

    let bytes: Buffer
    try {
      const { header, payload } = openEnvelope(
        LIBRARY_FILE,
        await transport.read(path),
        {
          projectKey: keys.projectKey,
          publicKeyFor: (memberId) =>
            (
              memberKey.get({ shareId: share.share_id, memberId }) as
                { public_key: string } | undefined
            )?.public_key ?? null
        },
        parseHeader
      )
      if (header.shareId !== share.share_id || header.sha256 !== item.sha256) {
        result.problems.push({ itemId: item.id, reason: 'hash-mismatch' })
        continue
      }
      if (typeof payload !== 'string') {
        result.problems.push({ itemId: item.id, reason: 'not-a-change-file' })
        continue
      }
      bytes = Buffer.from(payload, 'base64')
    } catch (error) {
      result.problems.push({
        itemId: item.id,
        reason: error instanceof LibraryFileError ? error.reason : 'unreadable'
      })
      continue
    }
    if (sha256(bytes) !== item.sha256) {
      result.problems.push({ itemId: item.id, reason: 'hash-mismatch' })
      continue
    }
    try {
      await store.receiveSyncedOriginal(projectId, item.id, bytes)
      result.files++
    } catch {
      result.problems.push({ itemId: item.id, reason: 'cannot-store' })
    }
  }
  return result
}

function itemsWithFiles(db: Database.Database, projectId: string): ItemRow[] {
  return (
    db
      .prepare(
        `SELECT id, sha256 FROM library_items
         WHERE project_id = @projectId AND sha256 IS NOT NULL AND file_json IS NOT NULL
         ORDER BY id`
      )
      .all({ projectId }) as ItemRow[]
  ).filter((item) => SHA256.test(item.sha256))
}

function filePath(hash: string): string {
  return `files/${hash}.ostlerfile`
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseHeader(header: Record<string, unknown>): {
  shareId: string
  memberId: string
  sha256: string
} {
  if (
    header.formatVersion !== 1 ||
    typeof header.shareId !== 'string' ||
    typeof header.memberId !== 'string' ||
    typeof header.sha256 !== 'string'
  ) {
    throw new LibraryFileError('not-a-change-file')
  }
  return { shareId: header.shareId, memberId: header.memberId, sha256: header.sha256 }
}

function shareOf(db: Database.Database, projectId: string): ShareRow {
  const share = db
    .prepare('SELECT share_id, member_id FROM sync_shares WHERE project_id = @projectId')
    .get({ projectId }) as ShareRow | undefined
  if (!share) throw new Error('Project is not shared')
  return share
}
