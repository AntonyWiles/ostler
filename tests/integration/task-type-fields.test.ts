import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { ReportService } from '../../electron/services/report-service'
import type {
  PlanningFieldDefinition,
  PlanningTaskType,
  ProjectReport,
  TaskTemplate,
  WatchedProject
} from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
const human = { kind: 'human' as const }

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({ id, name: id, addedAt: Date.now(), automationToken: token })
}

describe('automation-http-server.ts task type fields and the report by type (N2.7b)', () => {
  const root = useTempDir('ostler-automation-type-fields-')
  let projects: WatchedProject[]
  let planning: PlanningService
  let reports: ReportService
  let server: AutomationHttpServer

  beforeEach(async () => {
    projects = [watched('home', 'token-home'), watched('other', 'token-other')]
    const databasePath = await createMigratedDatabase(root())
    planning = new PlanningService(databasePath, () => projects.map((project) => project.id))
    reports = new ReportService({ planning, listPeople: () => [] })
    server = new AutomationHttpServer(
      () => projects,
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
      reports
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

  it('says how in HELP_ROUTES', () => {
    const text = (method: string, route: string) => {
      const entry = HELP_ROUTES.find((item) => item.method === method && item.path === route)!
      return `${entry.description} ${entry.request ?? ''}`
    }
    expect(text('GET', '/task-types')).toMatch(/fieldIds/)
    expect(text('GET', '/task-types')).toMatch(/templateId/)
    expect(text('PATCH', '/task-types/:typeId')).toMatch(/fieldIds/)
    expect(text('POST', '/task-types')).toMatch(/templateId/)
    expect(text('GET', '/reports')).toMatch(/splitBy=type/)
  })

  it('reads and writes fieldIds and templateId on /task-types', async () => {
    const version = await call<PlanningFieldDefinition>('POST', '/fields', {
      name: 'Version',
      type: 'text'
    })
    const template = await call<TaskTemplate>('POST', '/task-templates', {
      name: 'Bug report',
      scope: 'project',
      body: { title: 'Bug: ' }
    })
    expect(template.ok).toBe(true)
    const created = await call<PlanningTaskType>('POST', '/task-types', {
      name: 'Bug',
      fieldIds: [version.value.id],
      templateId: template.value.id
    })
    expect(created.value).toMatchObject({
      fieldIds: [version.value.id],
      templateId: template.value.id
    })
    const listed = await call<PlanningTaskType[]>('GET', '/task-types')
    expect(listed.value[0]).toMatchObject({ fieldIds: [version.value.id] })

    const patched = await call<PlanningTaskType>('PATCH', `/task-types/${created.value.id}`, {
      fieldIds: null,
      templateId: null
    })
    expect(patched.value).toMatchObject({ fieldIds: null, templateId: null })

    const unknown = await call('PATCH', `/task-types/${created.value.id}`, { fieldIds: ['nope'] })
    expect(unknown.status).toBe(400)
    // Another project's template is refused.
    const theirs = await call<TaskTemplate>(
      'POST',
      '/task-templates',
      { name: 'Theirs', scope: 'project', body: { title: 'x' } },
      projects[1]
    )
    const refused = await call('PATCH', `/task-types/${created.value.id}`, {
      templateId: theirs.value.id
    })
    expect(refused.status).toBe(400)

    // Deleting the field takes it off the type.
    await call('PATCH', `/task-types/${created.value.id}`, { fieldIds: [version.value.id] })
    await call('DELETE', `/fields/${version.value.id}`)
    expect((await call<PlanningTaskType[]>('GET', '/task-types')).value[0].fieldIds).toEqual([])
  })

  it('returns the report split by type with splitBy=type, the same numbers as the app', async () => {
    const bug = planning.taskTypes.create('home', { name: 'Bug' })
    const fixed = planning.createWorkItem('home', { title: 'Fixed', typeId: bug.id }, human)
    const plain = planning.createWorkItem('home', { title: 'Plain' }, human)
    for (const item of [fixed, plain]) {
      planning.updateWorkItem(item.id, { status: 'active' }, human)
      planning.updateWorkItem(item.id, { status: 'done' }, human)
    }

    const unsplit = await call<ProjectReport>('GET', '/reports')
    expect(unsplit.value.throughput).not.toHaveProperty('byType')
    expect(unsplit.value.cycleTime).not.toHaveProperty('byType')

    const split = await call<ProjectReport>('GET', '/reports?splitBy=type&range=90d')
    const byType = split.value.throughput.byType!
    expect(byType.map((part) => [part.series.name, part.total])).toEqual([
      ['Bug', 1],
      ['No type', 1]
    ])
    expect(split.value.cycleTime.byType!.map((part) => part.sampleSize)).toEqual([1, 1])
    // The Overview reads the same report.
    const app = reports.getReport(projects[0], '90d')
    expect(app.throughput.byType).toEqual(byType)

    expect((await call('GET', '/reports?splitBy=label')).status).toBe(400)
    // A project with no types gets empty lists.
    const none = await call<ProjectReport>('GET', '/reports?splitBy=type', undefined, projects[1])
    expect(none.value.throughput.byType).toEqual([])
  })
})
