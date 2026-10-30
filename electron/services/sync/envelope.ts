/**
 * The sealed envelope every file Ostler writes into a shared folder uses:
 * change files, snapshots and member files (docs/plans/integrations/shared-folder-sync.md,
 * "Encryption and signatures").
 *
 * Layout: an 8-byte magic, a version byte, a 4-byte header length, a plain JSON
 * header (authenticated, not secret), a 12-byte IV, a 16-byte GCM tag, the
 * AES-256-GCM ciphertext of the gzipped JSON payload with everything before the
 * IV as additional data, and finally an Ed25519 signature over everything
 * before it. Each file kind keeps its own magic, header fields and error class.
 *
 * The header's `keyGeneration` (absent means 0) says which generation of the
 * project key sealed the file: removing a member moves the share to a new one
 * (S7d), and older files keep naming the one they used.
 */
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  randomBytes,
  gunzipSync,
  gzipSync,
  bufferConstants
} from './platform'

export type SyncFileRefusal =
  | 'not-a-change-file'
  | 'unsupported-version'
  | 'truncated'
  | 'too-large'
  | 'unknown-member'
  | 'bad-signature'
  | 'cannot-decrypt'

/** Magic (8), format version (1) and header length (4). */
const PREFIX_BYTES = 13
const IV_BYTES = 12
const TAG_BYTES = 16
const SIGNATURE_BYTES = 64
export const PROJECT_KEY_BYTES = 32

/** The project key, or every generation of it by number (null for one this PC lacks). */
export type KeySource = Buffer | ((generation: number) => Buffer | null)

export interface SealKeys {
  projectKey: Buffer
  /** The generation `projectKey` is; 0 when the share's key never changed. */
  keyGeneration?: number
  privateKey: string
}

export interface EnvelopeKind {
  /** 8 ASCII bytes. */
  magic: Buffer
  version: number
  maxBytes: number
  /** Throws the kind's own error; never returns. */
  refuse(reason: SyncFileRefusal): never
}

export function sealEnvelope(
  kind: EnvelopeKind,
  header: Record<string, unknown>,
  payload: unknown,
  keys: SealKeys
): Buffer {
  if (keys.projectKey.length !== PROJECT_KEY_BYTES) {
    throw new RangeError('Project key must be 32 bytes')
  }
  const generation = keys.keyGeneration ?? 0
  const sealedHeader = generation > 0 ? { ...header, keyGeneration: generation } : header
  const headerBytes = Buffer.from(JSON.stringify(sealedHeader), 'utf8')
  const headerLength = Buffer.alloc(4)
  headerLength.writeUInt32BE(headerBytes.length)
  const prefix = Buffer.concat([kind.magic, Buffer.from([kind.version]), headerLength, headerBytes])

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', keys.projectKey, iv)
  cipher.setAAD(prefix)
  const plain = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  const unsigned = Buffer.concat([prefix, iv, tag, ciphertext])

  let identity
  try {
    identity = createPrivateKey({
      key: Buffer.from(keys.privateKey, 'base64'),
      format: 'der',
      type: 'pkcs8'
    })
  } catch {
    throw new Error('Identity private key is not a usable Ed25519 key')
  }
  return Buffer.concat([unsigned, sign(null, unsigned, identity)])
}

/**
 * Checks and opens an envelope. `parseHeader` validates the plain header (and
 * refuses through the kind when it is wrong) before the signature is checked
 * against the key of the member it names.
 */
export function openEnvelope<H extends { memberId: string }>(
  kind: EnvelopeKind,
  bytes: Buffer,
  keys: { projectKey: KeySource; publicKeyFor(memberId: string): string | null },
  parseHeader: (raw: Record<string, unknown>) => H
): { header: H; payload: unknown; keyGeneration: number } {
  if (bytes.length > kind.maxBytes) kind.refuse('too-large')
  if (bytes.length < PREFIX_BYTES || !bytes.subarray(0, kind.magic.length).equals(kind.magic)) {
    kind.refuse('not-a-change-file')
  }
  if (bytes[kind.magic.length] !== kind.version) kind.refuse('unsupported-version')

  const headerLength = bytes.readUInt32BE(kind.magic.length + 1)
  const headerEnd = PREFIX_BYTES + headerLength
  const ivEnd = headerEnd + IV_BYTES
  const ciphertextStart = ivEnd + TAG_BYTES
  if (ciphertextStart + SIGNATURE_BYTES > bytes.length) kind.refuse('truncated')

  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.subarray(PREFIX_BYTES, headerEnd).toString('utf8'))
  } catch {
    kind.refuse('not-a-change-file')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    kind.refuse('not-a-change-file')
  }
  const header = parseHeader(parsed as Record<string, unknown>)
  const rawGeneration = (parsed as Record<string, unknown>).keyGeneration
  if (
    rawGeneration !== undefined &&
    (typeof rawGeneration !== 'number' || !Number.isSafeInteger(rawGeneration) || rawGeneration < 1)
  ) {
    kind.refuse('not-a-change-file')
  }
  const keyGeneration = (rawGeneration as number | undefined) ?? 0

  let publicKey: string | null
  try {
    publicKey = keys.publicKeyFor(header.memberId)
  } catch {
    kind.refuse('unknown-member')
  }
  if (!publicKey) kind.refuse('unknown-member')

  const signedEnd = bytes.length - SIGNATURE_BYTES
  let signatureValid: boolean
  try {
    const identity = createPublicKey({
      key: Buffer.from(publicKey, 'base64'),
      format: 'der',
      type: 'spki'
    })
    signatureValid = verify(null, bytes.subarray(0, signedEnd), identity, bytes.subarray(signedEnd))
  } catch {
    kind.refuse('bad-signature')
  }
  if (!signatureValid) kind.refuse('bad-signature')

  const projectKey =
    typeof keys.projectKey === 'function' ? keys.projectKey(keyGeneration) : keys.projectKey
  if (!projectKey) kind.refuse('cannot-decrypt')
  let plain: Buffer
  try {
    const decipher = createDecipheriv('aes-256-gcm', projectKey, bytes.subarray(headerEnd, ivEnd))
    decipher.setAAD(bytes.subarray(0, headerEnd))
    decipher.setAuthTag(bytes.subarray(ivEnd, ciphertextStart))
    plain = Buffer.concat([
      decipher.update(bytes.subarray(ciphertextStart, signedEnd)),
      decipher.final()
    ])
  } catch {
    kind.refuse('cannot-decrypt')
  }

  let payload: unknown
  try {
    payload = JSON.parse(
      gunzipSync(plain, {
        maxOutputLength: Math.min(4 * kind.maxBytes, bufferConstants.MAX_LENGTH)
      }).toString('utf8')
    )
  } catch {
    kind.refuse('not-a-change-file')
  }
  return { header, payload, keyGeneration }
}
