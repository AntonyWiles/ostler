import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GithubClient, GithubError } from '../../electron/services/github/github-client'
import { GithubLinkService } from '../../electron/services/github/github-link-service'
import { PlanningService } from '../../electron/services/planning-service'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import type { WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { RECORDED, recordedGithub } from '../helpers/github'
import { useTempDir } from '../helpers/temp-dir'

const ISSUE = '/repos/acme/site/issues/12'

function client(answers: Parameters<typeof recordedGithub>[0], token = '') {
  const recorded = recordedGithub(answers)
  return {
    client: new GithubClient({ fetch: recorded.fetch, token: () => token, userAgent: 'Test' }),
    requests: recorded.requests
  }
}

describe('GithubClient against recorded responses (R4.4)', () => {
  it('reads the states of issues and pull requests', async () => {
    const { client: github, requests } = client({
      [ISSUE]: { status: 200, body: RECORDED.openIssue },
      '/repos/acme/site/issues/13': { status: 200, body: RECORDED.closedIssue },
      '/repos/acme/site/issues/20': { status: 200, body: RECORDED.mergedPull },
      '/repos/acme/site/issues/21': { status: 200, body: RECORDED.draftPull },
      '/repos/acme/site/issues/22': { status: 200, body: RECORDED.closedPull }
    })
    expect(await github.getIssue('acme', 'site', 12)).toEqual({
      number: 12,
      kind: 'issue',
      title: 'Footer links are broken',
      state: 'open'
    })
    expect((await github.getIssue('acme', 'site', 13)).state).toBe('closed')
    expect(await github.getIssue('acme', 'site', 20)).toMatchObject({
      kind: 'pull',
      state: 'merged'
    })
    expect((await github.getIssue('acme', 'site', 21)).state).toBe('draft')
    expect((await github.getIssue('acme', 'site', 22)).state).toBe('closed')
    // No token: none is sent. Always GitHub's JSON, versioned, with Ostler's name.
    expect(requests[0].headers.Authorization).toBeUndefined()
    expect(requests[0].headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Test'
    })
  })

  it('sends the saved token, and says plainly when it lacks access', async () => {
    const { client: github, requests } = client(
      {
        [ISSUE]: {
          status: 403,
          body: RECORDED.forbidden,
          headers: { 'x-ratelimit-remaining': '4999' }
        }
      },
      'github_pat_secret'
    )
    const error = await github.getIssue('acme', 'site', 12).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GithubError)
    expect((error as GithubError).rateLimited).toBe(false)
    expect((error as Error).message).toMatch(/token doesn't give access/)
    expect(requests[0].headers.Authorization).toBe('Bearer github_pat_secret')
    // The token is never part of a message.
    expect((error as Error).message).not.toContain('github_pat_secret')
  })

  it('says when a token is refused outright', async () => {
    const { client: github } = client({ [ISSUE]: { status: 401, body: {} } }, 'old')
    await expect(github.getIssue('acme', 'site', 12)).rejects.toThrow(/refused the saved token/)
  })

  it('says not found, and suggests a token for a private repository', async () => {
    const { client: github } = client({})
    await expect(github.getIssue('acme', 'site', 99)).rejects.toThrow(/can't find this.*token/)
  })

  it('says when the rate limit is reached, and when it resets', async () => {
    const reset = Math.floor(new Date(2026, 9, 14, 15, 30).getTime() / 1000)
    const { client: github } = client({
      [ISSUE]: {
        status: 403,
        body: RECORDED.rateLimited,
        headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(reset) }
      }
    })
    const error = (await github
      .getIssue('acme', 'site', 12)
      .catch((caught) => caught)) as GithubError
    expect(error.rateLimited).toBe(true)
    expect(error.message).toMatch(/limit for requests without a token is reached/)
    expect(error.message).toMatch(/Try again after/)
    expect(error.message).toMatch(/Settings › Connections/)

    const { client: limited } = client({ [ISSUE]: { status: 429, body: {} } }, 'token')
    await expect(limited.getIssue('acme', 'site', 12)).rejects.toThrow(/limit on requests/)
  })

  it('says when GitHub cannot be reached', async () => {
    const github = new GithubClient({
      fetch: async () => {
        throw new Error('getaddrinfo ENOTFOUND api.github.com')
      },
      token: () => '',
      userAgent: 'Test'
    })
    await expect(github.getIssue('acme', 'site', 12)).rejects.toThrow(/Couldn't reach GitHub/)
  })

  it('lists issues page by page without pull requests, with filters and a milestone by title', async () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...RECORDED.openIssue,
        number: from + index,
        title: `Issue ${from + index}`
      }))
    const { client: github, requests } = client({
      '/repos/acme/site/milestones': {
        status: 200,
        body: [{ number: 3, title: 'Launch' }]
      },
      '/repos/acme/site/issues': (url) => ({
        status: 200,
        body:
          url.searchParams.get('page') === '1'
            ? [...page(101, 99), RECORDED.mergedPull]
            : [RECORDED.closedIssue]
      })
    })
    const { issues, truncated } = await github.listIssues({
      owner: 'acme',
      repo: 'site',
      state: 'all',
      labels: ['bug', 'ui'],
      milestone: 'launch'
    })
    expect(truncated).toBe(false)
    expect(issues).toHaveLength(100)
    expect(issues.some((issue) => issue.number === 20)).toBe(false)
    expect(issues[0]).toMatchObject({
      labels: [{ name: 'bug', color: 'd73a4a' }],
      assignees: ['ada'],
      milestone: 'Launch'
    })
    expect(issues[99]).toMatchObject({ number: 13, state: 'closed', body: '' })
    const listed = new URL(requests[1].url)
    expect(Object.fromEntries(listed.searchParams)).toMatchObject({
      state: 'all',
      labels: 'bug,ui',
      milestone: '3',
      per_page: '100',
      page: '1'
    })
  })

  it('reads a milestone named with digits by its name, and a number that names none as its number', async () => {
    const { client: github, requests } = client({
      '/repos/acme/site/milestones': { status: 200, body: [{ number: 7, title: '2025' }] },
      '/repos/acme/site/issues': { status: 200, body: [] }
    })
    const query = { owner: 'acme', repo: 'site', state: 'open' as const, labels: [] }
    await github.listIssues({ ...query, milestone: '2025' })
    await github.listIssues({ ...query, milestone: '4' })
    const milestones = requests
      .map((request) => new URL(request.url))
      .filter((url) => url.pathname.endsWith('/issues'))
      .map((url) => url.searchParams.get('milestone'))
    expect(milestones).toEqual(['7', '4'])
  })

  it('refuses a milestone the repository does not have', async () => {
    const { client: github } = client({ '/repos/acme/site/milestones': { status: 200, body: [] } })
    await expect(
      github.listIssues({ owner: 'acme', repo: 'site', state: 'open', labels: [], milestone: 'v9' })
    ).rejects.toThrow(/no milestone called v9/)
  })
})

describe('GithubLinkService (R4.4)', () => {
  const tempDir = useTempDir('ostler-github-')
  let planning: PlanningService
  const projectIds = ['p1']
  const project = { id: 'p1', githubRepository: 'acme/site' } as WatchedProject
  let changed: number

  const service = (answers: Parameters<typeof recordedGithub>[0]) => {
    const recorded = recordedGithub(answers)
    return {
      links: new GithubLinkService({
        planning,
        client: new GithubClient({ fetch: recorded.fetch, token: () => '', userAgent: 'Test' }),
        getProject: (id) => {
          if (id !== 'p1') throw new Error('Project not found')
          return project
        },
        changed: () => {
          changed += 1
        },
        now: () => 1_000
      }),
      requests: recorded.requests
    }
  }

  beforeEach(async () => {
    planning = new PlanningService(await createMigratedDatabase(tempDir()), () => projectIds)
    changed = 0
  })

  afterEach(() => {
    planning.close()
  })

  it('adds a link by #number, fetches it, and the task carries it', async () => {
    const task = planning.createWorkItem('p1', { title: 'Fix footer' }, planning.humanActor())
    const { links } = service({ [ISSUE]: { status: 200, body: RECORDED.openIssue } })
    const added = await links.add('p1', task.id, '#12')
    expect(added.problem).toBeNull()
    expect(added.link).toMatchObject({
      owner: 'acme',
      repo: 'site',
      number: 12,
      kind: 'issue',
      title: 'Footer links are broken',
      state: 'open',
      fetchedAt: 1_000,
      url: 'https://github.com/acme/site/issues/12'
    })
    expect(planning.listWorkItems('p1')[0].githubLinks).toEqual([added.link])
    expect(planning.getWorkItem(task.id).githubLinks).toEqual([added.link])
    // A task without links carries none.
    planning.createWorkItem('p1', { title: 'Other' }, planning.humanActor())
    expect(planning.listWorkItems('p1')[1].githubLinks).toBeUndefined()
    await expect(
      links.add('p1', task.id, 'https://github.com/ACME/Site/issues/12')
    ).rejects.toThrow(/already links/)
    expect(changed).toBe(1)
  })

  it('keeps a link whose fetch failed, and says why', async () => {
    const task = planning.createWorkItem('p1', { title: 'Fix footer' }, planning.humanActor())
    const { links } = service({})
    const added = await links.add('p1', task.id, 'https://github.com/acme/site/pull/99')
    expect(added.problem).toMatch(/can't find this/)
    expect(added.link).toMatchObject({ kind: 'pull', state: null, title: '', fetchedAt: null })
  })

  it('refreshes every link, stopping at a rate limit', async () => {
    const task = planning.createWorkItem('p1', { title: 'Fix footer' }, planning.humanActor())
    let limited = false
    const { links, requests } = service({
      '/repos/acme/site/issues/20': () =>
        limited
          ? { status: 403, body: RECORDED.rateLimited, headers: { 'x-ratelimit-remaining': '0' } }
          : { status: 200, body: { ...RECORDED.draftPull, number: 20 } },
      '/repos/acme/site/issues/21': { status: 200, body: RECORDED.draftPull }
    })
    const first = await links.add('p1', task.id, '#20')
    await links.add('p1', task.id, '#21')
    expect(first.link.state).toBe('draft')

    // Merged since: the refresh says so.
    const merged = recordedGithub({
      '/repos/acme/site/issues/20': { status: 200, body: RECORDED.mergedPull },
      '/repos/acme/site/issues/21': { status: 200, body: RECORDED.draftPull }
    })
    const again = new GithubLinkService({
      planning,
      client: new GithubClient({ fetch: merged.fetch, token: () => '', userAgent: 'Test' }),
      getProject: () => project,
      now: () => 2_000
    })
    const refreshed = await again.refresh('p1', task.id)
    expect(refreshed.problems).toEqual({})
    expect(
      refreshed.links.map((link) => [link.number, link.state, link.title, link.fetchedAt])
    ).toEqual([
      [20, 'merged', 'Fix the footer', 2_000],
      [21, 'draft', 'Try a new header', 2_000]
    ])

    limited = true
    requests.length = 0
    const stopped = await links.refresh('p1', task.id)
    expect(requests).toHaveLength(1)
    expect(Object.values(stopped.problems)).toHaveLength(2)
    expect(new Set(Object.values(stopped.problems)).size).toBe(1)
    // The cache stays.
    expect(stopped.links[0]).toMatchObject({ state: 'merged', fetchedAt: 2_000 })
  })

  it('removes a link with undo, refuses other projects, and goes with the project', async () => {
    const task = planning.createWorkItem('p1', { title: 'Fix footer' }, planning.humanActor())
    const { links } = service({ [ISSUE]: { status: 200, body: RECORDED.openIssue } })
    const { link } = await links.add('p1', task.id, '#12')
    const removed = links.remove('p1', link.id)
    expect(planning.getWorkItem(task.id).githubLinks).toBeUndefined()
    expect(links.restore('p1', removed)).toEqual(link)
    expect(() => links.remove('p2', link.id)).toThrow()
    expect(() => planning.githubLinks.remove('p2', link.id)).toThrow(/isn't on this task/)

    deleteProjectRows(planning.database, 'p1')
    expect(
      planning.database.prepare('SELECT COUNT(*) AS n FROM planning_github_links').get()
    ).toEqual({ n: 0 })
  })

  it('undoes a removal into the link made again since, not a second copy of it', async () => {
    const task = planning.createWorkItem('p1', { title: 'Fix footer' }, planning.humanActor())
    const { links } = service({ [ISSUE]: { status: 200, body: RECORDED.openIssue } })
    const { link } = await links.add('p1', task.id, '#12')
    const removed = links.remove('p1', link.id)
    const { link: again } = await links.add('p1', task.id, '#12')
    expect(links.restore('p1', removed).id).toBe(again.id)
    expect(planning.getWorkItem(task.id).githubLinks).toHaveLength(1)
  })

  it('refuses a task in the recycle bin and junk references, and asks nothing of GitHub', async () => {
    const task = planning.createWorkItem('p1', { title: 'Fix footer' }, planning.humanActor())
    const { links, requests } = service({})
    await expect(
      links.add('p1', task.id, 'https://gitlab.com/acme/site/issues/1')
    ).rejects.toThrow()
    await expect(links.add('p1', task.id, 'nonsense')).rejects.toThrow()
    planning.moveWorkItemToBin(task.id, planning.humanActor())
    await expect(links.add('p1', task.id, '#12')).rejects.toThrow(/recycle bin/)
    expect(requests).toHaveLength(0)
  })
})
