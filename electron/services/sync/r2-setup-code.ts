/**
 * The setup code that carries advanced sync's bucket settings from one device to another (PC to
 * phone, phone to PC, or into a fresh install), so they are typed once. It holds the bucket's keys,
 * so it is sealed: AES-256-GCM under a key stretched from a passphrase with PBKDF2-SHA256. The
 * passphrase is made here, shown once next to the code and never stored; send the two separately.
 *
 * `ostler-r2:1:<base64url of salt(16) | iv(12) | tag(16) | ciphertext>`
 */
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from './platform'
import { checkedR2Config, type R2Config } from './r2-transport'

export const R2_SETUP_PREFIX = 'ostler-r2:1:'
const ITERATIONS = 210_000
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
/** Crockford's base-32 letters: no I, L, O or U to misread. */
const LETTERS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export interface R2Setup {
  config: R2Config
  /** The personal space's folder in the bucket (`Ostler`). */
  space: string
  /** How often to look for changes, in minutes; 0 = only on Sync now. */
  checkMinutes: number
}

export class R2SetupCodeError extends Error {
  constructor(readonly reason: 'not-a-code' | 'wrong-passphrase') {
    super(`Setup code: ${reason}`)
    this.name = 'R2SetupCodeError'
  }
}

/** Sixteen random letters in four groups (80 bits): `K7QM-2D9F-XR4T-8HWA`. */
export function newSetupPassphrase(): string {
  const bytes = randomBytes(16)
  let text = ''
  for (let i = 0; i < 16; i++) {
    text += LETTERS[bytes[i] % 32]
    if (i % 4 === 3 && i < 15) text += '-'
  }
  return text
}

/** Spaces, dashes and case don't matter when the passphrase is typed back. */
function normalised(passphrase: string): string {
  return passphrase.toUpperCase().replace(/[\s-]+/g, '')
}

function keyOf(passphrase: string, salt: Uint8Array): Buffer {
  return pbkdf2Sync(normalised(passphrase), salt, ITERATIONS, 32, 'sha256')
}

export function sealR2Setup(setup: R2Setup, passphrase: string): string {
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', keyOf(passphrase, salt), iv)
  cipher.setAAD(Buffer.from(R2_SETUP_PREFIX, 'utf8'))
  const plain = Buffer.from(
    JSON.stringify({
      config: checkedR2Config(setup.config),
      space: setup.space,
      checkMinutes: setup.checkMinutes
    }),
    'utf8'
  )
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return R2_SETUP_PREFIX + base64url(Buffer.concat([salt, iv, tag, sealed]))
}

export function openR2Setup(code: string, passphrase: string): R2Setup {
  const text = code.trim().replace(/\s+/g, '')
  if (!text.startsWith(R2_SETUP_PREFIX) || text.length > 8192) {
    throw new R2SetupCodeError('not-a-code')
  }
  const bytes = Buffer.from(
    text.slice(R2_SETUP_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  )
  if (bytes.length < SALT_BYTES + IV_BYTES + TAG_BYTES + 2) throw new R2SetupCodeError('not-a-code')
  const salt = bytes.subarray(0, SALT_BYTES)
  const iv = bytes.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES)
  const tag = bytes.subarray(SALT_BYTES + IV_BYTES, SALT_BYTES + IV_BYTES + TAG_BYTES)
  const sealed = bytes.subarray(SALT_BYTES + IV_BYTES + TAG_BYTES)
  let plain: Buffer
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyOf(passphrase, salt), iv)
    decipher.setAAD(Buffer.from(R2_SETUP_PREFIX, 'utf8'))
    decipher.setAuthTag(tag)
    plain = Buffer.concat([decipher.update(sealed), decipher.final()])
  } catch {
    throw new R2SetupCodeError('wrong-passphrase')
  }
  let parsed: { config?: Partial<R2Config>; space?: unknown; checkMinutes?: unknown }
  try {
    parsed = JSON.parse(plain.toString('utf8')) as typeof parsed
  } catch {
    throw new R2SetupCodeError('not-a-code')
  }
  const space = typeof parsed.space === 'string' ? parsed.space : ''
  if (!/^[^\\/:]{1,100}$/.test(space) || space === '.' || space === '..') {
    throw new R2SetupCodeError('not-a-code')
  }
  let config: R2Config
  try {
    config = checkedR2Config(parsed.config)
  } catch {
    throw new R2SetupCodeError('not-a-code')
  }
  return { config, space, checkMinutes: checkedMinutes(parsed.checkMinutes) }
}

/** The intervals offered; anything else becomes the default. */
export const R2_CHECK_MINUTES = [0, 1, 5, 15, 30, 60] as const
export const DEFAULT_R2_CHECK_MINUTES = 5

export function checkedMinutes(value: unknown): number {
  return typeof value === 'number' && (R2_CHECK_MINUTES as readonly number[]).includes(value)
    ? value
    : DEFAULT_R2_CHECK_MINUTES
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
