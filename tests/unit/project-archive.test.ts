import fs from 'node:fs'
import path from 'node:path'
import { zipSync, type Zippable } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  checkName,
  extractProjectArchive,
  writeProjectArchive
} from '../../electron/services/project-archive'
import { useTempDir } from '../helpers/temp-dir'

const tempDir = useTempDir('ostler-archive-')
let unpackRoot: string

beforeEach(() => {
  unpackRoot = path.join(tempDir(), 'unpack')
  fs.mkdirSync(unpackRoot)
})

const PROJECT = new TextEncoder().encode('{"format":"ostler-project-package"}')

function zipFile(files: Zippable, name = 'hostile.ostler-project'): string {
  const filePath = path.join(tempDir(), name)
  fs.writeFileSync(filePath, zipSync(files))
  return filePath
}

/** Extracts into a new folder under the unpack root; the root must be empty afterwards on refusal. */
function extract(filePath: string, limits?: { maxEntries: number; maxTotalBytes: number }) {
  return extractProjectArchive(filePath, path.join(unpackRoot, 'one'), limits)
}

describe('the project file', () => {
  it('round-trips project.json and Library files bigger than one read', () => {
    const big = Buffer.alloc(3 * 1024 * 1024 + 17)
    for (let index = 0; index < big.length; index++) big[index] = (index * 31) % 251
    const source = path.join(tempDir(), 'big.bin')
    fs.writeFileSync(source, big)
    const target = path.join(tempDir(), 'Party.ostler-project')
    writeProjectArchive(target, [
      { name: 'project.json', text: '{"a":1}\n' },
      { name: 'library/big.bin', filePath: source }
    ])
    const folder = extract(target)
    expect(fs.readFileSync(path.join(folder, 'project.json'), 'utf8')).toBe('{"a":1}\n')
    expect(fs.readFileSync(path.join(folder, 'library', 'big.bin')).equals(big)).toBe(true)
  })

  it('leaves nothing behind when a write fails', () => {
    const target = path.join(tempDir(), 'Party.ostler-project')
    expect(() =>
      writeProjectArchive(target, [
        { name: 'project.json', text: '{}' },
        { name: 'library/missing.png', filePath: path.join(tempDir(), 'missing.png') }
      ])
    ).toThrow()
    expect(fs.existsSync(target)).toBe(false)
  })
})

describe('a hostile project file is refused with a plain message', () => {
  const cases: [string, Zippable, RegExp][] = [
    [
      'a .. entry',
      { 'project.json': PROJECT, 'library/../../evil.txt': PROJECT },
      /outside the project/
    ],
    ['an absolute path', { 'project.json': PROJECT, '/etc/evil.txt': PROJECT }, /absolute path/],
    ['a drive letter', { 'project.json': PROJECT, 'C:/evil.txt': PROJECT }, /names a drive/],
    [
      'a file outside library/',
      { 'project.json': PROJECT, 'scripts/run.cmd': PROJECT },
      /not part of an? .* project/
    ],
    ['a stream name', { 'project.json': PROJECT, 'library/a.txt:hidden': PROJECT }, /not part of/],
    ['no project.json', { 'library/a.txt': PROJECT }, /no project\.json/]
  ]
  for (const [label, files, message] of cases) {
    it(`refuses ${label}, and leaves nothing unpacked`, () => {
      expect(() => extract(zipFile(files))).toThrow(message)
      expect(fs.readdirSync(unpackRoot)).toEqual([])
    })
  }

  it('refuses a link', () => {
    const files: Zippable = {
      'project.json': PROJECT,
      'library/link': [new TextEncoder().encode('/etc/passwd'), { os: 3, attrs: 0o120777 << 16 }]
    }
    expect(() => extract(zipFile(files))).toThrow(/is a link/)
    expect(fs.readdirSync(unpackRoot)).toEqual([])
  })

  it('refuses too many entries', () => {
    const files: Zippable = { 'project.json': PROJECT }
    for (let index = 0; index < 5; index++) files[`library/${index}.txt`] = PROJECT
    expect(() => extract(zipFile(files), { maxEntries: 4, maxTotalBytes: 1e9 })).toThrow(
      /more than 4 files/
    )
    expect(fs.readdirSync(unpackRoot)).toEqual([])
  })

  it('refuses a file too large when uncompressed', () => {
    const files: Zippable = {
      'project.json': PROJECT,
      'library/zeros.bin': new Uint8Array(64 * 1024)
    }
    expect(() => extract(zipFile(files), { maxEntries: 100, maxTotalBytes: 32 * 1024 })).toThrow(
      /unpacks to more than/
    )
    expect(fs.readdirSync(unpackRoot)).toEqual([])
  })

  it('refuses a Library file bigger than the Library takes, however small it is packed', () => {
    const files: Zippable = {
      'project.json': PROJECT,
      'library/zeros.bin': new Uint8Array(26 * 1024 * 1024)
    }
    expect(() => extract(zipFile(files))).toThrow(/larger than the Library takes/)
    expect(fs.readdirSync(unpackRoot)).toEqual([])
  })

  it('refuses a file that is not a zip', () => {
    const filePath = path.join(tempDir(), 'notes.ostler-project')
    fs.writeFileSync(filePath, 'just text')
    expect(() => extract(filePath)).toThrow(/not an? .* project file/)
    expect(fs.readdirSync(unpackRoot)).toEqual([])
  })

  it('checks names with either separator', () => {
    expect(() => checkName('library\\..\\evil.txt')).toThrow(/outside the project/)
    expect(() => checkName('\\evil.txt')).toThrow(/absolute path/)
    expect(() => checkName('library/CON')).toThrow(/not part of/)
    expect(() => checkName('library/Guest list.txt')).not.toThrow()
    expect(() => checkName('project.json')).not.toThrow()
  })
})
