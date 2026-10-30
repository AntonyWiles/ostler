import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { EventDatabase } from '../../electron/services/event-database'
import { ConfigStore } from '../../electron/config-store'
import type { GitCommit, PlanningWorkItem, TaskCommit } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

describe('automation-http-server.ts smart commits (N9.8b)', () => {
  const root = useTempDir('ostler-automation-smart-commits-')
  let store: ConfigStore
  let planning: PlanningService
  let events: EventDatabase
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
    events = new EventDatabase(databasePath)
    server = new AutomationHttpServer(
      () => store.getProjects(),
      path.join(root(), 'runtime'),
      undefined,
      planning
    )
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
    events?.close()
    planning?.close()
  })

  async function call<T = unknown>(
    route: string
  ): Promise<{ status: number; ok: boolean; value: T; error?: string }> {
    const response = await fetch(`http://127.0.0.1:${PORT}/automation/shop${route}`, {
      headers: { Authorization: 'Bearer token-shop' }
    })
    const json = (await response.json()) as { ok: boolean; value: T; error?: string }
    return { status: response.status, ...json }
  }

  function arrive(hash: string, message: string, at: number): void {
    const entry: GitCommit = {
      hash,
      abbreviatedHash: hash.slice(0, 7),
      message,
      body: '',
      author: 'Ana',
      date: new Date(at).toISOString(),
      filesChanged: 1,
      insertions: 1,
      deletions: 0
    }
    events.insertGitEvent('shop', { ...entry, branch: '' })
    planning.commitLinks.link('shop', [entry], { offer: true })
  }

  it("returns a task's linked commits, newest first", async () => {
    const made = planning.createWorkItem('shop', { title: 'Fix the login' }, planning.humanActor())
    arrive('a'.repeat(40), 'Start on shop-1', 1_000)
    arrive('b'.repeat(40), 'Fixes SHOP-1', 2_000)
    arrive('c'.repeat(40), 'Unrelated', 3_000)
    const result = await call<TaskCommit[]>(`/work-items/${made.id}/commits`)
    expect(result.status).toBe(200)
    expect(result.value).toEqual([
      {
        hash: 'b'.repeat(40),
        abbreviatedHash: 'bbbbbbb',
        subject: 'Fixes SHOP-1',
        author: 'Ana',
        date: new Date(2_000).toISOString(),
        fixes: true
      },
      expect.objectContaining({ hash: 'a'.repeat(40), fixes: false })
    ])
    // Nothing here changes the task.
    expect(planning.getWorkItem(made.id).status).toBe('backlog')
  })

  it("refuses another project's task", async () => {
    const other: PlanningWorkItem = planning.createWorkItem(
      'garden',
      { title: 'Plant' },
      planning.humanActor()
    )
    const result = await call(`/work-items/${other.id}/commits`)
    expect(result.ok).toBe(false)
    expect(result.status).toBeGreaterThanOrEqual(400)
  })

  it('describes the route in HELP_ROUTES', () => {
    const paths = HELP_ROUTES.map((entry) => `${entry.method} ${entry.path}`)
    expect(paths).toContain('GET /work-items/:workItemId/commits')
  })
})
