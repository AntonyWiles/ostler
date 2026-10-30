import { describe, expect, it } from 'vitest'
import {
  ChangeFileError,
  decodeChangeFile,
  encodeChangeFile,
  newIdentityKeys,
  newProjectKey,
  type ChangeBatch,
  type ChangeFileErrorReason
} from '../../electron/services/sync/change-file'

/** The reason a call refused with; fails the test if it did not refuse with a ChangeFileError. */
function reasonOf(call: () => unknown): ChangeFileErrorReason {
  try {
    call()
  } catch (error) {
    if (error instanceof ChangeFileError) return error.reason
    throw error
  }
  throw new Error('expected the change file to be refused')
}

const batch: ChangeBatch = {
  formatVersion: 1,
  shareId: 'share-1',
  deviceId: 'pc-a',
  memberId: 'member-a',
  sequence: 3,
  changes: [
    {
      table: 'cards',
      rowKey: '["c1"]',
      op: 'upsert',
      columns: { title: 'secret-title-123', done: false },
      stamp: '0001',
      actor: { kind: 'person', personId: 'p1' }
    },
    {
      table: 'cards',
      rowKey: '["c2"]',
      op: 'delete',
      columns: {},
      stamp: '0002',
      actor: { kind: 'system' }
    }
  ]
}

describe('shared-folder change files', () => {
  it('round-trips a batch and keeps its plain values out of the bytes', () => {
    const projectKey = newProjectKey()
    const alice = newIdentityKeys()
    const bytes = encodeChangeFile(batch, { projectKey, privateKey: alice.privateKey })
    const publicKeys: Record<string, string> = { 'member-a': alice.publicKey }

    expect(
      decodeChangeFile(bytes, { projectKey, publicKeyFor: (id) => publicKeys[id] ?? null })
    ).toEqual(batch)
    expect(bytes.includes(Buffer.from('secret-title-123', 'utf8'))).toBe(false)
  })

  it('refuses a changed header, a foreign signer or an unknown member', () => {
    const projectKey = newProjectKey()
    const alice = newIdentityKeys()
    const mallory = newIdentityKeys()
    const bytes = encodeChangeFile(batch, { projectKey, privateKey: alice.privateKey })
    const keysFor = (publicKey: string | null) => ({
      projectKey,
      publicKeyFor: () => publicKey
    })

    // Still valid JSON, but the signed header now says share-9.
    const tampered = Buffer.from(bytes)
    tampered[bytes.indexOf('share-1') + 6] = '9'.charCodeAt(0)
    expect(reasonOf(() => decodeChangeFile(tampered, keysFor(alice.publicKey)))).toBe(
      'bad-signature'
    )

    const signedByMallory = encodeChangeFile(batch, {
      projectKey,
      privateKey: mallory.privateKey
    })
    expect(reasonOf(() => decodeChangeFile(signedByMallory, keysFor(alice.publicKey)))).toBe(
      'bad-signature'
    )

    expect(reasonOf(() => decodeChangeFile(bytes, keysFor(null)))).toBe('unknown-member')
  })

  it('refuses a wrong project key, truncated, foreign and wrong-version files', () => {
    const projectKey = newProjectKey()
    const alice = newIdentityKeys()
    const bytes = encodeChangeFile(batch, { projectKey, privateKey: alice.privateKey })
    const publicKeyFor = () => alice.publicKey

    expect(
      reasonOf(() => decodeChangeFile(bytes, { projectKey: newProjectKey(), publicKeyFor }))
    ).toBe('cannot-decrypt')
    expect(
      reasonOf(() =>
        decodeChangeFile(Buffer.from(bytes.subarray(0, 40)), { projectKey, publicKeyFor })
      )
    ).toBe('truncated')
    expect(
      reasonOf(() =>
        decodeChangeFile(Buffer.from('hello world, not a change file'), {
          projectKey,
          publicKeyFor
        })
      )
    ).toBe('not-a-change-file')

    const version2 = Buffer.from(bytes)
    version2[8] = 2
    expect(reasonOf(() => decodeChangeFile(version2, { projectKey, publicKeyFor }))).toBe(
      'unsupported-version'
    )
  })

  it('will not encode a sequence of 0 or a 16-byte project key', () => {
    const alice = newIdentityKeys()
    expect(() =>
      encodeChangeFile(
        { ...batch, sequence: 0 },
        { projectKey: newProjectKey(), privateKey: alice.privateKey }
      )
    ).toThrow(RangeError)
    expect(() =>
      encodeChangeFile(batch, { projectKey: Buffer.alloc(16), privateKey: alice.privateKey })
    ).toThrow(RangeError)
  })
})
