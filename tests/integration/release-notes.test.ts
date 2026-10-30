import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type {
  PlanningIteration,
  PlanningMilestone,
  PlanningTaskType,
  PlanningWorkItem,
  WatchedProject
} from '../../src/shared/ostler-api'
import type { ReleaseNotes } from '../../src/shared/release-notes'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({ id, name: id, addedAt: Date.now(), automationToken: token })
}

describe('automation-http-server.ts release notes (N9.9)', () => {
  const root = useTempDir('ostler-automation-release-notes-')
  let projects: WatchedProject[]
  let planning: PlanningService
  let server: AutomationHttpServer

  beforeEach(async () => {
    projects = [watched('home', 'token-home'), watched('other', 'token-other')]
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
    body?: unknown,
    project = projects[0]
  ): Promise<{ status: number; ok: boolean; value: T; error?: string }> {
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

  it('describes both release notes routes in HELP_ROUTES', () => {
    const routes = HELP_ROUTES.map((entry) => `${entry.method} ${entry.path}`)
    expect(routes).toContain('GET /milestones/:milestoneId/release-notes')
    expect(routes).toContain('GET /iterations/:iterationId/release-notes')
  })

  it('returns the draft from the milestone’s finished tasks, grouped as asked', async () => {
    const milestone = await call<PlanningMilestone>('POST', '/milestones', { name: 'v2 *beta*' })
    const bug = await call<PlanningTaskType>('POST', '/task-types', { name: 'Bug' })
    const task = (title: string, extra: Record<string, unknown> = {}) =>
      call<PlanningWorkItem>('POST', '/work-items', {
        title,
        milestoneId: milestone.value.id,
        ...extra
      })
    await task('Crash on save', {
      status: 'done',
      typeId: bug.value.id,
      description: 'Saving no longer crashes. More words.',
      labels: ['editor']
    })
    const archived = await task('Old fix', { status: 'done' })
    planning.archiveWorkItem(archived.value.id, { kind: 'human' })
    const binned = await task('Binned', { status: 'done' })
    planning.deleteWorkItem(binned.value.id, { kind: 'human' })
    await task('Still open')

    const base = `/milestones/${milestone.value.id}/release-notes`
    const byType = await call<ReleaseNotes>('GET', base)
    expect(byType.status).toBe(200)
    expect(byType.value.title).toBe('Release notes: v2 *beta*')
    expect(byType.value.markdown).toContain('# Release notes: v2 \\*beta\\*')
    expect(byType.value.markdown).toContain('2 tasks finished')
    expect(byType.value.markdown).toContain('## Bug\n\n- Crash on save\n\n## Other\n\n- Old fix\n')
    expect(byType.value.taskTitles.sort()).toEqual(['Crash on save', 'Old fix'])

    const byLabel = await call<ReleaseNotes>('GET', `${base}?groupBy=label&descriptions=true`)
    expect(byLabel.value.markdown).toContain(
      '## editor\n\n- Crash on save: Saving no longer crashes.\n'
    )
    const none = await call<ReleaseNotes>('GET', `${base}?groupBy=none`)
    expect(none.value.markdown).not.toContain('## ')

    const bad = await call('GET', `${base}?groupBy=colour`)
    expect(bad.status).toBe(400)
    // Another project's token cannot read this milestone.
    expect((await call('GET', base, undefined, projects[1])).ok).toBe(false)
    expect((await call('GET', '/milestones/missing/release-notes')).ok).toBe(false)
  })

  it('returns an iteration’s notes and lists subtasks under their parent when asked', async () => {
    const iteration = await call<PlanningIteration>('POST', '/iterations', {
      name: 'Sprint 1',
      startDate: '2026-10-01',
      endDate: '2026-10-14'
    })
    const parent = await call<PlanningWorkItem>('POST', '/work-items', {
      title: 'Parent',
      status: 'done',
      iterationId: iteration.value.id
    })
    await call('POST', '/work-items', {
      title: 'Child',
      status: 'done',
      iterationId: iteration.value.id,
      parentWorkItemId: parent.value.id
    })
    const base = `/iterations/${iteration.value.id}/release-notes?groupBy=none`
    expect((await call<ReleaseNotes>('GET', base)).value.taskTitles).toEqual(['Parent'])
    const withSubtasks = await call<ReleaseNotes>('GET', `${base}&subtasks=true`)
    expect(withSubtasks.value.markdown).toContain('- Parent\n  - Child\n')
  })
})
