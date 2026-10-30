import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { ConfigStore } from '../../electron/config-store'
import type { PlanningWorkItem } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

describe('automation-http-server.ts task IDs (N9.8a)', () => {
  const root = useTempDir('ostler-automation-task-ids-')
  let store: ConfigStore
  let planning: PlanningService
  let server: AutomationHttpServer

  beforeEach(async () => {
    store = new ConfigStore(path.join(root(), 'config.json'))
    store.registerProject({ name: 'Shop', folder: null, id: 'shop' })
    store.registerProject({ name: 'Garden', folder: null, id: 'garden' })
    store.updateProject('shop', { automationToken: 'token-shop', taskPrefix: 'SHOP' })
    const databasePath = await createMigratedDatabase(root())
    planning = new PlanningService(
      databasePath,
      () => store.getProjects().map((project) => project.id),
      undefined,
      (id) => store.getProjects().find((project) => project.id === id)?.taskPrefix ?? null
    )
    server = new AutomationHttpServer(
      () => store.getProjects(),
      path.join(root(), 'runtime'),
      undefined,
      planning
    )
    // As main wires it (services.ts): the config store's one check.
    server.taskPrefix = {
      update: (projectId, taskPrefix) =>
        store.updateProject(projectId, { taskPrefix }).taskPrefix ?? taskPrefix
    }
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
    planning?.close()
  })

  async function call<T = unknown>(
    route: string,
    { method = 'GET', body }: { method?: string; body?: unknown } = {}
  ): Promise<{ status: number; ok: boolean; value: T; error?: string }> {
    const response = await fetch(`http://127.0.0.1:${PORT}/automation/shop${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-shop' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const json = (await response.json()) as { ok: boolean; value: T; error?: string }
    return { status: response.status, ...json }
  }

  it('gives work items a number and a key', async () => {
    const first = await call<PlanningWorkItem>('/work-items', {
      method: 'POST',
      body: { title: 'Fix the login' }
    })
    expect(first.value).toMatchObject({ number: 1, key: 'SHOP-1' })
    await call('/work-items', { method: 'POST', body: { title: 'Write the copy' } })
    const list = await call<PlanningWorkItem[]>('/work-items')
    expect(list.value.map((item) => item.key)).toEqual(['SHOP-1', 'SHOP-2'])
  })

  it('returns a task by its key, in capitals or small letters', async () => {
    const made = await call<PlanningWorkItem>('/work-items', {
      method: 'POST',
      body: { title: 'Fix the login' }
    })
    for (const key of ['SHOP-1', 'shop-1']) {
      const found = await call<PlanningWorkItem>(`/work-items/by-key/${key}`)
      expect(found).toMatchObject({ status: 200, value: { id: made.value.id, key: 'SHOP-1' } })
    }
    expect((await call('/work-items/by-key/SHOP-9')).status).toBe(404)
    expect((await call('/work-items/by-key/GAR-1')).status).toBe(404)
    expect((await call('/work-items/by-key/nonsense')).status).toBe(404)
  })

  it('reads and changes the prefix, refusing a bad or taken one', async () => {
    await call('/work-items', { method: 'POST', body: { title: 'Fix the login' } })
    expect((await call('/task-prefix')).value).toEqual({ taskPrefix: 'SHOP' })
    const changed = await call('/task-prefix', { method: 'PUT', body: { taskPrefix: 'store' } })
    expect(changed).toMatchObject({ status: 200, value: { taskPrefix: 'STORE' } })
    expect((await call<PlanningWorkItem[]>('/work-items')).value[0].key).toBe('STORE-1')
    expect((await call('/work-items/by-key/STORE-1')).status).toBe(200)
    expect((await call('/work-items/by-key/SHOP-1')).status).toBe(404)

    const taken = store.getProjects().find((project) => project.id === 'garden')!.taskPrefix
    const refused = await call('/task-prefix', { method: 'PUT', body: { taskPrefix: taken } })
    expect(refused.status).toBe(400)
    expect(refused.error).toContain('Garden')
    expect((await call('/task-prefix', { method: 'PUT', body: { taskPrefix: 'X1' } })).status).toBe(
      400
    )
    expect((await call('/task-prefix', { method: 'PUT', body: {} })).status).toBe(400)
    expect((await call('/task-prefix')).value).toEqual({ taskPrefix: 'STORE' })
  })

  it('describes the routes in HELP_ROUTES', () => {
    const paths = HELP_ROUTES.map((entry) => `${entry.method} ${entry.path}`)
    expect(paths).toEqual(
      expect.arrayContaining([
        'GET /work-items/by-key/:key',
        'GET /task-prefix',
        'PUT /task-prefix'
      ])
    )
  })
})
