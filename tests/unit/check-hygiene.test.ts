import { describe, it, expect } from 'vitest'
import {
  contentProblems,
  forbiddenPathReason,
  personalPatterns
} from '../../scripts/check-hygiene.cjs'

describe('check-hygiene', () => {
  it('refuses logs, build output, databases, env files and scratch files', () => {
    for (const file of [
      'build.log',
      'logs/server.txt',
      'out/main/index.js',
      'dist/app.exe',
      'node_modules/x/index.js',
      'tsconfig.tsbuildinfo',
      'data/ostler.db',
      '.env',
      '.env.local',
      'notes.bak',
      'scratch/try.ts',
      '.claude/settings.local.json',
      'i18n-dump.txt',
      'secrets/r2-dev.json'
    ]) {
      expect(forbiddenPathReason(file), file).not.toBeNull()
    }
  })

  it('allows ordinary source, docs and the env example', () => {
    for (const file of [
      'src/main/index.ts',
      'docs/guide.md',
      '.env.example',
      'build/icons/16x16.png',
      'scripts/build-analyze.cjs'
    ]) {
      expect(forbiddenPathReason(file), file).toBeNull()
    }
  })

  it('flags secrets and personal mailboxes, but not example addresses', () => {
    const text = [
      "const key = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'", // hygiene-allow: fake key under test
      "const who = 'someone@gmail.com'", // hygiene-allow: fake address under test
      "const fine = 'ann@example.com'",
      "const allowed = 'ann@icloud.com' // hygiene-allow"
    ].join('\n')
    expect(contentProblems('a.ts', text, [])).toEqual([
      'a.ts:1: Anthropic API key',
      'a.ts:2: personal email address'
    ])
  })

  it("flags the committer's email and home-folder paths", () => {
    const personal = personalPatterns({
      email: 'me@mydomain.nz',
      userName: 'jordan',
      homeDir: 'C:\\Users\\jordan'
    })
    const text = ['contact me@mydomain.nz', 'C:\\Users\\jordan\\code', '/home/jordan/x', 'ok'].join(
      '\n'
    )
    expect(contentProblems('b.md', text, personal)).toEqual([
      "b.md:1: committer's own email",
      'b.md:2: path to your home folder',
      'b.md:3: path to your home folder'
    ])
  })

  it('ignores a GitHub noreply email', () => {
    const personal = personalPatterns({ email: '1+me@users.noreply.github.com' })
    expect(contentProblems('c.md', '1+me@users.noreply.github.com', personal)).toEqual([])
  })
})
