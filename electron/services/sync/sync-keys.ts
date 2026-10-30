/**
 * This PC's identity key pair and each shared project's key
 * (docs/plans/integrations/shared-folder-sync.md, "Encryption and signatures", S6e, S7d).
 *
 * The identity is one Ed25519 pair, made the first time it is asked for and
 * kept in `sync_identity`. Change files are signed with its private key, and
 * other members check them with its public key. Next to it is an X25519 pair, the
 * "box" keys, that a new project key is encrypted to when someone is removed.
 *
 * The person key (docs/plans/people-and-devices/overview.md, D4) is a second Ed25519
 * pair, one per person and the same on all their devices, kept in `sync_person`.
 * A device certificate is the person key's signature over one device's identity
 * and box public keys and its name: other PCs use it to tell that two devices
 * belong to the same person. Change files stay signed with the device key.
 *
 * A project key is the 32-byte AES key every member of a share encrypts with.
 * Removing a member moves the share to a new generation of it; every generation
 * this PC has is kept in `sync_keys`, the current one also in
 * `sync_shares.project_key` with its number in `key_generation`. Private keys and
 * project keys are stored sealed with `sealSecret`; they are never logged and
 * never sent to the renderer.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from './platform'
import type Database from 'better-sqlite3'
import { openSecret, sealSecret } from './platform'
import { newIdentityKeys, type IdentityKeys } from './change-file'

const PROJECT_KEY_BYTES = 32

/**
 * A device's id: the first 32 hex digits of SHA-256 of its identity public key. Pairing names a
 * device's files with it, and the mirrors mark the device that runs them with it.
 */
export function deviceIdOf(identityPublicKey: string): string {
  return createHash('sha256')
    .update(Buffer.from(identityPublicKey, 'base64'))
    .digest('hex')
    .slice(0, 32)
}

/** This PC's device id (`deviceIdOf` its identity key). */
export function thisDeviceId(db: Database.Database): string {
  return deviceIdOf(identityKeys(db).publicKey)
}

/** This PC's identity key pair; made and stored sealed on the first call. */
export function identityKeys(db: Database.Database): IdentityKeys {
  const stored = readIdentity(db)
  if (stored) return stored
  const keys = newIdentityKeys()
  // OR IGNORE: if another connection made one first, that pair wins and is read back.
  db.prepare(
    `INSERT OR IGNORE INTO sync_identity (id, public_key, private_key, created_at)
     VALUES (1, @publicKey, @privateKey, @createdAt)`
  ).run({
    publicKey: keys.publicKey,
    privateKey: sealSecret(keys.privateKey),
    createdAt: Date.now()
  })
  return readIdentity(db) as IdentityKeys
}

function readIdentity(db: Database.Database): IdentityKeys | null {
  const row = db.prepare('SELECT public_key, private_key FROM sync_identity WHERE id = 1').get() as
    { public_key: string; private_key: string } | undefined
  return row ? { publicKey: row.public_key, privateKey: openSecret(row.private_key) } : null
}

/** This PC's X25519 pair (SPKI and PKCS8 DER, base64), made with the identity on first use. */
export function boxKeys(db: Database.Database): IdentityKeys {
  identityKeys(db)
  const row = db
    .prepare('SELECT box_public_key, box_private_key FROM sync_identity WHERE id = 1')
    .get() as { box_public_key: string | null; box_private_key: string | null }
  if (row.box_public_key && row.box_private_key) {
    return { publicKey: row.box_public_key, privateKey: openSecret(row.box_private_key) }
  }
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  db.prepare(
    `UPDATE sync_identity SET box_public_key = @publicKey, box_private_key = @privateKey
     WHERE id = 1 AND box_public_key IS NULL`
  ).run({
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKey: sealSecret(privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'))
  })
  return boxKeys(db)
}

/** A device's certificate: the person key's signature over the device's keys and name. */
export interface DeviceCertificate {
  /** The device's Ed25519 identity public key (`identityKeys`), SPKI DER, base64. */
  devicePublicKey: string
  /** The device's X25519 box public key (`boxKeys`), SPKI DER, base64. */
  deviceBoxPublicKey: string
  deviceName: string
  createdAt: number
  /** The person key's Ed25519 public key, SPKI DER, base64. */
  personPublicKey: string
  /** Ed25519 signature over the canonical JSON of the fields above, base64. */
  signature: string
}

const DEVICE_NAME_MAX_LENGTH = 100

/** This PC's person key pair; made and stored sealed on the first call. */
export function personKeys(db: Database.Database): IdentityKeys {
  const stored = readPerson(db)
  if (stored) return stored
  const keys = newIdentityKeys()
  // OR IGNORE: if another connection made one first, that pair wins and is read back.
  db.prepare(
    `INSERT OR IGNORE INTO sync_person (id, public_key, private_key, created_at, source)
     VALUES (1, @publicKey, @privateKey, @createdAt, 'made')`
  ).run({
    publicKey: keys.publicKey,
    privateKey: sealSecret(keys.privateKey),
    createdAt: Date.now()
  })
  return readPerson(db) as IdentityKeys
}

/**
 * Replaces this PC's person key: `'paired'` when it came from another device,
 * `'made'` when made here. Refuses a pair whose halves do not match.
 */
export function storePersonKeys(
  db: Database.Database,
  keys: IdentityKeys,
  source: 'made' | 'paired'
): void {
  if (!formPair(keys)) throw new Error('The person keys do not form a pair.')
  db.prepare(
    `INSERT OR REPLACE INTO sync_person (id, public_key, private_key, created_at, source)
     VALUES (1, @publicKey, @privateKey, @createdAt, @source)`
  ).run({
    publicKey: keys.publicKey,
    privateKey: sealSecret(keys.privateKey),
    createdAt: Date.now(),
    source
  })
}

/** Signs a device's keys and name with the person key. Pure: nothing is stored. */
export function certifyDevice(
  person: IdentityKeys,
  device: { publicKey: string; boxPublicKey: string; name: string },
  now = Date.now()
): DeviceCertificate {
  const fields = {
    devicePublicKey: device.publicKey,
    deviceBoxPublicKey: device.boxPublicKey,
    deviceName: device.name,
    createdAt: now,
    personPublicKey: person.publicKey
  }
  const signature = sign(
    null,
    Buffer.from(certificateBody(fields)),
    ed25519PrivateKey(person.privateKey)
  ).toString('base64')
  return { ...fields, signature }
}

/**
 * Checks a certificate's shape and signature. Returns it when both are good and
 * null for anything else; never throws.
 */
export function verifyDeviceCertificate(cert: unknown): DeviceCertificate | null {
  try {
    if (!cert || typeof cert !== 'object') return null
    const c = cert as Record<string, unknown>
    if (
      typeof c.devicePublicKey !== 'string' ||
      typeof c.deviceBoxPublicKey !== 'string' ||
      typeof c.deviceName !== 'string' ||
      c.deviceName.length > DEVICE_NAME_MAX_LENGTH ||
      typeof c.createdAt !== 'number' ||
      !Number.isFinite(c.createdAt) ||
      typeof c.personPublicKey !== 'string' ||
      typeof c.signature !== 'string'
    ) {
      return null
    }
    const fields = {
      devicePublicKey: c.devicePublicKey,
      deviceBoxPublicKey: c.deviceBoxPublicKey,
      deviceName: c.deviceName,
      createdAt: c.createdAt,
      personPublicKey: c.personPublicKey
    }
    const valid = verify(
      null,
      Buffer.from(certificateBody(fields)),
      ed25519PublicKey(fields.personPublicKey),
      Buffer.from(c.signature, 'base64')
    )
    return valid ? { ...fields, signature: c.signature } : null
  } catch {
    return null
  }
}

/** This PC's certificate: its identity and box keys, certified with the person key. */
export function thisDeviceCertificate(db: Database.Database, name: string): DeviceCertificate {
  return certifyDevice(personKeys(db), {
    publicKey: identityKeys(db).publicKey,
    boxPublicKey: boxKeys(db).publicKey,
    name
  })
}

/** The bytes a certificate signs: the fields in this order, as JSON. */
function certificateBody(fields: Omit<DeviceCertificate, 'signature'>): string {
  return JSON.stringify({
    v: 1,
    devicePublicKey: fields.devicePublicKey,
    deviceBoxPublicKey: fields.deviceBoxPublicKey,
    deviceName: fields.deviceName,
    createdAt: fields.createdAt,
    personPublicKey: fields.personPublicKey
  })
}

function readPerson(db: Database.Database): IdentityKeys | null {
  const row = db.prepare('SELECT public_key, private_key FROM sync_person WHERE id = 1').get() as
    { public_key: string; private_key: string } | undefined
  return row ? { publicKey: row.public_key, privateKey: openSecret(row.private_key) } : null
}

/** True when the private key signs something the public key verifies. */
function formPair(keys: IdentityKeys): boolean {
  try {
    const message = Buffer.from('ostler-person-key-check')
    const signature = sign(null, message, ed25519PrivateKey(keys.privateKey))
    return verify(null, message, ed25519PublicKey(keys.publicKey), signature)
  } catch {
    return false
  }
}

function ed25519PrivateKey(base64: string) {
  const key = createPrivateKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'pkcs8' })
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Not an Ed25519 key.')
  return key
}

export function ed25519PublicKey(base64: string) {
  const key = createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' })
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Not an Ed25519 key.')
  return key
}

/** The project's current key, or null when the project isn't shared or has no key yet. */
export function projectKeyFor(db: Database.Database, projectId: string): Buffer | null {
  const row = db
    .prepare('SELECT project_key FROM sync_shares WHERE project_id = @projectId')
    .get({ projectId }) as { project_key: string | null } | undefined
  return row?.project_key ? openKey(row.project_key) : null
}

/** The generation of the project's current key; 0 until someone is removed. */
export function keyGenerationOf(db: Database.Database, projectId: string): number {
  const row = db
    .prepare('SELECT key_generation FROM sync_shares WHERE project_id = @projectId')
    .get({ projectId }) as { key_generation: number } | undefined
  return row?.key_generation ?? 0
}

/** Every generation of the project's key this PC has, for reading files that name one. */
export function projectKeyring(
  db: Database.Database,
  projectId: string
): (generation: number) => Buffer | null {
  const share = db
    .prepare('SELECT share_id FROM sync_shares WHERE project_id = @projectId')
    .get({ projectId }) as { share_id: string } | undefined
  const read = db.prepare(
    'SELECT project_key FROM sync_keys WHERE share_id = @shareId AND generation = @generation'
  )
  const cache = new Map<number, Buffer | null>()
  return (generation: number) => {
    if (!share) return null
    if (!cache.has(generation)) {
      const row = read.get({ shareId: share.share_id, generation }) as
        { project_key: string } | undefined
      cache.set(generation, row ? openKey(row.project_key) : null)
    }
    return cache.get(generation) ?? null
  }
}

/**
 * Seals and stores a shared project's key as `generation` (0 at first). A
 * newer generation also becomes the one new files use. The project must
 * already have a `sync_shares` row.
 */
export function storeProjectKey(
  db: Database.Database,
  projectId: string,
  key: Buffer,
  generation = 0
): void {
  if (key.length !== PROJECT_KEY_BYTES) {
    throw new Error(`A project key must be ${PROJECT_KEY_BYTES} bytes.`)
  }
  const share = db
    .prepare(
      'SELECT share_id, key_generation, project_key FROM sync_shares WHERE project_id = @projectId'
    )
    .get({ projectId }) as
    { share_id: string; key_generation: number; project_key: string | null } | undefined
  if (!share) throw new Error('The project is not shared.')
  const sealed = sealSecret(key.toString('base64'))
  db.transaction(() => {
    db.prepare(
      `INSERT INTO sync_keys (share_id, generation, project_key) VALUES (@shareId, @generation, @sealed)
       ON CONFLICT(share_id, generation) DO UPDATE SET project_key = excluded.project_key`
    ).run({ shareId: share.share_id, generation, sealed })
    if (share.project_key === null || generation >= share.key_generation) {
      db.prepare(
        `UPDATE sync_shares SET project_key = @sealed, key_generation = @generation
         WHERE project_id = @projectId`
      ).run({ sealed, generation, projectId })
    }
  })()
}

function openKey(stored: string): Buffer | null {
  const key = Buffer.from(openSecret(stored), 'base64')
  return key.length === PROJECT_KEY_BYTES ? key : null
}
