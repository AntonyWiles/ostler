import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../electron/safe-storage', () => ({
  isEncryptionAvailable: () => true,
  isEncryptedSecret: (value: string) => value.startsWith('ostler-secure:v1:'),
  encryptApiKey: (key: string) => key,
  decryptApiKey: (value: string) => value,
  sealSecret: (token: string) => token,
  openSecret: (value: string) => value
}))

import { ConfigStore } from '../../electron/config-store'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { HarnessHttpServer } from '../../electron/services/harness-http-server'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { resolveProjectConventions } from '../../electron/services/project-conventions'
import type { ProjectLesson, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { initProjectRepository } from '../helpers/harness'
import { startOnFreePort } from '../helpers/http-port'
import { useTempDir } from '../helpers/temp-dir'

let AUTOMATION_PORT = 0
let HARNESS_PORT = 0
const TOKEN = 'lessons-token'

describe('lessons over the automation API and to connected agents (N9.6a)', () => {
  const root = useTempDir('ostler-lessons-routes-')
  let store: ConfigStore
  let projectId: string
  let database: EventDatabase
  let planning: PlanningService
  let harnessService: HarnessService
  let automation: AutomationHttpServer
  let harness: HarnessHttpServer

  const projects = (): WatchedProject[] =>
    store.getProjects().map((project) => ({ ...project, automationToken: TOKEN }))

  beforeEach(async () => {
    const folder = path.join(root(), 'project')
    await initProjectRepository(folder)
    store = new ConfigStore(path.join(root(), 'config.json'))
    projectId = store.registerProject({ name: 'Lessons', folder }).id
    store.updateProject(projectId, { agentConventions: '# Rules\n\nUse tabs.' })
    const db = await createMigratedDatabase(root())
    database = new EventDatabase(db)
    planning = new PlanningService(db, () => [projectId])
    harnessService = new HarnessService(path.join(root(), 'data'), database)
    // The conventions writers as electron/app/services.ts wires them.
    const conventions = {
      update: (id: string, text: string) =>
        store.updateProject(id, { agentConventions: text }).agentConventions ?? '',
      addLesson: (id: string, text: unknown) => store.addProjectLesson(id, { text }),
      updateLesson: (
        id: string,
        lessonId: string,
        changes: { text?: unknown; enabled?: unknown }
      ) => store.updateProjectLesson(id, lessonId, changes),
      removeLesson: (id: string, lessonId: string) => store.removeProjectLesson(id, lessonId)
    }
    automation = new AutomationHttpServer(
      projects,
      path.join(root(), 'runtime'),
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
      undefined,
      undefined,
      undefined,
      conventions
    )
    AUTOMATION_PORT = await startOnFreePort((port) => automation.start(port))
    harness = new HarnessHttpServer(
      () => store.getProjects(),
      harnessService,
      () => {},
      path.join(root(), 'data')
    )
    HARNESS_PORT = await startOnFreePort((port) => harness.start(port))
  })

  afterEach(() => {
    automation.stop()
    harness.stop()
    harnessService.stopAll()
    planning.close()
    database.close()
  })

  function api(method: string, urlPath: string, body?: unknown) {
    return fetch(`http://127.0.0.1:${AUTOMATION_PORT}/automation/${projectId}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }

  it('adds, reads, changes and deletes lessons, refusing bad ones', async () => {
    const added = await api('POST', '/lessons', { text: '  Tests go beside the file.  ' })
    expect(added.status).toBe(201)
    const lesson = ((await added.json()) as { value: ProjectLesson }).value
    expect(lesson).toMatchObject({ text: 'Tests go beside the file.', enabled: true, source: null })

    const read = (await (await api('GET', '/conventions')).json()) as {
      value: { agentConventions: string; lessons: ProjectLesson[] }
    }
    expect(read.value.agentConventions).toBe('# Rules\n\nUse tabs.')
    expect(read.value.lessons).toEqual([lesson])

    const off = await api('PATCH', `/lessons/${lesson.id}`, { enabled: false })
    await expect(off.json()).resolves.toMatchObject({ ok: true, value: { enabled: false } })
    const edited = await api('PATCH', `/lessons/${lesson.id}`, { text: 'Tests beside files.' })
    await expect(edited.json()).resolves.toMatchObject({ value: { text: 'Tests beside files.' } })

    expect((await api('POST', '/lessons', { text: '' })).status).toBe(400)
    expect((await api('POST', '/lessons', { text: 'x'.repeat(501) })).status).toBe(400)
    expect((await api('POST', '/lessons', {})).status).toBe(400)
    expect((await api('PATCH', `/lessons/${lesson.id}`, {})).status).toBe(400)
    expect((await api('PATCH', `/lessons/${lesson.id}`, { enabled: 'no' })).status).toBe(400)
    expect((await api('PATCH', '/lessons/missing', { enabled: true })).status).toBe(404)

    const deleted = await api('DELETE', `/lessons/${lesson.id}`)
    await expect(deleted.json()).resolves.toEqual({
      ok: true,
      value: { id: lesson.id, deleted: true }
    })
    expect(store.getProjects()[0].agentLessons).toEqual([])
    expect((await api('DELETE', `/lessons/${lesson.id}`)).status).toBe(404)
  })

  it('lists the lesson routes in its help', async () => {
    const help = (await (await api('GET', '/help')).json()) as {
      value: { routes: Array<{ method: string; path: string }> }
    }
    const routes = help.value.routes.map((route) => `${route.method} ${route.path}`)
    expect(routes).toEqual(
      expect.arrayContaining([
        'POST /lessons',
        'PATCH /lessons/:lessonId',
        'DELETE /lessons/:lessonId'
      ])
    )
  })

  it("gives a connected agent's claim a saved lesson in projectConventions", async () => {
    const response = await api('POST', '/lessons', { text: 'Use formatDate for dates.' })
    expect(response.status).toBe(201)

    const project = store.getProjects()[0]
    const task = harnessService.addTask(project, 'Fix the login', '')
    const session = await harnessService.startSessionForTask(project, task.id)
    const call = (urlPath: string) =>
      fetch(`http://127.0.0.1:${HARNESS_PORT}/harness/${projectId}${urlPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ sessionId: session.id })
      })
    expect((await call(`/tasks/${task.id}/release`)).ok).toBe(true)
    const claim = (await (await call(`/tasks/${task.id}/claim`)).json()) as {
      ok: boolean
      value: { projectConventions?: string }
    }
    expect(claim.ok).toBe(true)
    expect(claim.value.projectConventions).toBe(resolveProjectConventions(store.getProjects()[0]))
    expect(claim.value.projectConventions).toContain('# Rules\n\nUse tabs.')
    expect(claim.value.projectConventions).toContain('## Lessons from earlier reviews')
    expect(claim.value.projectConventions).toMatch(
      /- \d{4}-\d{2}-\d{2}: Use formatDate for dates\./
    )
  })
})
