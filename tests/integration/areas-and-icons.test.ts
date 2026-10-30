import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import { ConfigStore } from '../../electron/config-store'
import { startOnFreePort } from '../helpers/http-port'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

describe('automation-http-server.ts areas and project icons (N5.1)', () => {
  const root = useTempDir('ostler-automation-areas-')
  let store: ConfigStore
  let server: AutomationHttpServer

  beforeEach(async () => {
    store = new ConfigStore(path.join(root(), 'config.json'))
    store.registerProject({ name: 'Garden', folder: null, id: 'garden' })
    store.registerProject({ name: 'Taxes', folder: null, id: 'taxes' })
    store.updateProject('garden', { automationToken: 'token-garden' })
    store.saveAreas([
      { id: 'home', name: 'Home' },
      { id: 'work', name: 'Work' }
    ])
    store.updateProject('taxes', { areaId: 'work', icon: 'landmark' })
    server = new AutomationHttpServer(() => store.getProjects(), path.join(root(), 'runtime'))
    // As main wires it (services.ts): one validation, the config store's.
    server.appearance = {
      areas: () => store.getAreas(),
      update: (projectId, updates) => {
        const project = store.updateProject(projectId, updates as never)
        return { areaId: project.areaId ?? null, icon: project.icon ?? null }
      }
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

  it('lists every project with its area and icon', async () => {
    const result =
      await call<Array<{ id: string; areaId: string | null; icon: string | null }>>('/projects')
    expect(result.status).toBe(200)
    expect(result.value.map(({ id, areaId, icon }) => ({ id, areaId, icon }))).toEqual([
      { id: 'garden', areaId: null, icon: null },
      { id: 'taxes', areaId: 'work', icon: 'landmark' }
    ])
  })

  it('lists the areas in order, for any valid token only', async () => {
    const result = await call('/areas')
    expect(result.value).toEqual([
      { id: 'home', name: 'Home' },
      { id: 'work', name: 'Work' }
    ])
    expect((await call('/areas', { token: 'wrong' })).status).toBe(401)
  })

  it("sets the token's project's area and icon, and refuses unknown ones", async () => {
    const set = await call('/garden/appearance', {
      method: 'PATCH',
      body: { areaId: 'home', icon: 'sprout' }
    })
    expect(set).toMatchObject({ status: 200, value: { areaId: 'home', icon: 'sprout' } })
    expect(store.getProjects()[0]).toMatchObject({ areaId: 'home', icon: 'sprout' })

    // A field left out keeps its value.
    const iconOnly = await call('/garden/appearance', { method: 'PATCH', body: { icon: null } })
    expect(iconOnly.value).toEqual({ areaId: 'home', icon: null })
    expect((await call('/garden/appearance')).value).toEqual({ areaId: 'home', icon: null })

    expect(
      (await call('/garden/appearance', { method: 'PATCH', body: { icon: 'skull' } })).status
    ).toBe(400)
    expect(
      (await call('/garden/appearance', { method: 'PATCH', body: { areaId: 'nope' } })).status
    ).toBe(400)
    expect((await call('/garden/appearance', { method: 'PATCH', body: {} })).status).toBe(400)
    // Another project's appearance needs that project's own token.
    expect(
      (await call('/taxes/appearance', { method: 'PATCH', body: { icon: null } })).status
    ).toBe(401)
    expect(store.getProjects()[1]).toMatchObject({ areaId: 'work', icon: 'landmark' })
  })

  it('describes the routes in HELP_ROUTES', () => {
    const paths = HELP_ROUTES.map((entry) => `${entry.method} ${entry.path}`)
    expect(paths).toEqual(
      expect.arrayContaining(['GET /areas', 'GET /appearance', 'PATCH /appearance'])
    )
  })
})
