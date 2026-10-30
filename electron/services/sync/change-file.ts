/**
 * A change file is one batch of project changes written to the shared folder
 * for other PCs to read. It is encrypted with the project key, so the folder's
 * sync provider only ever sees ciphertext, and signed with the writing
 * member's identity key, so every PC can tell who wrote it and that it wasn't
 * changed. The layout and the decode order are in
 * `docs/plans/integrations/shared-folder-sync.md`.
 */

import { generateKeyPairSync, randomBytes } from './platform'
import {
  openEnvelope,
  PROJECT_KEY_BYTES,
  sealEnvelope,
  type EnvelopeKind,
  type SyncFileRefusal,
  type SealKeys,
  type KeySource
} from './envelope'

/** One change to one row. `stamp` is a clock stamp from src/shared/sync/clock.ts (a string). */
export interface SyncChange {
  table: string
  /** The row's primary key as a JSON array, as undo history writes it. */
  rowKey: string
  op: 'upsert' | 'delete'
  /** Changed columns and their new values; empty for a delete. */
  columns: Record<string, unknown>
  stamp: string
  actor: { kind: string; personId?: string }
}

export interface ChangeBatch {
  formatVersion: 1
  shareId: string
  deviceId: string
  memberId: string
  /** 1, 2, 3 … per device; the file's name in the share folder. */
  sequence: number
  changes: SyncChange[]
}

export interface IdentityKeys {
  /** Ed25519 public key, SPKI DER, base64. */
  publicKey: string
  /** Ed25519 private key, PKCS8 DER, base64. Kept encrypted by the caller; never logged. */
  privateKey: string
}

export type ChangeFileErrorReason = SyncFileRefusal

export class ChangeFileError extends Error {
  constructor(readonly reason: ChangeFileErrorReason) {
    // Only the reason: never key material or file contents.
    super(`Change file refused: ${reason}`)
    this.name = 'ChangeFileError'
  }
}

export const MAX_CHANGE_FILE_BYTES = 64 * 1024 * 1024

const FORMAT_VERSION = 1

interface ChangeHeader {
  shareId: string
  deviceId: string
  memberId: string
  sequence: number
}

function refuse(reason: ChangeFileErrorReason): never {
  throw new ChangeFileError(reason)
}

const CHANGE_FILE: EnvelopeKind = {
  magic: Buffer.from('OSTLERCH', 'ascii'),
  version: FORMAT_VERSION,
  maxBytes: MAX_CHANGE_FILE_BYTES,
  refuse
}

export function newProjectKey(): Buffer {
  return randomBytes(PROJECT_KEY_BYTES)
}

export function newIdentityKeys(): IdentityKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
  }
}

export function encodeChangeFile(batch: ChangeBatch, keys: SealKeys): Buffer {
  if (batch.formatVersion !== FORMAT_VERSION) {
    throw new RangeError('Change batch format version must be 1')
  }
  if (!Number.isInteger(batch.sequence) || batch.sequence < 1) {
    throw new RangeError('Change batch sequence must be a positive integer')
  }
  if (keys.projectKey.length !== PROJECT_KEY_BYTES) {
    throw new RangeError('Project key must be 32 bytes')
  }

  return sealEnvelope(
    CHANGE_FILE,
    {
      formatVersion: FORMAT_VERSION,
      shareId: batch.shareId,
      deviceId: batch.deviceId,
      memberId: batch.memberId,
      sequence: batch.sequence
    },
    batch.changes,
    keys
  )
}

export function decodeChangeFile(
  bytes: Buffer,
  keys: { projectKey: KeySource; publicKeyFor(memberId: string): string | null }
): ChangeBatch {
  const { header, payload: changes } = openEnvelope(CHANGE_FILE, bytes, keys, parseHeader)
  if (!Array.isArray(changes)) refuse('not-a-change-file')

  return {
    formatVersion: FORMAT_VERSION,
    shareId: header.shareId,
    deviceId: header.deviceId,
    memberId: header.memberId,
    sequence: header.sequence,
    changes: changes as SyncChange[]
  }
}

function parseHeader(header: Record<string, unknown>): ChangeHeader {
  if (
    header.formatVersion !== FORMAT_VERSION ||
    typeof header.shareId !== 'string' ||
    typeof header.deviceId !== 'string' ||
    typeof header.memberId !== 'string' ||
    typeof header.sequence !== 'number' ||
    !Number.isInteger(header.sequence) ||
    header.sequence < 1
  ) {
    refuse('not-a-change-file')
  }
  return {
    shareId: header.shareId,
    deviceId: header.deviceId,
    memberId: header.memberId,
    sequence: header.sequence
  }
}
