import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type { PlanningWorkItem, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({ id, name: id, addedAt: Date.now(), automationToken: token })
}

describe('automation-http-server.ts idea scores (N1.1b)', () => {
  const root = useTempDir('ostler-automation-idea-scores-')
  let projects: WatchedProject[]
  let planning: PlanningService
  let server: AutomationHttpServer

  beforeEach(async () => {
    projects = [watched('home', 'token-home')]
    const databasePath = await createMigratedDatabase(root())
    planning = new PlanningService(databasePath, () => projects.map((project) => project.id))
    server = new AutomationHttpServer(
      () => projects,
      path.join(root(), 'runtime'),
      undefined,
      planning
    )
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
    planning?.close()
  })

  async function call<T = unknown>(
    method: string,
    route: string,
    body?: unknown
  ): Promise<{ status: number; ok: boolean; value: T; error?: string }> {
    const project = projects[0]
    const response = await fetch(`http://127.0.0.1:${PORT}/automation/${project.id}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${project.automationToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const json = (await response.json()) as { ok: boolean; value: T; error?: string }
    return { status: response.status, ...json }
  }

  it('says how to read, write and filter scores in HELP_ROUTES', () => {
    const help = (method: string, route: string) =>
      HELP_ROUTES.filter((entry) => entry.method === method && entry.path === route)
        .map((entry) => `${entry.description} ${entry.request ?? ''}`)
        .join(' ')
    expect(help('POST', '/work-items')).toMatch(/impact\?, effort\?/)
    expect(help('POST', '/work-items')).toMatch(/whole number from 1 to 5/)
    expect(help('PATCH', '/work-items/:workItemId')).toMatch(/impact and effort/)
    expect(help('GET', '/work-items')).toMatch(/estimate, impact, effort is "set"\|"empty"/)
  })

  it('creates and updates a task with scores, clears one with null, and filters by them', async () => {
    const created = await call<PlanningWorkItem>('POST', '/work-items', {
      title: 'Dark mode',
      someday: true,
      impact: 4,
      effort: 2
    })
    expect(created.status).toBe(200)
    expect(created.value).toMatchObject({ impact: 4, effort: 2, someday: true })
    await call('POST', '/work-items', { title: 'Plain task' })

    const updated = await call<PlanningWorkItem>('PATCH', `/work-items/${created.value.id}`, {
      impact: null,
      effort: 1
    })
    expect(updated.status).toBe(200)
    expect(updated.value).toMatchObject({ impact: null, effort: 1 })

    const filter = encodeURIComponent(
      JSON.stringify({ match: 'all', conditions: [{ field: 'effort', op: 'lessThan', value: 3 }] })
    )
    const listed = await call<PlanningWorkItem[]>('GET', `/work-items?filter=${filter}`)
    expect(listed.value.map((item) => item.title)).toEqual(['Dark mode'])
  })

  it('refuses a score out of range, a fraction or text, and changes nothing', async () => {
    const created = await call<PlanningWorkItem>('POST', '/work-items', {
      title: 'Idea',
      impact: 3
    })
    for (const impact of [0, 6, 2.5, 'high']) {
      const refused = await call('PATCH', `/work-items/${created.value.id}`, { impact })
      expect(refused.status).toBe(400)
      expect(refused.error).toBe('Impact must be a whole number from 1 to 5, or empty')
    }
    const refusedCreate = await call('POST', '/work-items', { title: 'Other', effort: 9 })
    expect(refusedCreate.status).toBe(400)
    expect(refusedCreate.error).toBe('Effort must be a whole number from 1 to 5, or empty')
    expect(planning.getWorkItem(created.value.id).impact).toBe(3)
    expect(planning.listWorkItems('home').map((item) => item.title)).toEqual(['Idea'])
  })
})
