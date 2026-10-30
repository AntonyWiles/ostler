/**
 * The phone's version of `electron/services/sync/platform.ts`. Metro resolves that module to
 * this file (metro.config.js), so the sync engine finds the same names here, built from
 * React Native libraries. Keep the export list in step with the desktop file.
 */
import { Buffer, kMaxLength } from 'buffer'
import { Inflate, gzip } from 'pako'
import * as SecureStore from 'expo-secure-store'
import { randomUUID } from 'react-native-quick-crypto'
import { posixPath } from './posix-path'

export {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  sign,
  verify
} from 'react-native-quick-crypto'

export const bufferConstants = { MAX_LENGTH: kMaxLength, MAX_STRING_LENGTH: (1 << 29) - 24 }

export const path = posixPath

export function gzipSync(input: Uint8Array): Buffer {
  return Buffer.from(gzip(input))
}

/**
 * Inflates `input`. pako has no output limit of its own, so it is enforced here chunk by
 * chunk, as Node's `maxOutputLength` does: a small file must not expand without bound.
 */
export function gunzipSync(input: Uint8Array, options?: { maxOutputLength?: number }): Buffer {
  const limit = options?.maxOutputLength
  const inflater = new Inflate()
  const chunks: Uint8Array[] = []
  let total = 0
  inflater.onData = (chunk) => {
    total += (chunk as Uint8Array).length
    if (limit !== undefined && total > limit) {
      throw new RangeError(`Cannot create a Buffer larger than ${limit} bytes`)
    }
    chunks.push(chunk as Uint8Array)
  }
  inflater.push(input, true)
  if (inflater.err) throw new Error(inflater.msg || 'gunzip failed')
  return Buffer.concat(chunks)
}

/** The change recorder is a desktop feature; on the phone no edit is "inside a step". */
export function openChangeContext(): null {
  return null
}

const SEALED_PREFIX = 'phone-secure:'

/** Keeps `secret` in the Android keystore under a fresh random key and returns a reference. */
export function sealSecret(secret: string): string {
  if (!secret) return secret
  const key = `ostler-${randomUUID()}`
  SecureStore.setItem(key, secret)
  return `${SEALED_PREFIX}${key}`
}

/** Reads back a secret written by `sealSecret`; a value that was never sealed is kept as it is. */
export function openSecret(stored: string): string {
  if (!stored.startsWith(SEALED_PREFIX)) return stored
  const secret = SecureStore.getItem(stored.slice(SEALED_PREFIX.length))
  if (secret === null) throw new Error('A secret kept in secure storage on this phone is missing.')
  return secret
}
