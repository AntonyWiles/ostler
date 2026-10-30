import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../../electron/services/automation-http-server'
import { PlanningService } from '../../../electron/services/planning-service'
import type { WatchedProject } from '../../../src/shared/ostler-api'
import { useAutomationServer } from '../../helpers/automation-fixture'
import { createMigratedDatabase } from '../../helpers/database'
import { useTempDir } from '../../helpers/temp-dir'

describe('automation-http-server.ts GitHub link and import routes (R4.4)', () => {
  const temp = useTempDir('ostler-automation-github-')
  const http = useAutomationServer()
  let root: string
  let projects: WatchedProject[]
  let planning: PlanningService
  let server: AutomationHttpServer
  let requests: { url: string; headers: Record<string, string> }[]
  let changed: string[]

  beforeEach(async () => {
    root = temp()
    const { ConfigStore } = await import('../../../electron/config-store')
    const { ImportService } = await import('../../../electron/services/import-service')
    const { GithubClient } = await import('../../../electron/services/github/github-client')
    const { GithubLinkService } =
      await import('../../../electron/services/github/github-link-service')
    const { RECORDED, recordedGithub } = await import('../../helpers/github')
    const store = new ConfigStore(path.join(root, 'config.json'))
    const first = store.registerProject({ name: 'Site', folder: null })
    store.updateProject(first.id, {
      automationToken: 'github-token',
      githubRepository: 'acme/site'
    })
    projects = store.getProjects()
    planning = new PlanningService(await createMigratedDatabase(root), () =>
      store.getProjects().map((entry) => entry.id)
    )
    // GitHub, stubbed with recorded answers; the saved token is a secret the API never returns.
    const recorded = recordedGithub({
      '/repos/acme/site/issues/12': { status: 200, body: RECORDED.openIssue },
      '/repos/acme/site/issues/20': { status: 200, body: RECORDED.mergedPull },
      '/repos/acme/site/issues/30': {
        status: 403,
        body: RECORDED.rateLimited,
        headers: { 'x-ratelimit-remaining': '0' }
      },
      '/repos/acme/site/issues': { status: 200, body: [RECORDED.openIssue, RECORDED.mergedPull] }
    })
    requests = recorded.requests
    const client = new GithubClient({
      fetch: recorded.fetch,
      token: () => 'saved-github-secret',
      userAgent: 'Test'
    })
    const getProject = (id: string) => store.getProjects().find((entry) => entry.id === id)!
    const imports = new ImportService({
      planning,
      packages: {} as never,
      getProjects: () => store.getProjects(),
      locale: () => 'en-GB',
      github: client
    })
    changed = []
    server = new AutomationHttpServer(
      () => store.getProjects(),
      path.join(root, 'runtime'),
      undefined,
      planning,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { service: imports, changed: (project) => changed.push(project.id) }
    )
    server.github = new GithubLinkService({ planning, client, getProject })
    await http.start(server, planning)
  })

  async function call(method: string, urlPath: string, body?: unknown) {
    const response = await http.request(method, `/automation/${projects[0].id}${urlPath}`, {
      body,
      token: 'github-token'
    })
    const text = await response.text()
    expect(text).not.toContain('saved-github-secret')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: response.status, json: JSON.parse(text) as { ok: boolean; value: any } }
  }

  it('adds, reads, refreshes and removes links on a task', async () => {
    const task = planning.createWorkItem(projects[0].id, { title: 'Footer' }, planning.humanActor())
    const base = `/work-items/${task.id}/github-links`

    const added = await call('POST', base, { reference: '#12' })
    expect(added.status).toBe(200)
    expect(added.json.value).toMatchObject({
      problem: null,
      link: { number: 12, kind: 'issue', state: 'open', title: 'Footer links are broken' }
    })
    expect(requests.at(-1)?.headers.Authorization).toBe('Bearer saved-github-secret')
    const pull = await call('POST', base, { reference: 'https://github.com/acme/site/pull/20' })
    expect(pull.json.value.link).toMatchObject({ kind: 'pull', state: 'merged' })
    const limited = await call('POST', base, { reference: 'acme/site#30' })
    expect(limited.json.value.problem).toMatch(/limit/)

    expect(
      (await call('POST', base, { reference: 'https://gitlab.com/a/b/issues/1' })).status
    ).toBe(400)
    expect((await call('POST', base, { reference: '#12' })).status).toBe(400)

    // Reading asks nothing of GitHub.
    const before = requests.length
    const listed = await call('GET', base)
    expect(listed.json.value.map((link: { number: number }) => link.number)).toEqual([12, 20, 30])
    expect(requests.length).toBe(before)
    const items = await call('GET', '/work-items')
    expect(items.json.value[0].githubLinks).toHaveLength(3)

    const refreshed = await call('POST', `${base}/refresh`)
    expect(Object.keys(refreshed.json.value.problems)).toEqual([limited.json.value.link.id])

    const removed = await call('DELETE', `${base}/${added.json.value.link.id}`)
    expect(removed.json.value.number).toBe(12)
    expect((await call('DELETE', `${base}/${added.json.value.link.id}`)).status).toBe(404)
    expect((await call('GET', base)).json.value).toHaveLength(2)
  })

  it('imports issues as linked tasks, skipping linked ones, and undoes', async () => {
    const dry = await call('POST', '/import/github?dryRun=1', {})
    expect(dry.json.value).toMatchObject({
      repository: 'acme/site',
      issueCount: 1,
      importableCount: 1,
      alreadyLinkedCount: 0
    })
    expect(planning.listWorkItems(projects[0].id)).toEqual([])

    const done = await call('POST', '/import/github', { labels: ['bug'] })
    expect(done.status).toBe(200)
    expect(done.json.value.batch).toMatchObject({ source: 'github', itemCount: 1 })
    expect(changed).toEqual([projects[0].id])
    const listed = new URL(requests.at(-1)!.url)
    expect(listed.searchParams.get('labels')).toBe('bug')
    expect(planning.listWorkItems(projects[0].id)[0].githubLinks?.[0]).toMatchObject({
      number: 12,
      state: 'open'
    })

    const again = await call('POST', '/import/github?dryRun=1', {})
    expect(again.json.value).toMatchObject({ importableCount: 0, alreadyLinkedCount: 1 })

    const undone = await call('DELETE', `/import/${done.json.value.batch.id}`)
    expect(undone.json.value.movedIds).toHaveLength(1)
    expect(planning.listWorkItems(projects[0].id)).toEqual([])
  })

  it('lists the routes in its help', async () => {
    const help = await call('GET', '/help')
    const paths = help.json.value.routes.map(
      (route: { method: string; path: string }) => `${route.method} ${route.path}`
    )
    expect(paths).toEqual(
      expect.arrayContaining([
        'GET /work-items/:workItemId/github-links',
        'POST /work-items/:workItemId/github-links',
        'POST /work-items/:workItemId/github-links/refresh',
        'DELETE /work-items/:workItemId/github-links/:linkId',
        'POST /import/github'
      ])
    )
  })
})
