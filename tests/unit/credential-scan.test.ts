import { describe, it, expect } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { credentialReason, readZipEntry, scanBuffer } from '../../scripts/lib/credential-scan.cjs'
import { contentProblems } from '../../scripts/check-hygiene.cjs'

// Made-up values, built at run time so no credential-shaped literal sits in this file.
const fakeId = 'f'.repeat(32)
const fakeSecret = 'e'.repeat(64)
const setup = JSON.stringify({
  config: {
    accountId: 'a'.repeat(32),
    bucket: 'test',
    accessKeyId: fakeId,
    secretAccessKey: fakeSecret
  },
  space: 'test',
  checkMinutes: 5
})
const encoded = Buffer.from(setup, 'utf8').toString('base64')

describe('credential-scan', () => {
  it('finds bucket credentials written out', () => {
    expect(credentialReason(`secretAccessKey: '${fakeSecret}'`)).toBe('bucket credential')
    expect(credentialReason(`R2_ACCESS_KEY_ID=${fakeId}`)).toBe('bucket credential')
    expect(credentialReason(`"accessKeyId": "${fakeId}"`)).toBe('bucket credential')
  })

  it('finds them base64-encoded, even packed against other strings', () => {
    expect(credentialReason(encoded)).toBe('base64-encoded bucket credential')
    for (const before of ['x', 'xy', 'xyz', 'wxyz']) {
      expect(credentialReason(`${before}${encoded}more`), before).toBe(
        'base64-encoded bucket credential'
      )
    }
    expect(
      credentialReason(`EXPO_PUBLIC_OSTLER_BUILT_IN_R2=${encoded.slice(0, 30)}`)
    ).not.toBeNull()
  })

  it('leaves empty fields, labels and short test values alone', () => {
    for (const text of [
      "secretAccessKey: '',",
      '"accessKeyId": "Access key ID",',
      "secretAccessKey: 'test-secret'",
      'const built = process.env.EXPO_PUBLIC_OSTLER_BUILT_IN_R2',
      Buffer.from('a long run of ordinary text with no keys in it at all, none').toString('base64')
    ]) {
      expect(credentialReason(text), text).toBeNull()
    }
  })

  it('names the secret file, never the value', () => {
    const hits = scanBuffer(Buffer.from(`bundle ${fakeSecret} bundle`), [
      [fakeSecret, 'secret from r2.json']
    ])
    expect(hits).toEqual(['secret from r2.json'])
    expect(hits.join()).not.toContain(fakeSecret)
  })

  it('reads one file out of a zip, stored or deflated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'credential-scan-'))
    try {
      const entries = [
        { name: 'a.txt', data: Buffer.from('stored'), method: 0 },
        { name: 'base/assets/index.android.bundle', data: Buffer.from(encoded), method: 8 }
      ]
      const locals: Buffer[] = []
      const centrals: Buffer[] = []
      let offset = 0
      for (const { name, data, method } of entries) {
        const body = method === 8 ? deflateRawSync(data) : data
        const local = Buffer.alloc(30)
        local.writeUInt32LE(0x04034b50, 0)
        local.writeUInt16LE(method, 8)
        local.writeUInt32LE(body.length, 18)
        local.writeUInt32LE(data.length, 22)
        local.writeUInt16LE(name.length, 26)
        const central = Buffer.alloc(46)
        central.writeUInt32LE(0x02014b50, 0)
        central.writeUInt16LE(method, 10)
        central.writeUInt32LE(body.length, 20)
        central.writeUInt32LE(data.length, 24)
        central.writeUInt16LE(name.length, 28)
        central.writeUInt32LE(offset, 42)
        const record = Buffer.concat([local, Buffer.from(name), body])
        locals.push(record)
        centrals.push(Buffer.concat([central, Buffer.from(name)]))
        offset += record.length
      }
      const directory = Buffer.concat(centrals)
      const end = Buffer.alloc(22)
      end.writeUInt32LE(0x06054b50, 0)
      end.writeUInt16LE(entries.length, 10)
      end.writeUInt32LE(directory.length, 12)
      end.writeUInt32LE(offset, 16)
      const file = join(dir, 'app.aab')
      writeFileSync(file, Buffer.concat([...locals, directory, end]))
      expect(readZipEntry(file, 'a.txt')?.toString()).toBe('stored')
      const js = readZipEntry(file, 'base/assets/index.android.bundle')
      expect(js && scanBuffer(js, [])).toEqual(['base64-encoded bucket credential'])
      expect(readZipEntry(file, 'missing')).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('makes check-hygiene refuse a committed credential unless the line allows it', () => {
    const text = [
      `const key = '${fakeSecret}'`,
      `secretAccessKey: '${fakeSecret}'`,
      `x = '${encoded}'`
    ].join('\n')
    expect(contentProblems('c.ts', text, [])).toEqual([
      'c.ts:2: bucket credential',
      'c.ts:3: base64-encoded bucket credential'
    ])
    expect(
      contentProblems('d.ts', `secretAccessKey: '${fakeSecret}' // hygiene-allow: fake`, [])
    ).toEqual([])
  })
})
