import { safeStorage } from 'electron'
import { LEGACY_NAMES } from '@shared/legacy-names'

/**
 * Checks if Electron's safeStorage is available.
 * @returns {boolean} True if encryption is available, false otherwise.
 */
export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

const ENCRYPTED_PREFIX = 'ostler-secure:v1:'
/** Secrets sealed before the rename carry this prefix; read, never written. */
const PREFIXES = [ENCRYPTED_PREFIX, LEGACY_NAMES.secretPrefix]
const MAX_ENCRYPTION_LAYERS = 32

/** The encrypted part of a sealed secret, or null for plain text. */
function sealedPayload(value: string): string | null {
  const prefix = PREFIXES.find((candidate) => value.startsWith(candidate))
  return prefix === undefined ? null : value.slice(prefix.length)
}

/** Whether a stored value is already an Ostler encrypted credential (not plain text). */
export function isEncryptedSecret(value: string): boolean {
  return sealedPayload(value) !== null
}

/** Encrypts a secret with safeStorage; secure storage must be available. */
export function encryptApiKey(key: string): string {
  if (!key) return key
  if (!isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable; API keys cannot be saved.')
  }
  return `${ENCRYPTED_PREFIX}${safeStorage.encryptString(key).toString('base64')}`
}

/**
 * Seals a secret for config.json: an API key, the GitHub token, or a project's
 * harness or automation token. When Windows cannot encrypt, it is kept as it
 * is; ConfigStore encrypts it on the next start where Windows can.
 */
export function sealSecret(secret: string): string {
  if (!secret || !isEncryptionAvailable()) return secret
  return encryptApiKey(secret)
}

/** Opens a secret written by `sealSecret`: encrypted ones are decrypted, plain ones kept. */
export function openSecret(stored: string): string {
  return isEncryptedSecret(stored) ? decryptApiKey(stored) : stored
}

/** Decrypts a secret written by `encryptApiKey`; plaintext and unavailable secure storage are errors. */
export function decryptApiKey(encrypted: string): string {
  if (!encrypted) return encrypted
  if (!isEncryptionAvailable()) {
    throw new Error('Secure credential storage is unavailable; stored API key cannot be opened.')
  }

  let current = encrypted
  try {
    for (let layer = 0; layer < MAX_ENCRYPTION_LAYERS; layer += 1) {
      const encoded = sealedPayload(current) ?? current
      const buffer = Buffer.from(encoded, 'base64')
      current = safeStorage.decryptString(buffer)

      if (!isEncryptedSecret(current)) return current
    }
  } catch {
    throw new Error('Stored API key is not a valid Ostler encrypted credential.')
  }

  throw new Error('Stored API key has too many encryption layers.')
}
