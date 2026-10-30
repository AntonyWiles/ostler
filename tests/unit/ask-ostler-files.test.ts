import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { bestPassage, searchFolderFiles } from '../../electron/services/ask-ostler-files'

const folders: string[] = []

function folder(files: Record<string, string | Buffer>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-ask-files-'))
  folders.push(root)
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), content)
  }
  return root
}

function git(root: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd: root,
    stdio: 'ignore'
  })
}

afterEach(() => {
  for (const root of folders.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

const numbered = (count: number, at: number, text: string) =>
  Array.from({ length: count }, (_, index) => (index + 1 === at ? text : `line ${index + 1}`)).join(
    '\n'
  )

describe('searchFolderFiles', () => {
  it('finds a passage: the matching line with five lines around it', async () => {
    const root = folder({
      'notes/tiles.md': numbered(30, 12, 'We chose grey tiles for the bathroom')
    })
    const { passages, cutShort } = await searchFolderFiles('p', { root, ignorePatterns: [] }, [
      'grey tiles'
    ])
    expect(cutShort).toBe(false)
    expect(passages).toHaveLength(1)
    expect(passages[0]).toMatchObject({
      projectId: 'p',
      path: 'notes/tiles.md',
      startLine: 7,
      endLine: 17
    })
    expect(passages[0].text.split('\n')).toHaveLength(11)
    expect(passages[0].text).toContain('We chose grey tiles')
  })

  it('needs every word of a query somewhere in the file', async () => {
    const root = folder({ 'a.md': 'grey paint', 'b.md': 'grey\n\ntiles' })
    const { passages } = await searchFolderFiles('p', { root, ignorePatterns: [] }, ['grey tiles'])
    expect(passages.map((passage) => passage.path)).toEqual(['b.md'])
  })

  it('skips ignored, binary and over-size files', async () => {
    const root = folder({
      '.gitignore': 'private.md\n',
      'private.md': 'grey tiles',
      'image.bin': Buffer.from([0x67, 0x72, 0x65, 0x79, 0x00, 0x74, 0x69, 0x6c, 0x65, 0x73]),
      'big.md': `grey tiles ${'x'.repeat(2000)}`,
      'small.md': 'grey tiles'
    })
    git(root, 'init', '-q')
    const { passages } = await searchFolderFiles(
      'p',
      { root, ignorePatterns: [] },
      ['grey tiles'],
      {
        maxBytes: 1000
      }
    )
    expect(passages.map((passage) => passage.path)).toEqual(['small.md'])
  })

  it('stops at the file limit and says it was cut short', async () => {
    const root = folder({ 'a.md': 'tiles', 'b.md': 'tiles', 'c.md': 'tiles' })
    const result = await searchFolderFiles('p', { root, ignorePatterns: [] }, ['tiles'], {
      maxFiles: 2
    })
    expect(result.passages).toHaveLength(2)
    expect(result.cutShort).toBe(true)
  })

  it('stops at the time limit and says it was cut short', async () => {
    const root = folder({ 'a.md': 'tiles', 'b.md': 'tiles', 'c.md': 'tiles' })
    let clock = 0
    const result = await searchFolderFiles('p', { root, ignorePatterns: [] }, ['tiles'], {
      maxMs: 3000,
      now: () => {
        clock += 1000
        return clock
      }
    })
    expect(result.cutShort).toBe(true)
    expect(result.passages.length).toBeLessThan(3)
  })

  it('reads nothing without a query', async () => {
    const root = folder({ 'a.md': 'tiles' })
    expect(await searchFolderFiles('p', { root, ignorePatterns: [] }, [])).toEqual({
      passages: [],
      cutShort: false
    })
  })
})

describe('bestPassage', () => {
  it('keeps the best query: the one with more of its words in the passage', () => {
    const passage = bestPassage('plumber\nnothing\nplumber due friday', [
      ['plumber'],
      ['plumber', 'friday']
    ])
    expect(passage?.score).toBe(-2)
    expect(passage?.startLine).toBe(1)
  })
})
