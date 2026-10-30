import { describe, expect, it } from 'vitest'
import {
  githubLinkName,
  githubLinkUrl,
  normalizeGithubRepositorySetting,
  parseGithubReference,
  parseGithubRepository
} from '../../src/shared/github/github-reference'

describe('parseGithubReference (R4.4)', () => {
  it('reads issue and pull request URLs', () => {
    expect(parseGithubReference('https://github.com/acme/site/issues/12', null)).toEqual({
      owner: 'acme',
      repo: 'site',
      number: 12,
      kind: 'issue'
    })
    expect(parseGithubReference('https://github.com/acme/site/pull/7/files#diff', null)).toEqual({
      owner: 'acme',
      repo: 'site',
      number: 7,
      kind: 'pull'
    })
    expect(parseGithubReference('github.com/acme/site.js/issues/3?x=1', null)).toMatchObject({
      repo: 'site.js',
      number: 3
    })
    expect(parseGithubReference(' https://www.github.com/a-b/c_d/pull/1 ', null)).toMatchObject({
      owner: 'a-b',
      repo: 'c_d',
      kind: 'pull'
    })
  })

  it('reads #123 against the project repository, and owner/repo#123 on its own', () => {
    expect(parseGithubReference('#45', 'acme/site')).toEqual({
      owner: 'acme',
      repo: 'site',
      number: 45,
      kind: null
    })
    expect(parseGithubReference('45', 'acme/site')).toMatchObject({ number: 45 })
    expect(parseGithubReference('other/thing#9', 'acme/site')).toEqual({
      owner: 'other',
      repo: 'thing',
      number: 9,
      kind: null
    })
    expect(() => parseGithubReference('#45', '')).toThrow(/repository/)
    expect(() => parseGithubReference('#45', null)).toThrow(/repository/)
  })

  it('refuses other hosts', () => {
    for (const text of [
      'https://gitlab.com/acme/site/issues/1',
      'https://github.example.com/acme/site/issues/1',
      'https://api.github.com/repos/acme/site/issues/1',
      'https://gist.github.com/acme/1'
    ])
      expect(() => parseGithubReference(text, 'acme/site'), text).toThrow()
    expect(() => parseGithubReference('https://gitlab.com/acme/site/issues/1', null)).toThrow(
      /github\.com/
    )
  })

  it('refuses junk', () => {
    for (const text of [
      '',
      '   ',
      '#',
      '#0',
      '#-3',
      '#12a',
      '#99999999999',
      'acme/site',
      'https://github.com/acme/site',
      'https://github.com/acme/site/commits/12',
      'https://github.com/acme/site/issues/abc',
      'https://github.com/-acme/site/issues/1',
      'https://github.com/acme/../issues/1',
      'https://user:pw@github.com/acme/site/issues/1',
      'ftp://github.com/acme/site/issues/1',
      'javascript:alert(1)',
      'x'.repeat(600)
    ])
      expect(() => parseGithubReference(text, 'acme/site'), text).toThrow()
    expect(() => parseGithubReference(42 as unknown as string, 'acme/site')).toThrow()
  })

  it('builds each link its address and name', () => {
    expect(githubLinkUrl({ owner: 'acme', repo: 'site', number: 4, kind: null })).toBe(
      'https://github.com/acme/site/issues/4'
    )
    expect(githubLinkUrl({ owner: 'acme', repo: 'site', number: 4, kind: 'pull' })).toBe(
      'https://github.com/acme/site/pull/4'
    )
    expect(githubLinkName({ owner: 'acme', repo: 'site', number: 4 }, 'Acme/Site')).toBe('#4')
    expect(githubLinkName({ owner: 'acme', repo: 'site', number: 4 }, 'other/repo')).toBe(
      'acme/site#4'
    )
  })
})

describe('parseGithubRepository (R4.4)', () => {
  it('reads what a person types and what a Git remote holds', () => {
    const expected = { owner: 'acme', repo: 'site' }
    for (const text of [
      'acme/site',
      'https://github.com/acme/site',
      'https://github.com/acme/site.git',
      'https://github.com/acme/site/',
      'github.com/acme/site',
      'git@github.com:acme/site.git',
      'ssh://git@github.com/acme/site.git'
    ])
      expect(parseGithubRepository(text), text).toEqual(expected)
  })

  it('returns null for anything that is not a github.com repository', () => {
    for (const text of [
      '',
      'acme',
      'https://gitlab.com/acme/site.git',
      'git@gitlab.com:acme/site.git',
      'C:\\code\\site',
      'acme/site/extra',
      'acme/..'
    ])
      expect(parseGithubRepository(text), text).toBeNull()
  })

  it('normalises the project setting, refusing a wrong one', () => {
    expect(normalizeGithubRepositorySetting(' https://github.com/acme/site.git ')).toBe('acme/site')
    expect(normalizeGithubRepositorySetting('')).toBe('')
    expect(normalizeGithubRepositorySetting(undefined)).toBe('')
    expect(() => normalizeGithubRepositorySetting('not a repo')).toThrow()
    expect(() => normalizeGithubRepositorySetting(5)).toThrow()
  })
})
