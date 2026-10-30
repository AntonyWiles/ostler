import type { GithubLinkKind, GithubLinkState } from '@shared/ostler-api'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'
import { formatTime } from '@shared/format'

/**
 * The GitHub REST API, read only (R4.4, D40). Only `api.github.com`, only
 * GET, and only what a person asked for: an issue or pull request's title
 * and state, a repository's issues and its milestones. What is sent is the
 * repository and number in the address, Ostler's name as the user agent, and
 * the person's token when they saved one. Main passes Electron's `net.fetch`,
 * so system proxy settings apply as they do to update checks; tests pass
 * recorded responses.
 */

export type GithubFetch = (
  url: string,
  init: { method: 'GET'; headers: Record<string, string>; signal?: AbortSignal }
) => Promise<{
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}>

export interface GithubClientDependencies {
  fetch: GithubFetch
  /** The saved token, or '' for none. Read on every request; never logged or returned. */
  token(): string
  userAgent: string
  /** Each request gives up after this long. */
  timeoutMs?: number
}

/** An issue or pull request as Ostler keeps it. */
export interface GithubIssueSummary {
  number: number
  kind: GithubLinkKind
  title: string
  state: GithubLinkState
}

/** An issue as an import reads it. */
export interface GithubIssue extends GithubIssueSummary {
  body: string
  labels: { name: string; color: string }[]
  assignees: string[]
  milestone: string | null
}

export interface GithubIssueListQuery {
  owner: string
  repo: string
  state: 'open' | 'all'
  labels: string[]
  /** A milestone's title or number, or '' for any. */
  milestone: string
}

const API = 'https://api.github.com'
const PER_PAGE = 100
/** An import reads at most this many issues (pull requests included in GitHub's count). */
export const MAX_GITHUB_ISSUE_PAGES = 10
const DEFAULT_TIMEOUT_MS = 20_000

/** Why a request to GitHub failed, in plain words; the status is kept for callers that branch on it. */
export class GithubError extends Refusal {
  constructor(
    message: string,
    readonly status: number | null,
    /** GitHub's request limit was reached: further requests now would fail too. */
    readonly rateLimited = false
  ) {
    super(message)
    this.name = 'GithubError'
  }
}

export class GithubClient {
  constructor(private readonly deps: GithubClientDependencies) {}

  /** One issue or pull request (GitHub's issues endpoint answers for both). */
  async getIssue(owner: string, repo: string, number: number): Promise<GithubIssueSummary> {
    const issue = await this.get(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}`
    )
    return toIssue(issue)
  }

  /**
   * A repository's issues, oldest first, without pull requests: up to
   * `MAX_GITHUB_ISSUE_PAGES` pages of 100. `truncated` says there were more.
   */
  async listIssues(query: GithubIssueListQuery): Promise<{
    issues: GithubIssue[]
    truncated: boolean
  }> {
    const base = `/repos/${encodeURIComponent(query.owner)}/${encodeURIComponent(query.repo)}`
    const params = new URLSearchParams({
      state: query.state,
      sort: 'created',
      direction: 'asc',
      per_page: String(PER_PAGE)
    })
    if (query.labels.length > 0) params.set('labels', query.labels.join(','))
    if (query.milestone) params.set('milestone', await this.milestoneNumber(base, query.milestone))
    const issues: GithubIssue[] = []
    for (let page = 1; page <= MAX_GITHUB_ISSUE_PAGES; page += 1) {
      params.set('page', String(page))
      const batch = await this.get(`${base}/issues?${params.toString()}`)
      if (!Array.isArray(batch)) throw new GithubError(t('errors:github.unexpectedAnswer'), null)
      for (const entry of batch) {
        const issue = toIssue(entry)
        if (issue.kind === 'issue') issues.push(toFullIssue(entry, issue))
      }
      if (batch.length < PER_PAGE) return { issues, truncated: false }
    }
    return { issues, truncated: true }
  }

  /** A milestone's number from its title, or the number itself when no title matches. */
  private async milestoneNumber(base: string, milestone: string): Promise<string> {
    const text = milestone.trim()
    const params = new URLSearchParams({ state: 'all', per_page: String(PER_PAGE) })
    const list = await this.get(`${base}/milestones?${params.toString()}`)
    const found = Array.isArray(list)
      ? list.find(
          (entry) =>
            isRecord(entry) &&
            typeof entry.title === 'string' &&
            entry.title.toLowerCase() === text.toLowerCase()
        )
      : undefined
    if (isRecord(found) && typeof found.number === 'number') return String(found.number)
    if (/^[1-9][0-9]{0,9}$/.test(text)) return text
    throw new GithubError(t('errors:github.milestoneNotFound', { milestone: text }), 404)
  }

  private async get(path: string): Promise<unknown> {
    const token = this.deps.token()
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': this.deps.userAgent
    }
    if (token) headers.Authorization = `Bearer ${token}`
    let response: Awaited<ReturnType<GithubFetch>>
    try {
      response = await this.deps.fetch(`${API}${path}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
      })
    } catch {
      throw new GithubError(t('errors:github.couldNotReach'), null)
    }
    if (response.status >= 200 && response.status < 300) {
      try {
        return await response.json()
      } catch {
        throw new GithubError(t('errors:github.unexpectedAnswer'), response.status)
      }
    }
    throw failure(response.status, response.headers, Boolean(token))
  }
}

/** GitHub's answer as a plain message: not found, a rate limit, or a token that lacks access. */
function failure(
  status: number,
  headers: { get(name: string): string | null },
  withToken: boolean
): GithubError {
  const remaining = headers.get('x-ratelimit-remaining')
  if (status === 429 || (status === 403 && remaining === '0')) {
    const reset = Number(headers.get('x-ratelimit-reset'))
    const time = Number.isFinite(reset) && reset > 0 ? formatTime(reset * 1000) : null
    const message = withToken
      ? time
        ? t('errors:github.rateLimitedAt', { time })
        : t('errors:github.rateLimited')
      : time
        ? t('errors:github.rateLimitedNoTokenAt', { time })
        : t('errors:github.rateLimitedNoToken')
    return new GithubError(message, status, true)
  }
  if (status === 401) return new GithubError(t('errors:github.tokenRefused'), status)
  if (status === 403)
    return new GithubError(
      withToken ? t('errors:github.tokenLacksAccess') : t('errors:github.forbidden'),
      status
    )
  if (status === 404 || status === 410)
    return new GithubError(
      withToken ? t('errors:github.notFound') : t('errors:github.notFoundNoToken'),
      status
    )
  return new GithubError(t('errors:github.failed', { status }), status)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** An issue or pull request's state as Ostler shows it. */
function toIssue(value: unknown): GithubIssueSummary {
  if (!isRecord(value) || typeof value.number !== 'number')
    throw new GithubError(t('errors:github.unexpectedAnswer'), null)
  const pull = isRecord(value.pull_request) ? value.pull_request : null
  const open = value.state === 'open'
  const state: GithubLinkState = pull
    ? typeof pull.merged_at === 'string' && pull.merged_at
      ? 'merged'
      : open
        ? value.draft === true
          ? 'draft'
          : 'open'
        : 'closed'
    : open
      ? 'open'
      : 'closed'
  return {
    number: value.number,
    kind: pull ? 'pull' : 'issue',
    title: typeof value.title === 'string' ? value.title : '',
    state
  }
}

function toFullIssue(value: unknown, summary: GithubIssueSummary): GithubIssue {
  const issue = value as Record<string, unknown>
  const labels = Array.isArray(issue.labels)
    ? issue.labels.flatMap((label) =>
        isRecord(label) && typeof label.name === 'string'
          ? [{ name: label.name, color: typeof label.color === 'string' ? label.color : '' }]
          : typeof label === 'string'
            ? [{ name: label, color: '' }]
            : []
      )
    : []
  const assignees = Array.isArray(issue.assignees)
    ? issue.assignees.flatMap((person) =>
        isRecord(person) && typeof person.login === 'string' ? [person.login] : []
      )
    : isRecord(issue.assignee) && typeof issue.assignee.login === 'string'
      ? [issue.assignee.login]
      : []
  return {
    ...summary,
    body: typeof issue.body === 'string' ? issue.body : '',
    labels,
    assignees,
    milestone:
      isRecord(issue.milestone) && typeof issue.milestone.title === 'string'
        ? issue.milestone.title
        : null
  }
}
