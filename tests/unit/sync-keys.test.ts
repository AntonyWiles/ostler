import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newIdentityKeys, newProjectKey } from '../../electron/services/sync/change-file'
import {
  boxKeys,
  certifyDevice,
  identityKeys,
  personKeys,
  projectKeyFor,
  storePersonKeys,
  storeProjectKey,
  thisDeviceCertificate,
  verifyDeviceCertificate
} from '../../electron/services/sync/sync-keys'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

// A stand-in for Windows encryption, switched on per test, so sealing can be seen.
const encryption = vi.hoisted(() => ({ available: false }))
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => encryption.available,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^sealed:/, '')
  }
}))

const SHARED = 'shared-project'

describe('sync keys', () => {
  const tempDir = useTempDir('ostler-sync-keys-')
  let db: Database.Database

  beforeEach(async () => {
    encryption.available = false
    const dbPath = await createMigratedDatabase(tempDir())
    db = new Database(dbPath)
    db.prepare(
      `INSERT INTO sync_shares (project_id, share_id, folder, member_id, device_id, format_version, created_at)
       VALUES (?, 'share-1', 'x', 'm1', 'dev-a', 1, 1)`
    ).run(SHARED)
  })

  afterEach(() => {
    db.close()
  })

  const storedIdentity = () =>
    db.prepare('SELECT public_key, private_key FROM sync_identity').all() as {
      public_key: string
      private_key: string
    }[]

  it('makes the identity once and returns the same pair afterwards', () => {
    const first = identityKeys(db)
    const second = identityKeys(db)

    expect(second).toEqual(first)
    expect(first.publicKey).not.toBe(first.privateKey)
    expect(storedIdentity()).toHaveLength(1)
  })

  it('stores the private key sealed when encryption is available, and opens it again', () => {
    encryption.available = true
    const keys = identityKeys(db)

    const [row] = storedIdentity()
    expect(row.public_key).toBe(keys.publicKey)
    expect(row.private_key).not.toBe(keys.privateKey)
    expect(row.private_key).not.toContain(keys.privateKey)
    expect(identityKeys(db).privateKey).toBe(keys.privateKey)
  })

  it('round-trips a project key, sealed in sync_shares', () => {
    encryption.available = true
    const key = newProjectKey()
    storeProjectKey(db, SHARED, key)

    expect(projectKeyFor(db, SHARED)?.equals(key)).toBe(true)
    const stored = (
      db.prepare('SELECT project_key FROM sync_shares WHERE project_id = ?').get(SHARED) as {
        project_key: string
      }
    ).project_key
    expect(stored).not.toContain(key.toString('base64'))
  })

  it('round-trips a project key where Windows encryption is unavailable', () => {
    const key = newProjectKey()
    storeProjectKey(db, SHARED, key)
    expect(projectKeyFor(db, SHARED)?.equals(key)).toBe(true)
  })

  it('returns null for a project that is not shared or has no key yet', () => {
    expect(projectKeyFor(db, SHARED)).toBeNull()
    expect(projectKeyFor(db, 'other-project')).toBeNull()
  })

  it('refuses to store a key for an unshared project or of the wrong length', () => {
    expect(() => storeProjectKey(db, 'other-project', newProjectKey())).toThrow(/not shared/)
    expect(() => storeProjectKey(db, SHARED, Buffer.alloc(16))).toThrow(/32 bytes/)
    expect(projectKeyFor(db, SHARED)).toBeNull()
  })

  describe('person key and device certificates', () => {
    const device = () => ({
      publicKey: newIdentityKeys().publicKey,
      boxPublicKey: newIdentityKeys().publicKey,
      name: 'Ann laptop'
    })

    it('makes the person key once and returns the same pair from another connection', () => {
      const first = personKeys(db)
      expect(personKeys(db)).toEqual(first)

      const other = new Database(db.name)
      try {
        expect(personKeys(other)).toEqual(first)
      } finally {
        other.close()
      }
      expect(first.publicKey).not.toBe(identityKeys(db).publicKey)
      const rows = db.prepare('SELECT source FROM sync_person').all()
      expect(rows).toEqual([{ source: 'made' }])
    })

    it('stores the person private key sealed when encryption is available, and opens it again', () => {
      encryption.available = true
      const keys = personKeys(db)

      const row = db.prepare('SELECT private_key FROM sync_person').get() as { private_key: string }
      expect(row.private_key).not.toBe(keys.privateKey)
      expect(row.private_key).not.toContain(keys.privateKey)
      expect(personKeys(db).privateKey).toBe(keys.privateKey)
    })

    it('verifies a certificate made with the person key', () => {
      const person = personKeys(db)
      const cert = certifyDevice(person, device(), 1000)

      expect(cert.personPublicKey).toBe(person.publicKey)
      expect(verifyDeviceCertificate(cert)).toEqual(cert)
    })

    it('fails verification when any signed field is changed', () => {
      const person = personKeys(db)
      const cert = certifyDevice(person, device(), 1000)

      expect(verifyDeviceCertificate({ ...cert, deviceName: 'Ann desktop' })).toBeNull()
      expect(
        verifyDeviceCertificate({ ...cert, devicePublicKey: newIdentityKeys().publicKey })
      ).toBeNull()
      expect(
        verifyDeviceCertificate({ ...cert, deviceBoxPublicKey: newIdentityKeys().publicKey })
      ).toBeNull()
      expect(verifyDeviceCertificate({ ...cert, createdAt: 1001 })).toBeNull()
      expect(
        verifyDeviceCertificate({ ...cert, personPublicKey: newIdentityKeys().publicKey })
      ).toBeNull()
    })

    it('fails verification for a certificate signed by a different person key', () => {
      const cert = certifyDevice(newIdentityKeys(), device(), 1000)
      const forged = { ...cert, personPublicKey: personKeys(db).publicKey }

      expect(verifyDeviceCertificate(cert)).toEqual(cert)
      expect(verifyDeviceCertificate(forged)).toBeNull()
    })

    it('returns null for garbage input without throwing', () => {
      expect(verifyDeviceCertificate(null)).toBeNull()
      expect(verifyDeviceCertificate(undefined)).toBeNull()
      expect(verifyDeviceCertificate({})).toBeNull()
      expect(verifyDeviceCertificate(42)).toBeNull()
      expect(verifyDeviceCertificate('certificate')).toBeNull()
      const cert = certifyDevice(personKeys(db), device(), 1000)
      expect(verifyDeviceCertificate({ ...cert, signature: 'not-a-signature' })).toBeNull()
      expect(verifyDeviceCertificate({ ...cert, personPublicKey: 'not-a-key' })).toBeNull()
      expect(verifyDeviceCertificate({ ...cert, createdAt: Number.NaN })).toBeNull()
      const person = personKeys(db)
      const longName = (length: number) =>
        certifyDevice(person, { ...device(), name: 'x'.repeat(length) }, 1000)
      expect(verifyDeviceCertificate(longName(101))).toBeNull()
      expect(verifyDeviceCertificate(longName(100))).not.toBeNull()
    })

    it('refuses to store a person key pair whose halves do not match', () => {
      const a = newIdentityKeys()
      const b = newIdentityKeys()

      expect(() =>
        storePersonKeys(db, { publicKey: b.publicKey, privateKey: a.privateKey }, 'paired')
      ).toThrow(/do not form a pair/)
      expect(db.prepare('SELECT COUNT(*) AS n FROM sync_person').get()).toEqual({ n: 0 })

      storePersonKeys(db, a, 'paired')
      expect(personKeys(db)).toEqual(a)
      expect(db.prepare('SELECT source FROM sync_person').get()).toEqual({ source: 'paired' })
    })

    it('certifies this PC with its identity and box keys under the person key', () => {
      const cert = thisDeviceCertificate(db, 'Ann laptop')

      expect(verifyDeviceCertificate(cert)).toEqual(cert)
      expect(cert.devicePublicKey).toBe(identityKeys(db).publicKey)
      expect(cert.deviceBoxPublicKey).toBe(boxKeys(db).publicKey)
      expect(cert.personPublicKey).toBe(personKeys(db).publicKey)
      expect(cert.deviceName).toBe('Ann laptop')
    })
  })
})
