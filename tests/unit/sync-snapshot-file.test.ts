import { describe, expect, it } from 'vitest'
import { newIdentityKeys, newProjectKey } from '../../electron/services/sync/change-file'
import {
  decodeSnapshot,
  encodeSnapshot,
  SnapshotFileError,
  type Snapshot,
  type SnapshotFileErrorReason
} from '../../electron/services/sync/snapshot-file'

/** The reason a call refused with; fails the test if it did not refuse with a SnapshotFileError. */
function reasonOf(call: () => unknown): SnapshotFileErrorReason {
  try {
    call()
  } catch (error) {
    if (error instanceof SnapshotFileError) return error.reason
    throw error
  }
  throw new Error('expected the snapshot to be refused')
}

const snapshot: Snapshot = {
  formatVersion: 1,
  shareId: 'share-1',
  deviceId: 'pc-a',
  memberId: 'member-a',
  stamp: '000000000000010-000000-pc-a',
  applied: { 'pc-a': 4, 'pc-b': 7 },
  rows: {
    planning_work_items: [{ id: 't1', project_id: 'p1', title: 'secret-title-123' }],
    planning_comments: []
  },
  stamps: [['planning_work_items', '["t1"]', 'title', '000000000000010-000000-pc-a']]
}

describe('shared-folder snapshots', () => {
  it('round-trips a snapshot and keeps its plain values out of the bytes', () => {
    const projectKey = newProjectKey()
    const alice = newIdentityKeys()
    const bytes = encodeSnapshot(snapshot, { projectKey, privateKey: alice.privateKey })

    expect(
      decodeSnapshot(bytes, {
        projectKey,
        publicKeyFor: (id) => (id === 'member-a' ? alice.publicKey : null)
      })
    ).toEqual(snapshot)
    expect(bytes.includes(Buffer.from('secret-title-123', 'utf8'))).toBe(false)
    expect(bytes.subarray(0, 8).toString('ascii')).toBe('OSTLERSN')
  })

  it('refuses a changed header, a foreign signer or an unknown member', () => {
    const projectKey = newProjectKey()
    const alice = newIdentityKeys()
    const mallory = newIdentityKeys()
    const bytes = encodeSnapshot(snapshot, { projectKey, privateKey: alice.privateKey })
    const keysFor = (publicKey: string | null) => ({ projectKey, publicKeyFor: () => publicKey })

    const tampered = Buffer.from(bytes)
    tampered[bytes.indexOf('share-1') + 6] = '9'.charCodeAt(0)
    expect(reasonOf(() => decodeSnapshot(tampered, keysFor(alice.publicKey)))).toBe('bad-signature')

    const signedByMallory = encodeSnapshot(snapshot, {
      projectKey,
      privateKey: mallory.privateKey
    })
    expect(reasonOf(() => decodeSnapshot(signedByMallory, keysFor(alice.publicKey)))).toBe(
      'bad-signature'
    )
    expect(reasonOf(() => decodeSnapshot(bytes, keysFor(null)))).toBe('unknown-member')
  })

  it('refuses a wrong project key, truncated, foreign, change-file and wrong-version files', () => {
    const projectKey = newProjectKey()
    const alice = newIdentityKeys()
    const bytes = encodeSnapshot(snapshot, { projectKey, privateKey: alice.privateKey })
    const publicKeyFor = () => alice.publicKey

    expect(
      reasonOf(() => decodeSnapshot(bytes, { projectKey: newProjectKey(), publicKeyFor }))
    ).toBe('cannot-decrypt')
    expect(
      reasonOf(() =>
        decodeSnapshot(Buffer.from(bytes.subarray(0, 40)), { projectKey, publicKeyFor })
      )
    ).toBe('truncated')
    expect(
      reasonOf(() =>
        decodeSnapshot(Buffer.from('not a snapshot at all'), { projectKey, publicKeyFor })
      )
    ).toBe('not-a-change-file')

    const changeFile = Buffer.from(bytes)
    changeFile.write('OSTLERCH', 0, 'ascii')
    expect(reasonOf(() => decodeSnapshot(changeFile, { projectKey, publicKeyFor }))).toBe(
      'not-a-change-file'
    )

    const version2 = Buffer.from(bytes)
    version2[8] = 2
    expect(reasonOf(() => decodeSnapshot(version2, { projectKey, publicKeyFor }))).toBe(
      'unsupported-version'
    )
  })

  it('will not encode negative applied sequences or a 16-byte project key', () => {
    const alice = newIdentityKeys()
    expect(() =>
      encodeSnapshot(
        { ...snapshot, applied: { 'pc-a': -1 } },
        { projectKey: newProjectKey(), privateKey: alice.privateKey }
      )
    ).toThrow(RangeError)
    expect(() =>
      encodeSnapshot(snapshot, { projectKey: Buffer.alloc(16), privateKey: alice.privateKey })
    ).toThrow(RangeError)
  })
})
