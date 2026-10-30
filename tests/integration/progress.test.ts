import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { ProgressService, trackedTime } from '../../electron/services/progress-service'
import type { ProgressWeek, WatchedProject, YearInReview } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
const human = { kind: 'human' as const }

const at = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id === 'progress-project' ? 'Website' : 'Garden',
    automationToken: token
  })
}

describe('progress routes (N3.6)', () => {
  const root = useTempDir('ostler-progress-http-')
  let planning: PlanningService
  let server: AutomationHttpServer
  let service: ProgressService
  const project = watched('progress-project', 'token-one')
  const other = watched('other-project', 'token-two')

  beforeEach(async () => {
    planning = new PlanningService(await createMigratedDatabase(root()), () => [
      project.id,
      other.id
    ])
    service = new ProgressService({
      db: planning.database,
      getProjects: () => [project, other],
      getMe: () => null,
      getDaysOff: () => [],
      getTimeEntries: trackedTime(planning.time, () => null),
      now: () => at('2026-10-17')
    })
    server = new AutomationHttpServer(
      () => [project, other],
      path.join(root(), 'runtime'),
      undefined,
      planning
    )
    server.progress = service
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
    planning?.close()
  })

  function call(urlPath: string, method = 'GET') {
    return fetch(`http://127.0.0.1:${PORT}/automation/${project.id}${urlPath}`, {
      method,
      headers: { Authorization: 'Bearer token-one' }
    })
  }

  async function value<T>(response: Response): Promise<T> {
    const body = (await response.json()) as { ok: boolean; value: T; error?: string }
    if (!body.ok) throw new Error(body.error)
    return body.value
  }

  function finish(projectId: string, title: string, when: number) {
    const task = planning.createWorkItem(projectId, { title }, human)
    planning.updateWorkItem(task.id, { status: 'done' }, human)
    planning.database
      .prepare('UPDATE planning_status_history SET at = ? WHERE work_item_id = ?')
      .run(when, task.id)
    return task
  }

  it('lists both routes in help', async () => {
    const help = await value<{ routes: { method: string; path: string }[] }>(await call('/help'))
    const routes = help.routes.map((route) => `${route.method} ${route.path}`)
    expect(routes).toEqual(expect.arrayContaining(['GET /progress', 'GET /year-in-review']))
  })

  it("counts this project's finished tasks per week, as Home does", async () => {
    finish(project.id, 'One', at('2026-10-05'))
    finish(project.id, 'Two', at('2026-10-07'))
    finish(project.id, 'Three', at('2026-10-13'))
    finish(other.id, 'Theirs', at('2026-10-06'))
    const result = await value<{ weekStart: number; weeks: ProgressWeek[] }>(
      await call('/progress?from=2026-10-01&to=2026-10-17')
    )
    expect(result.weekStart).toBe(1)
    expect(result.weeks).toEqual([
      { weekStart: '2026-09-28', count: 0 },
      { weekStart: '2026-10-05', count: 2 },
      { weekStart: '2026-10-12', count: 1 }
    ])
    // The same numbers as the service gives Home, for this project.
    expect(result.weeks).toEqual(service.weeks(project.id, '2026-10-01', '2026-10-17'))
    const sunday = await value<{ weeks: ProgressWeek[] }>(
      await call('/progress?from=2026-10-04&to=2026-10-10&weekStart=0')
    )
    expect(sunday.weeks).toEqual([{ weekStart: '2026-10-04', count: 2 }])

    expect((await call('/progress?from=2026-10-17&to=2026-10-01')).status).toBe(400)
    expect((await call('/progress?from=yesterday&to=2026-10-01')).status).toBe(400)
    expect((await call('/progress?from=2026-10-01&to=2026-10-17&weekStart=9')).status).toBe(400)
    expect((await call('/progress', 'POST')).status).toBe(405)
  })

  it("returns this project's part of Your year", async () => {
    const task = finish(project.id, 'Launch page', at('2026-03-10'))
    finish(other.id, 'Theirs', at('2026-03-11'))
    planning.time.create(project.id, {
      workItemId: task.id,
      startedAt: at('2026-03-09'),
      durationSeconds: 5400,
      personId: null
    })
    const year = await value<YearInReview>(await call('/year-in-review?year=2026'))
    expect(year.totalTasks).toBe(1)
    expect(year.months[2].tasks).toBe(1)
    expect(year.busiestWeek).toEqual({ weekStart: '2026-03-09', count: 1 })
    expect(year.projectsFinished).toEqual([
      { projectId: project.id, projectName: 'Website', finishedOn: '2026-03-10' }
    ])
    expect(year.topProjects).toEqual([{ projectId: project.id, projectName: 'Website', count: 1 }])
    expect(year.time?.totalSeconds).toBe(5400)
    expect(year.years).toEqual([2026])
    expect((await call('/year-in-review')).status).toBe(400)
    expect((await call('/year-in-review?year=twenty')).status).toBe(400)
  })
})
