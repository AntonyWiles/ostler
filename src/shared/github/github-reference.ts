import type { GithubLinkKind } from '../ostler-api/github-types'
import { t } from '../i18n'
import { Refusal } from '../refusal'

/**
 * What a person types to link a task to GitHub (R4.4, D40), read without any
 * network: a github.com issue or pull request URL, `owner/repo#123`, or
 * `#123` when the project has a repository. Only github.com: GitHub
 * Enterprise and other hosts are refused, as is anything else.
 */

export interface GithubRepository {
  owner: string
  repo: string
}

export interface GithubReference extends GithubRepository {
  number: number
  /** Known from a URL; null for `#123`, until GitHub says which it is. */
  kind: GithubLinkKind | null
}

/** GitHub's own rules: an owner is 1-39 letters, digits or single hyphens. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/
/** A repository name: letters, digits, `.`, `-` and `_`, never `.` or `..`. */
const REPO = /^[A-Za-z0-9._-]{1,100}$/
const MAX_NUMBER = 2_147_483_647

function validRepository(owner: string, repo: string): GithubRepository | null {
  const name = repo.replace(/\.git$/i, '')
  if (!OWNER.test(owner) || !REPO.test(name) || name === '.' || name === '..') return null
  return { owner, repo: name }
}

function issueNumber(text: string): number | null {
  if (!/^[1-9][0-9]{0,9}$/.test(text)) return null
  const value = Number(text)
  return value <= MAX_NUMBER ? value : null
}

/** A github.com URL's path parts, or null for any other host or scheme. */
function githubPath(text: string): string[] | null {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password || url.port) return null
  const host = url.hostname.toLowerCase()
  if (host !== 'github.com' && host !== 'www.github.com') return null
  return url.pathname.split('/').filter(Boolean)
}

/**
 * `owner/repo` from what a person types or a Git remote holds:
 * `owner/repo`, `https://github.com/owner/repo(.git)`,
 * `git@github.com:owner/repo.git` or `ssh://git@github.com/owner/repo.git`.
 * Null when it is not a github.com repository.
 */
export function parseGithubRepository(input: string): GithubRepository | null {
  const typed = typeof input === 'string' ? input.trim() : ''
  if (!typed || typed.length > 300) return null
  const text = /^(www\.)?github\.com\//i.test(typed) ? `https://${typed}` : typed
  const scp = /^(?:[\w.-]+@)?github\.com:([^/]+)\/([^/]+?)\/?$/i.exec(text)
  if (scp) return validRepository(scp[1], scp[2])
  if (/^ssh:\/\//i.test(text)) {
    const ssh = /^ssh:\/\/(?:[\w.-]+@)?github\.com(?::22)?\/([^/]+)\/([^/]+?)\/?$/i.exec(text)
    return ssh ? validRepository(ssh[1], ssh[2]) : null
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    const parts = githubPath(text)
    return parts && parts.length >= 2 ? validRepository(parts[0], parts[1]) : null
  }
  const plain = /^([^/\s]+)\/([^/\s]+)$/.exec(text)
  return plain ? validRepository(plain[1], plain[2]) : null
}

/** `owner/repo`, the form a project's repository is saved in. */
export function formatGithubRepository(repository: GithubRepository): string {
  return `${repository.owner}/${repository.repo}`
}

/**
 * A project's saved repository as it should be stored: '' for none, else
 * `owner/repo`. Refuses anything that is not a github.com repository.
 */
export function normalizeGithubRepositorySetting(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Refusal(t('errors:github.repositoryInvalid'))
  if (!value.trim()) return ''
  const repository = parseGithubRepository(value)
  if (!repository) throw new Refusal(t('errors:github.repositoryInvalid'))
  return formatGithubRepository(repository)
}

/**
 * Reads a link a person typed. `#123` (or `123`) needs the project's
 * repository; `owner/repo#123` and github.com URLs do not. Throws a plain
 * message for anything else.
 */
export function parseGithubReference(
  input: string,
  projectRepository: string | null | undefined
): GithubReference {
  const text = typeof input === 'string' ? input.trim() : ''
  if (!text || text.length > 500) throw new Refusal(t('errors:github.referenceInvalid'))

  const short = /^#?([0-9]+)$/.exec(text)
  if (short) {
    const number = issueNumber(short[1])
    if (number === null) throw new Refusal(t('errors:github.referenceInvalid'))
    const repository = projectRepository ? parseGithubRepository(projectRepository) : null
    if (!repository) throw new Refusal(t('errors:github.numberNeedsRepository'))
    return { ...repository, number, kind: null }
  }

  const qualified = /^([^/\s#]+)\/([^/\s#]+)#([0-9]+)$/.exec(text)
  if (qualified) {
    const repository = validRepository(qualified[1], qualified[2])
    const number = issueNumber(qualified[3])
    if (!repository || number === null) throw new Refusal(t('errors:github.referenceInvalid'))
    return { ...repository, number, kind: null }
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  let url: URL | null = null
  try {
    url = new URL(withScheme)
  } catch {
    url = null
  }
  if (url && url.hostname && !/^(www\.)?github\.com$/i.test(url.hostname))
    throw new Refusal(t('errors:github.onlyGithubCom'))
  const parts = githubPath(withScheme)
  if (!parts || parts.length < 4) throw new Refusal(t('errors:github.referenceInvalid'))
  const [owner, repo, section, numberText] = parts
  const repository = validRepository(owner, repo)
  const number = issueNumber(numberText)
  const kind: GithubLinkKind | null =
    section === 'issues' ? 'issue' : section === 'pull' || section === 'pulls' ? 'pull' : null
  if (!repository || number === null || !kind)
    throw new Refusal(t('errors:github.referenceInvalid'))
  return { ...repository, number, kind }
}

/** The link's page on github.com. GitHub redirects an issue URL to its pull request. */
export function githubLinkUrl(
  reference: GithubRepository & { number: number; kind: GithubLinkKind | null }
): string {
  const section = reference.kind === 'pull' ? 'pull' : 'issues'
  return `https://github.com/${reference.owner}/${reference.repo}/${section}/${reference.number}`
}

/** `owner/repo#123`, how a link is named in lists and for screen readers. */
export function githubLinkName(
  reference: GithubRepository & { number: number },
  projectRepository?: string | null
): string {
  const repository = formatGithubRepository(reference)
  return projectRepository && projectRepository.toLowerCase() === repository.toLowerCase()
    ? `#${reference.number}`
    : `${repository}#${reference.number}`
}
