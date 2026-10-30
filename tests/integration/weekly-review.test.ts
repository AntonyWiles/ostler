import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { WeeklyReviewService } from '../../electron/services/weekly-review-service'
import type { WatchedProject, WeeklyReviewRecord } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({ id, name: id, addedAt: Date.now(), automationToken: token })
}

describe('automation-http-server.ts GET /reviews/last (N1.5)', () => {
  const root = useTempDir('ostler-automation-reviews-')
  let projects: WatchedProject[]
  let planning: PlanningService
  let server: AutomationHttpServer

  beforeEach(async () => {
    projects = [watched('home-project', 'token-one'), watched('other-project', 'token-two')]
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

  async function get<T = unknown>(
    route: string,
    project = projects[0]
  ): Promise<{ status: number; ok: boolean; value: T; error?: string }> {
    const response = await fetch(`http://127.0.0.1:${PORT}/automation/${project.id}${route}`, {
      headers: { Authorization: `Bearer ${project.automationToken}` }
    })
    const json = (await response.json()) as { ok: boolean; value: T; error?: string }
    return { status: response.status, ...json }
  }

  const reviews = () =>
    new WeeklyReviewService({
      db: planning.database,
      getProjects: () => projects,
      getMeId: () => null,
      inboxCount: () => 0,
      atRisk: () => null
    })

  it('lists the route in /help', async () => {
    const help = await get<{ routes: Array<{ method: string; path: string }> }>('/help')
    expect(help.value.routes.some((r) => r.method === 'GET' && r.path === '/reviews/last')).toBe(
      true
    )
  })

  it('returns null before the first review', async () => {
    const result = await get('/reviews/last')
    expect(result).toMatchObject({ status: 200, ok: true, value: null })
  })

  it('returns the last finished review, the same for every project', async () => {
    reviews().finish({ inbox: { shown: 1, changed: 1 } })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const last = reviews().finish({ overdue: { shown: 4, changed: 2 } })
    const result = await get<WeeklyReviewRecord>('/reviews/last')
    expect(result.status).toBe(200)
    expect(result.value).toEqual(last)
    expect((await get<WeeklyReviewRecord>('/reviews/last', projects[1])).value).toEqual(last)
  })

  it('refuses a wrong token', async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/automation/home-project/reviews/last`, {
      headers: { Authorization: 'Bearer token-two' }
    })
    expect(response.status).toBe(401)
  })
})
