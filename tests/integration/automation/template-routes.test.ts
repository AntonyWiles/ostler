import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../../electron/services/automation-http-server'
import { PlanningService } from '../../../electron/services/planning-service'
import type { WatchedProject } from '../../../src/shared/ostler-api'
import { useAutomationServer } from '../../helpers/automation-fixture'
import { createMigratedDatabase } from '../../helpers/database'
import { useTempDir } from '../../helpers/temp-dir'

describe('automation-http-server.ts template routes (P5.8)', () => {
  const temp = useTempDir('ostler-automation-templates-')
  const http = useAutomationServer()
  let root: string
  let projects: WatchedProject[]
  let planning: PlanningService
  let server: AutomationHttpServer
  let started: string[]

  beforeEach(async () => {
    root = temp()
    const { ConfigStore } = await import('../../../electron/config-store')
    const { ProjectScaffoldService } =
      await import('../../../electron/services/project-scaffold-service')
    const { ProjectPackageService } =
      await import('../../../electron/services/project-package-service')
    const store = new ConfigStore(path.join(root, 'config.json'))
    const first = store.registerProject({ name: 'Party', folder: null })
    store.updateProject(first.id, { automationToken: 'template-token' })
    projects = store.getProjects()
    planning = new PlanningService(await createMigratedDatabase(root), () =>
      store.getProjects().map((entry) => entry.id)
    )
    const scaffold = new ProjectScaffoldService(store, () => root)
    const templates = new ProjectPackageService({
      planning,
      registerProject: (request, fixed) => scaffold.createProject(request, fixed),
      getProject: (projectId) => store.getProjects().find((entry) => entry.id === projectId)!,
      dataDir: root,
      appVersion: 'test'
    })
    started = []
    server = new AutomationHttpServer(
      () => store.getProjects(),
      path.join(root, 'runtime'),
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
      { service: templates, projectCreated: (project) => started.push(project.id) }
    )
    await http.start(server, planning)
  })

  function call(method: string, urlPath: string, body?: unknown) {
    return http.request(method, `/automation/${projects[0].id}${urlPath}`, {
      body,
      token: 'template-token'
    })
  }

  it('lists templates, saves this project as one, and creates a project from it', async () => {
    const listed = (await (await call('GET', '/templates')).json()) as {
      value: Array<{ id: string; source: string }>
    }
    expect(listed.value.map((entry) => entry.id)).toContain('event-planning')

    planning.createWorkItem(projects[0].id, { title: 'Book the hall' }, { kind: 'human' })
    const saved = await call('POST', '/templates', { name: 'Party plan' })
    expect(saved.status).toBe(200)
    const template = ((await saved.json()) as { value: { id: string; taskCount: number } }).value
    expect(template.taskCount).toBe(1)

    const renamed = await call('PATCH', `/templates/${template.id}`, { name: 'Parties' })
    expect(((await renamed.json()) as { value: { name: string } }).value.name).toBe('Parties')

    const created = await call('POST', '/templates/event-planning/create-project', {
      name: 'Summer fair'
    })
    expect(created.status).toBe(200)
    const project = ((await created.json()) as { value: { id: string; name: string } }).value
    expect(project.name).toBe('Summer fair')
    expect(started).toEqual([project.id])
    expect(planning.listMilestones(project.id).map((milestone) => milestone.name)).toContain(
      'Venue booked'
    )

    expect((await call('DELETE', `/templates/${template.id}`)).status).toBe(200)
    expect((await call('PATCH', '/templates/sample', { name: 'Mine' })).status).toBe(400)
  })
})
