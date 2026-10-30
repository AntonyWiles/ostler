import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkScryptParameters,
  decryptProjectFile,
  encryptProjectFile,
  looksProtected,
  PROTECTED_HEADER_BYTES,
  readHeader,
  type ScryptParameters
} from '../../electron/services/protected-project-file'
import { passwordStrength } from '../../src/shared/file-password'
import { useTempDir } from '../helpers/temp-dir'

// The lowest cost the header allows, so the tests stay quick.
const FAST: ScryptParameters = { N: 2 ** 14, r: 8, p: 1 }
const WRONG = /This password does not open the file, or the file is damaged/

const dir = useTempDir('ostler-protected-')
afterEach(() => {})

function plainFile(bytes: Buffer): string {
  const file = path.join(dir(), 'plain.zip')
  fs.writeFileSync(file, bytes)
  return file
}

function protect(bytes: Buffer, password = 'correct horse'): string {
  const target = path.join(dir(), 'protected.ostler-project')
  encryptProjectFile(plainFile(bytes), target, password, FAST)
  return target
}

describe('protected project files (N45)', () => {
  it('round-trips a small file, with the header and tag around the encrypted body', () => {
    const bytes = Buffer.from('PK\u0003\u0004 a tiny project')
    const target = protect(bytes)
    expect(looksProtected(target)).toBe(true)
    expect(looksProtected(plainFile(bytes))).toBe(false)
    const raw = fs.readFileSync(target)
    expect(raw.length).toBe(PROTECTED_HEADER_BYTES + bytes.length + 16)
    expect(raw.includes(Buffer.from('a tiny project'))).toBe(false)
    expect(readHeader(raw.subarray(0, PROTECTED_HEADER_BYTES)).params).toEqual(FAST)

    const out = path.join(dir(), 'out.zip')
    decryptProjectFile(target, out, 'correct horse')
    expect(fs.readFileSync(out).equals(bytes)).toBe(true)
  })

  it('round-trips a large file in chunks', () => {
    const bytes = randomBytes(5 * 1024 * 1024 + 123)
    const target = protect(bytes)
    const out = path.join(dir(), 'out.zip')
    decryptProjectFile(target, out, 'correct horse')
    expect(fs.readFileSync(out).equals(bytes)).toBe(true)
  })

  it('uses a new salt and nonce each time', () => {
    const bytes = Buffer.from('same')
    const one = fs.readFileSync(protect(bytes))
    const two = fs.readFileSync(protect(bytes))
    expect(one.subarray(21, 49).equals(two.subarray(21, 49))).toBe(false)
  })

  it('refuses a wrong password and leaves nothing behind', () => {
    const target = protect(Buffer.from('secret plans'))
    const out = path.join(dir(), 'out.zip')
    expect(() => decryptProjectFile(target, out, 'wrong horse')).toThrow(WRONG)
    expect(fs.existsSync(out)).toBe(false)
  })

  it.each([
    ['the header', 30],
    ['the body', PROTECTED_HEADER_BYTES + 2],
    ['the tag', -1]
  ])('refuses a changed byte in %s, before anything is used', (_part, at) => {
    const target = protect(Buffer.from('secret plans, long enough to change'))
    const raw = fs.readFileSync(target)
    const index = at < 0 ? raw.length + at : at
    raw[index] ^= 0x01
    fs.writeFileSync(target, raw)
    const out = path.join(dir(), 'out.zip')
    expect(() => decryptProjectFile(target, out, 'correct horse')).toThrow(WRONG)
    expect(fs.existsSync(out)).toBe(false)
  })

  it('refuses a cut-short file', () => {
    const target = protect(Buffer.from('secret'))
    fs.writeFileSync(target, fs.readFileSync(target).subarray(0, 40))
    expect(() => decryptProjectFile(target, path.join(dir(), 'out.zip'), 'correct horse')).toThrow(
      WRONG
    )
  })

  it('bounds the scrypt cost a header asks for', () => {
    for (const params of [
      { N: 2 ** 30, r: 8, p: 1 },
      { N: 2 ** 20, r: 16, p: 1 },
      { N: 1000, r: 8, p: 1 },
      { N: 2 ** 10, r: 8, p: 1 },
      { N: 2 ** 14, r: 0, p: 1 },
      { N: 2 ** 14, r: 8, p: 99 }
    ])
      expect(() => checkScryptParameters(params)).toThrow(WRONG)
    expect(() => checkScryptParameters({ N: 2 ** 17, r: 8, p: 1 })).not.toThrow()

    // A hostile header asking for gigabytes is refused before scrypt runs.
    const target = protect(Buffer.from('secret'))
    const raw = fs.readFileSync(target)
    raw.writeUInt32BE(2 ** 30, 9)
    fs.writeFileSync(target, raw)
    const started = Date.now()
    expect(() => decryptProjectFile(target, path.join(dir(), 'out.zip'), 'correct horse')).toThrow(
      WRONG
    )
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('refuses a password shorter than 8 characters when exporting', () => {
    expect(() =>
      encryptProjectFile(plainFile(Buffer.from('x')), path.join(dir(), 'p'), 'short', FAST)
    ).toThrow(/at least 8 characters/)
    expect(fs.existsSync(path.join(dir(), 'p'))).toBe(false)
  })

  it('never puts the password in an error', () => {
    const target = protect(Buffer.from('secret'), 'my-own-password')
    try {
      decryptProjectFile(target, path.join(dir(), 'out.zip'), 'my-guess-password')
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('my-guess-password')
      expect(String((error as Error).stack)).not.toContain('my-guess-password')
    }
  })
})

describe('passwordStrength', () => {
  it('is a hint from length and kinds of character', () => {
    expect(passwordStrength('short')).toBe('tooShort')
    expect(passwordStrength('abcdefgh')).toBe('weak')
    expect(passwordStrength('abcdefgh12')).toBe('fair')
    expect(passwordStrength('Correct-Horse-Battery')).toBe('strong')
  })
})
