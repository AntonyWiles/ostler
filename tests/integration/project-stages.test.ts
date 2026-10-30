import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import { ConfigStore } from '../../electron/config-store'
import { startOnFreePort } from '../helpers/http-port'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

describe('automation-http-server.ts project stages (N5.3)', () => {
  const root = useTempDir('ostler-automation-stages-')
  let store: ConfigStore
  let server: AutomationHttpServer

  beforeEach(async () => {
    store = new ConfigStore(path.join(root(), 'config.json'))
    store.registerProject({ name: 'Garden', folder: null, id: 'garden' })
    store.registerProject({ name: 'Taxes', folder: null, id: 'taxes' })
    store.updateProject('garden', { automationToken: 'token-garden' })
    store.updateProject('taxes', { stage: 'done' })
    server = new AutomationHttpServer(() => store.getProjects(), path.join(root(), 'runtime'))
    // As main wires it (services.ts): the config store's one validation.
    server.projectStage = {
      update: (projectId, stage) => store.updateProject(projectId, { stage }).stage ?? stage
    }
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
  })

  async function call<T = unknown>(
    route: string,
    {
      method = 'GET',
      body,
      token = 'token-garden'
    }: { method?: string; body?: unknown; token?: string } = {}
  ): Promise<{ status: number; ok: boolean; value: T; error?: string }> {
    const response = await fetch(`http://127.0.0.1:${PORT}/automation${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const json = (await response.json()) as { ok: boolean; value: T; error?: string }
    return { status: response.status, ...json }
  }

  it('lists every project with its stage', async () => {
    const result = await call<Array<{ id: string; stage: string }>>('/projects')
    expect(result.value.map(({ id, stage }) => ({ id, stage }))).toEqual([
      { id: 'garden', stage: 'active' },
      { id: 'taxes', stage: 'done' }
    ])
  })

  it("reads and sets the token's project's stage, and refuses unknown ones", async () => {
    expect((await call('/garden/stage')).value).toEqual({ stage: 'active' })
    const set = await call('/garden/stage', { method: 'PUT', body: { stage: 'on-hold' } })
    expect(set).toMatchObject({ status: 200, value: { stage: 'on-hold' } })
    expect(store.getProjects()[0].stage).toBe('on-hold')
    expect((await call('/garden/stage')).value).toEqual({ stage: 'on-hold' })

    expect((await call('/garden/stage', { method: 'PUT', body: { stage: 'paused' } })).status).toBe(
      400
    )
    expect((await call('/garden/stage', { method: 'PUT', body: {} })).status).toBe(400)
    // Another project's stage needs that project's own token.
    expect((await call('/taxes/stage', { method: 'PUT', body: { stage: 'active' } })).status).toBe(
      401
    )
    expect(store.getProjects()[1].stage).toBe('done')
  })

  it('describes the routes in HELP_ROUTES', () => {
    const paths = HELP_ROUTES.map((entry) => `${entry.method} ${entry.path}`)
    expect(paths).toEqual(expect.arrayContaining(['GET /stage', 'PUT /stage']))
  })
})
