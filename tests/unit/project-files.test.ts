import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildProjectFileEvidence,
  listProjectFiles,
  parseReadRequests,
  pathsNamedIn,
  projectFileBudgetChars,
  readProjectFile,
  readProjectFolder,
  stripReadRequests
} from '../../electron/services/project-files'
import { stripProposalBlocks } from '../../src/shared/chat-proposals'

const folders: string[] = []

function folder(files: Record<string, string | Buffer>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-project-files-'))
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

describe('listProjectFiles', () => {
  it("uses Git's list in a folder with history: ignored files out, new files in", async () => {
    const root = folder({
      '.gitignore': 'secret.txt\n',
      'README.md': 'hello',
      'secret.txt': 'no',
      'src/app.ts': 'x'
    })
    git(root, 'init', '-q')
    git(root, 'add', 'README.md', '.gitignore')
    git(root, 'commit', '-q', '-m', 'first')
    expect(await listProjectFiles(root)).toEqual(['.gitignore', 'README.md', 'src/app.ts'])
  })

  it('walks a folder without history, skipping dependencies and ignore patterns', async () => {
    const root = folder({
      'README.md': 'hello',
      'node_modules/lib/index.js': 'x',
      'notes/draft.md': 'x',
      'notes/private.md': 'x'
    })
    expect(await listProjectFiles(root, ['notes/private.md'])).toEqual([
      'README.md',
      'notes/draft.md'
    ])
  })
})

describe('readProjectFile', () => {
  it('reads text, leaves binary files out and refuses paths outside the folder', () => {
    const root = folder({ 'a.txt': 'text', 'b.bin': Buffer.from([1, 0, 2]) })
    expect(readProjectFile(root, 'a.txt')).toEqual({ path: 'a.txt', content: 'text' })
    expect(readProjectFile(root, 'b.bin')).toBeNull()
    expect(readProjectFile(root, 'missing.txt')).toBeNull()
    expect(() => readProjectFile(root, '../outside.txt')).toThrow('outside the project folder')
  })
})

describe('readProjectFolder', () => {
  it("reads a folder's files in path order and names what did not fit", async () => {
    const root = folder({
      'roles/a.md': 'aaaa',
      'roles/b.md': 'bbbb',
      'roles/c.md': 'cccc',
      'other.md': 'x'
    })
    const read = await readProjectFolder(root, 'roles/', 9)
    expect(read.files.map((file) => file.path)).toEqual(['roles/a.md', 'roles/b.md'])
    expect(read.omitted).toEqual(['roles/c.md'])
    expect(read.note).toContain('roles/c.md')
  })
})

describe('pathsNamedIn', () => {
  const listing = ['README.md', 'marketing/agents/roles/writer.md', 'src/app.ts']

  it('finds files and folders a message names, and nothing else', () => {
    expect(
      pathsNamedIn('Make tasks from the prompts in marketing/agents/roles/ and README.md', listing)
    ).toEqual(['README.md', 'marketing/agents/roles'])
    expect(pathsNamedIn('What is the plan?', listing)).toEqual([])
  })

  it('reads a folder once, not also each file inside it', () => {
    expect(pathsNamedIn('marketing/agents and marketing/agents/roles/writer.md', listing)).toEqual([
      'marketing/agents'
    ])
  })
})

describe('the ostler-read block', () => {
  const reply = 'Let me look.\n```ostler-read\nsrc/app.ts\n- README.md\n```\n'

  it('parses one path per line or a JSON list', () => {
    expect(parseReadRequests(reply)).toEqual(['src/app.ts', 'README.md'])
    expect(parseReadRequests('```ostler-read\n["a.md"]\n```')).toEqual(['a.md'])
  })

  it('is hidden from the person, while streaming and after', () => {
    expect(stripReadRequests(reply)).toBe('Let me look.')
    expect(stripProposalBlocks(reply)).toBe('Let me look.')
    expect(stripProposalBlocks('Let me look.\n```ostler-re')).toBe('Let me look.')
  })
})

describe('the file budget', () => {
  it('is 60% of the context size, about four characters a token', () => {
    expect(projectFileBudgetChars(100_000)).toBe(240_000)
    expect(projectFileBudgetChars(undefined)).toBe(240_000)
    expect(projectFileBudgetChars(1)).toBe(projectFileBudgetChars(8_000))
  })
})

describe('buildProjectFileEvidence', () => {
  it('sends the list, the overview documents and the named files', async () => {
    const root = folder({ 'README.md': 'About', 'docs/overview.md': 'Plan', 'src/a.ts': 'code' })
    const evidence = await buildProjectFileEvidence(
      { root, ignorePatterns: [] },
      { budgetChars: 1000, overview: true, namedIn: ['change src/a.ts'] }
    )
    expect(evidence.folderFiles?.paths).toEqual(['README.md', 'docs/overview.md', 'src/a.ts'])
    expect(evidence.projectFiles?.map((file) => file.path)).toEqual([
      'src/a.ts',
      'README.md',
      'docs/overview.md'
    ])
  })

  it('sends nothing for a project without a folder', async () => {
    expect(await buildProjectFileEvidence(null, { budgetChars: 1000 })).toEqual({})
  })
})
