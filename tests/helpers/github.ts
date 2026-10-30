import type { GithubFetch } from '../../electron/services/github/github-client'

/**
 * Recorded GitHub REST API answers (R4.4), trimmed to the fields Ostler reads
 * plus a few it ignores, so tests never reach the network.
 */

const user = (login: string) => ({ login, id: 1, type: 'User', site_admin: false })

export const RECORDED = {
  openIssue: {
    url: 'https://api.github.com/repos/acme/site/issues/12',
    html_url: 'https://github.com/acme/site/issues/12',
    number: 12,
    title: 'Footer links are broken',
    state: 'open',
    state_reason: null,
    user: user('octocat'),
    labels: [{ id: 1, name: 'bug', color: 'd73a4a', default: true }],
    assignees: [user('ada')],
    assignee: user('ada'),
    milestone: { number: 3, title: 'Launch', state: 'open' },
    comments: 2,
    body: 'The **footer** links go nowhere.\n\n<script>alert(1)</script>',
    created_at: '2026-09-01T10:00:00Z',
    closed_at: null
  },
  closedIssue: {
    number: 13,
    title: 'Old logo',
    state: 'closed',
    state_reason: 'completed',
    labels: [{ name: 'design', color: 'a2eeef' }],
    assignees: [],
    assignee: null,
    milestone: null,
    body: null
  },
  mergedPull: {
    number: 20,
    title: 'Fix the footer',
    state: 'closed',
    draft: false,
    labels: [],
    assignees: [],
    milestone: null,
    body: 'Fixes #12',
    pull_request: {
      url: 'https://api.github.com/repos/acme/site/pulls/20',
      html_url: 'https://github.com/acme/site/pull/20',
      merged_at: '2026-09-03T12:00:00Z'
    }
  },
  draftPull: {
    number: 21,
    title: 'Try a new header',
    state: 'open',
    draft: true,
    labels: [],
    assignees: [],
    milestone: null,
    body: '',
    pull_request: { url: 'https://api.github.com/repos/acme/site/pulls/21', merged_at: null }
  },
  closedPull: {
    number: 22,
    title: 'Abandoned idea',
    state: 'closed',
    draft: false,
    pull_request: { url: 'https://api.github.com/repos/acme/site/pulls/22', merged_at: null }
  },
  notFound: {
    message: 'Not Found',
    documentation_url: 'https://docs.github.com/rest/issues/issues#get-an-issue',
    status: '404'
  },
  rateLimited: {
    message:
      "API rate limit exceeded for 203.0.113.7. (But here's the good news: Authenticated requests get a higher rate limit.)",
    documentation_url:
      'https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting'
  },
  forbidden: {
    message: 'Resource not accessible by personal access token',
    documentation_url: 'https://docs.github.com/rest/issues/issues#get-an-issue',
    status: '403'
  }
}

export interface RecordedAnswer {
  status: number
  body: unknown
  headers?: Record<string, string>
}

/** A fetch that answers from a table of `path?query` → answer, recording every request. */
export function recordedGithub(
  answers: Record<string, RecordedAnswer | ((url: URL) => RecordedAnswer)>
): {
  fetch: GithubFetch
  requests: { url: string; headers: Record<string, string> }[]
} {
  const requests: { url: string; headers: Record<string, string> }[] = []
  const fetch: GithubFetch = async (url, init) => {
    requests.push({ url, headers: init.headers })
    const parsed = new URL(url)
    if (parsed.origin !== 'https://api.github.com') throw new Error(`Unexpected host: ${url}`)
    if (init.method !== 'GET') throw new Error('Only GET is allowed')
    const key = Object.keys(answers).find((candidate) =>
      candidate.includes('?')
        ? `${parsed.pathname}${parsed.search}` === candidate
        : parsed.pathname === candidate
    )
    const entry = key ? answers[key] : { status: 404, body: RECORDED.notFound }
    const answer = typeof entry === 'function' ? entry(parsed) : entry
    const headers = new Map(
      Object.entries(answer.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value])
    )
    return {
      status: answer.status,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      json: async () => JSON.parse(JSON.stringify(answer.body))
    }
  }
  return { fetch, requests }
}
