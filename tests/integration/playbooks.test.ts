import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as path from 'path'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { DEFAULT_CONFIG } from '../../src/shared/ostler-api'
import type {
  OstlerConfig,
  PlaybookRun,
  TaskTemplate,
  WatchedProject
} from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { initProjectRepository } from '../helpers/harness'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let AUTOMATION_PORT = 0

/** Playbooks (N9.6b) over the automation API: the agent part, the mark, and /run. */
describe('playbooks over the automation API', { timeout: 30_000 }, () => {
  const root = useTempDir('ostler-playbooks-http-')
  let project: WatchedProject
  let database: EventDatabase
  let planning: PlanningService
  let harnessService: HarnessService
  let server: AutomationHttpServer
  let config: OstlerConfig

  beforeEach(async () => {
    const projectPath = path.join(root(), 'project')
    await initProjectRepository(projectPath)
    project = makeWatchedProject({
      id: 'playbook-project',
      name: 'Playbook project',
      path: projectPath,
      addedAt: Date.now(),
      automationToken: 'automation-token'
    })
    config = {
      ...DEFAULT_CONFIG,
      harness: { ...DEFAULT_CONFIG.harness, enabled: true },
      ai: { ...DEFAULT_CONFIG.ai, provider: 'anthropic', model: 'claude-sonnet-5-5', effort: '' }
    }
    const dbPath = await createMigratedDatabase(root())
    database = new EventDatabase(dbPath)
    planning = new PlanningService(dbPath, () => [project.id])
    harnessService = new HarnessService(path.join(root(), 'data'), database)
    server = new AutomationHttpServer(
      () => [project],
      path.join(root(), 'data'),
      undefined,
      planning,
      harnessService
    )
    server.getConfig = () => config
    AUTOMATION_PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server.stop()
    harnessService.stopAll()
    planning.close()
    database.close()
  })

  async function call<T>(method: string, urlPath: string, body?: unknown) {
    const response = await fetch(
      `http://127.0.0.1:${AUTOMATION_PORT}/automation/${project.id}${urlPath}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${project.automationToken}`
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      }
    )
    return {
      status: response.status,
      json: (await response.json()) as { ok: boolean; value: T; error: string }
    }
  }

  const agent = {
    model: 'claude-haiku-5-5',
    effort: '',
    planFirst: 'yes',
    instructions: 'Keep major versions.'
  }

  it('reads and writes the agent part and the playbook mark through the template routes', async () => {
    const saved = await call<TaskTemplate>('POST', '/task-templates', {
      name: 'Update dependencies',
      scope: 'every',
      body: { title: 'Update the dependencies', agent },
      playbook: true
    })
    expect(saved.status).toBe(200)
    expect(saved.json.value).toMatchObject({ playbook: true, projectId: null, body: { agent } })

    const refused = await call('POST', '/task-templates', {
      name: 'Wrong model',
      body: { title: 'x', agent: { model: 'gpt-5' } },
      playbook: true
    })
    expect(refused.json.ok).toBe(false)
    expect(refused.json.error).toMatch(/not a model Settings offers/)

    const listed = await call<TaskTemplate[]>('GET', '/task-templates')
    expect(listed.json.value.find((tpl) => tpl.id === saved.json.value.id)?.playbook).toBe(true)

    const off = await call<TaskTemplate>('PATCH', `/task-templates/${saved.json.value.id}`, {
      playbook: false
    })
    expect(off.json.value.playbook).toBe(false)
    expect(off.json.value.body.agent).toEqual(agent)

    const item = planning.createWorkItem(project.id, { title: 'Translate' }, planning.humanActor())
    const fromTask = await call<TaskTemplate>('POST', '/task-templates', {
      fromWorkItemId: item.id,
      agent: { planFirst: 'no', instructions: 'Add the German words.' }
    })
    expect(fromTask.json.value).toMatchObject({
      playbook: true,
      body: {
        title: 'Translate',
        agent: { planFirst: 'no', instructions: 'Add the German words.' }
      }
    })
  })

  it('POST /task-templates/:id/run makes the task and queues it, returning both', async () => {
    const saved = await call<TaskTemplate>('POST', '/task-templates', {
      name: 'Update dependencies',
      body: { title: 'Update the dependencies', agent },
      playbook: true
    })
    const run = await call<PlaybookRun>('POST', `/task-templates/${saved.json.value.id}/run`, {
      overrides: { title: 'Update the dependencies for November' }
    })
    expect(run.status).toBe(200)
    const { workItem, task } = run.json.value
    expect(workItem).toMatchObject({
      title: 'Update the dependencies for November',
      status: 'ready',
      planFirst: 'yes',
      linkedHarnessTaskId: task.id
    })
    expect(task).toMatchObject({
      model: 'claude-haiku-5-5',
      planFirst: true,
      playbook: { templateId: saved.json.value.id, name: 'Update dependencies' }
    })
    expect(task.details).toContain('Playbook instructions:\nKeep major versions.')
    const queue = harnessService.getState(project).taskQueue
    expect(queue.find((queued) => queued.id === task.id)?.playbook?.name).toBe(
      'Update dependencies'
    )

    const plain = await call<TaskTemplate>('POST', '/task-templates', {
      name: 'Plain',
      body: { title: 'x' }
    })
    const notPlaybook = await call('POST', `/task-templates/${plain.json.value.id}/run`, {})
    expect(notPlaybook.json).toMatchObject({
      ok: false,
      error: 'That task template is not a playbook.'
    })

    config = { ...config, harness: { ...config.harness, enabled: false } }
    const agentsOff = await call('POST', `/task-templates/${saved.json.value.id}/run`, {})
    expect(agentsOff.json.ok).toBe(false)
    expect(planning.listWorkItems(project.id)).toHaveLength(1)
  })

  it('lists the run route and the agent part in HELP_ROUTES', () => {
    const run = HELP_ROUTES.find((route) => route.path === '/task-templates/:templateId/run')
    expect(run?.method).toBe('POST')
    const list = HELP_ROUTES.find(
      (route) => route.method === 'GET' && route.path === '/task-templates'
    )
    expect(list?.description).toContain('playbook')
  })
})
