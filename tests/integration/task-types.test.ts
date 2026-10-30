import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type {
  PlanningTaskType,
  PlanningTaskTypeDeletion,
  PlanningWorkItem,
  WatchedProject
} from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({ id, name: id, addedAt: Date.now(), automationToken: token })
}

describe('automation-http-server.ts task types (N2.7a)', () => {
  const root = useTempDir('ostler-automation-task-types-')
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

  it('describes every task type route in HELP_ROUTES', () => {
    const routes = HELP_ROUTES.map((entry) => `${entry.method} ${entry.path}`)
    for (const route of [
      'GET /task-types',
      'POST /task-types',
      'POST /task-types/reorder',
      'PATCH /task-types/:typeId',
      'DELETE /task-types/:typeId',
      'POST /task-types/restore'
    ])
      expect(routes).toContain(route)
  })

  it('creates, lists, renames, reorders, deletes and restores types', async () => {
    const bug = await call<PlanningTaskType>('POST', '/task-types', { name: 'Bug', icon: 'bug' })
    expect(bug.status).toBe(200)
    const chore = await call<PlanningTaskType>('POST', '/task-types', { name: 'Chore' })
    expect((await call('POST', '/task-types', { name: 'bug' })).ok).toBe(false)
    expect((await call('POST', '/task-types', { name: 'Odd', icon: 'skull' })).ok).toBe(false)

    expect(
      (await call<PlanningTaskType>('PATCH', `/task-types/${bug.value.id}`, { name: 'Defect' }))
        .value.name
    ).toBe('Defect')
    const reordered = await call<PlanningTaskType[]>('POST', '/task-types/reorder', {
      typeIds: [chore.value.id, bug.value.id]
    })
    expect(reordered.value.map((type) => type.name)).toEqual(['Chore', 'Defect'])

    const task = await call<PlanningWorkItem>('POST', '/work-items', {
      title: 'Crash',
      typeId: bug.value.id
    })
    const deleted = await call<PlanningTaskTypeDeletion>('DELETE', `/task-types/${bug.value.id}`)
    expect(deleted.value.taskIds).toEqual([task.value.id])
    expect((await call<PlanningTaskType[]>('GET', '/task-types')).value).toHaveLength(1)
    expect(planning.getWorkItem(task.value.id).typeId).toBeNull()

    const restored = await call<PlanningTaskType>('POST', '/task-types/restore', deleted.value)
    expect(restored.value.id).toBe(bug.value.id)
    expect(planning.getWorkItem(task.value.id).typeId).toBe(bug.value.id)
  })

  it("refuses another project's type, on its own routes and on a task", async () => {
    const theirs = await call<PlanningTaskType>(
      'POST',
      '/task-types',
      { name: 'Errand' },
      projects[1]
    )
    expect((await call('PATCH', `/task-types/${theirs.value.id}`, { name: 'Mine' })).ok).toBe(false)
    expect((await call('DELETE', `/task-types/${theirs.value.id}`)).ok).toBe(false)
    expect((await call('POST', '/work-items', { title: 'X', typeId: theirs.value.id })).ok).toBe(
      false
    )
  })

  it('sets typeId on create and update, and filters by it', async () => {
    const bug = await call<PlanningTaskType>('POST', '/task-types', { name: 'Bug' })
    const crash = await call<PlanningWorkItem>('POST', '/work-items', {
      title: 'Crash',
      typeId: bug.value.id
    })
    expect(crash.value.typeId).toBe(bug.value.id)
    const tidy = await call<PlanningWorkItem>('POST', '/work-items', { title: 'Tidy' })
    expect(tidy.value.typeId).toBeNull()
    const patched = await call<PlanningWorkItem>('PATCH', `/work-items/${tidy.value.id}`, {
      typeId: bug.value.id
    })
    expect(patched.value.typeId).toBe(bug.value.id)
    await call('PATCH', `/work-items/${tidy.value.id}`, { typeId: null })

    const filter = (value: string[]) =>
      encodeURIComponent(
        JSON.stringify({ match: 'all', conditions: [{ field: 'type', op: 'is', value }] })
      )
    const typed = await call<PlanningWorkItem[]>(
      'GET',
      `/work-items?filter=${filter([bug.value.id])}`
    )
    expect(typed.value.map((item) => item.title)).toEqual(['Crash'])
    const untyped = await call<PlanningWorkItem[]>('GET', `/work-items?filter=${filter(['none'])}`)
    expect(untyped.value.map((item) => item.title)).toEqual(['Tidy'])
  })
})
