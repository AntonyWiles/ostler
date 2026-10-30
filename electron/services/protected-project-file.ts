import fs from 'node:fs'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { t } from '@shared/i18n'
import { MIN_FILE_PASSWORD_LENGTH } from '@shared/file-password'

/**
 * Password-protected project files (N45). A protected file keeps the
 * `.ostler-project` name and holds the ordinary project file (the zip),
 * encrypted whole:
 *
 *   offset  size  field
 *   0       8     magic, ASCII `OSTLRENC` (`NEXUSENC` before the rename, still read)
 *   8       1     format version, 1
 *   9       4     scrypt N (uint32, big-endian; a power of two)
 *   13      4     scrypt r (uint32, big-endian)
 *   17      4     scrypt p (uint32, big-endian)
 *   21      16    salt (random)
 *   37      12    nonce (random)
 *   49      …     the zip, encrypted with AES-256-GCM under
 *                 scrypt(password, salt, 32 bytes, { N, r, p })
 *   end-16  16    the GCM authentication tag
 *
 * The 49-byte header is the cipher's associated data, so a changed header
 * fails the tag like a changed body does. Both ways stream in chunks: a
 * project file can be 2 GB. Decrypting writes to a file the caller names
 * (under the data folder); nothing there is to be trusted until
 * `decryptProjectFile` returns, since GCM checks the tag only at the end.
 *
 * The header is hostile too: its scrypt cost is bounded before it is used,
 * so a file cannot ask for gigabytes of memory or hours of work.
 *
 * The password is never stored, logged or put in an error.
 */

export const PROTECTED_MAGIC = Buffer.from('OSTLRENC', 'ascii')
/** Files protected before the rename start with this instead; read, never written. */
const LEGACY_PROTECTED_MAGIC = Buffer.from('NEXUSENC', 'ascii')

function isProtectedMagic(head: Buffer): boolean {
  return head.equals(PROTECTED_MAGIC) || head.equals(LEGACY_PROTECTED_MAGIC)
}
export const PROTECTED_VERSION = 1
export const PROTECTED_HEADER_BYTES = 49
const TAG_BYTES = 16
const KEY_BYTES = 32
const CHUNK = 1024 * 1024

export { MIN_FILE_PASSWORD_LENGTH }

export interface ScryptParameters {
  N: number
  r: number
  p: number
}

/** What export uses: about 128 MB and a fraction of a second. */
export const DEFAULT_SCRYPT: ScryptParameters = { N: 2 ** 17, r: 8, p: 1 }

/** The most a file's header may ask for. */
export const SCRYPT_BOUNDS = {
  minN: 2 ** 14,
  maxN: 2 ** 20,
  maxR: 16,
  maxP: 4,
  /** scrypt's memory, 128 × N × r, at most 256 MB. */
  maxMemoryBytes: 256 * 1024 * 1024
}

/** Whether a file starts with the protected header's magic. */
export function looksProtected(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r')
  try {
    const head = Buffer.alloc(PROTECTED_MAGIC.length)
    return fs.readSync(fd, head, 0, head.length, 0) === head.length && isProtectedMagic(head)
  } finally {
    fs.closeSync(fd)
  }
}

function wrongPassword(): Error {
  return new Error(t('errors:protectedFile.wrongPassword'))
}

/** Refuses scrypt parameters outside the bounds. */
export function checkScryptParameters({ N, r, p }: ScryptParameters): void {
  const ok =
    Number.isInteger(N) &&
    Number.isInteger(r) &&
    Number.isInteger(p) &&
    N >= SCRYPT_BOUNDS.minN &&
    N <= SCRYPT_BOUNDS.maxN &&
    (N & (N - 1)) === 0 &&
    r >= 1 &&
    r <= SCRYPT_BOUNDS.maxR &&
    p >= 1 &&
    p <= SCRYPT_BOUNDS.maxP &&
    128 * N * r <= SCRYPT_BOUNDS.maxMemoryBytes
  if (!ok) throw wrongPassword()
}

function deriveKey(password: string, salt: Buffer, params: ScryptParameters): Buffer {
  checkScryptParameters(params)
  return scryptSync(password.normalize('NFC'), salt, KEY_BYTES, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 128 * params.N * params.r + 64 * 1024 * 1024
  })
}

function buildHeader(params: ScryptParameters, salt: Buffer, nonce: Buffer): Buffer {
  const header = Buffer.alloc(PROTECTED_HEADER_BYTES)
  PROTECTED_MAGIC.copy(header, 0)
  header.writeUInt8(PROTECTED_VERSION, 8)
  header.writeUInt32BE(params.N, 9)
  header.writeUInt32BE(params.r, 13)
  header.writeUInt32BE(params.p, 17)
  salt.copy(header, 21)
  nonce.copy(header, 37)
  return header
}

/** Reads and checks a header; a wrong one says the same as a wrong password. */
export function readHeader(header: Buffer): {
  params: ScryptParameters
  salt: Buffer
  nonce: Buffer
} {
  if (
    header.length !== PROTECTED_HEADER_BYTES ||
    !isProtectedMagic(header.subarray(0, PROTECTED_MAGIC.length)) ||
    header.readUInt8(8) !== PROTECTED_VERSION
  )
    throw wrongPassword()
  const params = {
    N: header.readUInt32BE(9),
    r: header.readUInt32BE(13),
    p: header.readUInt32BE(17)
  }
  checkScryptParameters(params)
  return { params, salt: header.subarray(21, 37), nonce: header.subarray(37, 49) }
}

/**
 * Encrypts the plain project file at `source` into `target`. A failed
 * write leaves nothing at `target`.
 */
export function encryptProjectFile(
  source: string,
  target: string,
  password: string,
  params: ScryptParameters = DEFAULT_SCRYPT
): void {
  if (typeof password !== 'string' || password.length < MIN_FILE_PASSWORD_LENGTH)
    throw new Error(t('errors:protectedFile.passwordTooShort', { min: MIN_FILE_PASSWORD_LENGTH }))
  const salt = randomBytes(16)
  const nonce = randomBytes(12)
  const header = buildHeader(params, salt, nonce)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(password, salt, params), nonce)
  cipher.setAAD(header)
  const input = fs.openSync(source, 'r')
  let output: number | null = null
  try {
    output = fs.openSync(target, 'w')
    fs.writeSync(output, header)
    const buffer = Buffer.alloc(CHUNK)
    let read: number
    while ((read = fs.readSync(input, buffer, 0, CHUNK, null)) > 0)
      fs.writeSync(output, cipher.update(buffer.subarray(0, read)))
    fs.writeSync(output, cipher.final())
    fs.writeSync(output, cipher.getAuthTag())
    fs.closeSync(output)
    output = null
  } catch (error) {
    if (output !== null) fs.closeSync(output)
    fs.rmSync(target, { force: true })
    throw error
  } finally {
    fs.closeSync(input)
  }
}

/**
 * Decrypts a protected file into `target` (which must not exist), checking
 * the tag before returning. A wrong password, a damaged file or a refused
 * header removes `target` and throws "This password does not open the
 * file, or the file is damaged".
 */
export function decryptProjectFile(source: string, target: string, password: string): void {
  const input = fs.openSync(source, 'r')
  let output: number | null = null
  let opened = false
  try {
    const size = fs.fstatSync(input).size
    if (size < PROTECTED_HEADER_BYTES + TAG_BYTES) throw wrongPassword()
    const header = Buffer.alloc(PROTECTED_HEADER_BYTES)
    fs.readSync(input, header, 0, PROTECTED_HEADER_BYTES, 0)
    const { params, salt, nonce } = readHeader(header)
    const tag = Buffer.alloc(TAG_BYTES)
    fs.readSync(input, tag, 0, TAG_BYTES, size - TAG_BYTES)
    if (typeof password !== 'string' || password.length === 0) throw wrongPassword()
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(password, salt, params), nonce)
    decipher.setAAD(header)
    decipher.setAuthTag(tag)
    output = fs.openSync(target, 'wx')
    opened = true
    const buffer = Buffer.alloc(CHUNK)
    let position = PROTECTED_HEADER_BYTES
    const end = size - TAG_BYTES
    while (position < end) {
      const read = fs.readSync(input, buffer, 0, Math.min(CHUNK, end - position), position)
      if (read <= 0) throw wrongPassword()
      position += read
      fs.writeSync(output, decipher.update(buffer.subarray(0, read)))
    }
    try {
      fs.writeSync(output, decipher.final())
    } catch {
      throw wrongPassword()
    }
    fs.closeSync(output)
    output = null
  } catch (error) {
    if (output !== null) fs.closeSync(output)
    if (opened) fs.rmSync(target, { force: true })
    throw error
  } finally {
    fs.closeSync(input)
  }
}
