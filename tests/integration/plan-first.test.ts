import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { HarnessHttpServer } from '../../electron/services/harness-http-server'
import { AgentEventStream } from '../../electron/services/agent-events'
import type { AgentEvent, HarnessPlan, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { initProjectRepository } from '../helpers/harness'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

/** Plan first (N9.3a), on as N9.3b will ship it: an external agent over the harness API. */
vi.mock('../../src/shared/plan-first', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/shared/plan-first')>()),
  PLAN_FIRST_AVAILABLE: true
}))

let HARNESS_PORT = 0

interface EventPage {
  events: AgentEvent[]
  cursor: number
}

interface SessionRead {
  planFirst?: true
  planFirstNote?: string
  plan?: HarnessPlan | null
}

describe('plan first over the harness API', () => {
  const root = useTempDir('ostler-plan-first-http-')
  let project: WatchedProject
  let database: EventDatabase
  let harnessService: HarnessService
  let events: AgentEventStream
  let server: HarnessHttpServer

  beforeEach(async () => {
    const projectPath = path.join(root(), 'project')
    await initProjectRepository(projectPath)
    project = makeWatchedProject({
      id: 'plan-project',
      name: 'Plan project',
      path: projectPath,
      addedAt: Date.now()
    })
    database = new EventDatabase(await createMigratedDatabase(root()))
    harnessService = new HarnessService(path.join(root(), 'data'), database)
    events = new AgentEventStream()
    harnessService.setAgentEventStream(events)
    server = new HarnessHttpServer(
      () => [project],
      harnessService,
      () => {},
      path.join(root(), 'data'),
      undefined,
      undefined,
      events
    )
    HARNESS_PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server.stop()
    harnessService.stopAll()
    database.close()
  })

  function harness(method: string, urlPath: string, token: string, body?: unknown) {
    return fetch(`http://127.0.0.1:${HARNESS_PORT}/harness/${project.id}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }

  async function value<T>(response: Response): Promise<T> {
    const body = (await response.json()) as { ok: boolean; value: T; error?: string }
    if (!body.ok) throw new Error(`${response.status}: ${body.error}`)
    return body.value
  }

  async function planFirstSession() {
    const task = harnessService.addTask(project, 'Change the greeting', '')
    harnessService.setTaskPlanFirst(project, task.id, true)
    const session = await harnessService.startSessionForTask(project, task.id)
    return { task, session }
  }

  it('tells the agent to plan, takes the plan, and hands back each decision', async () => {
    const { task, session } = await planFirstSession()

    const before = await value<SessionRead>(
      await harness('GET', `/session/${session.id}`, session.token)
    )
    expect(before).toMatchObject({ planFirst: true, plan: null })
    expect(before.planFirstNote).toContain('POST /session/:sessionId/plan')

    // The claim says so too.
    await value(
      await harness('POST', `/tasks/${task.id}/release`, session.token, { sessionId: session.id })
    )
    const claim = await value<SessionRead>(
      await harness('POST', `/tasks/${task.id}/claim`, session.token, { sessionId: session.id })
    )
    expect(claim.planFirst).toBe(true)

    const cursor = events.cursor
    const submitted = await value<{ plan: HarnessPlan }>(
      await harness('POST', `/session/${session.id}/plan`, session.token, {
        steps: ['Change the greeting'],
        files: ['src/app.ts'],
        risks: 'None'
      })
    )
    expect(submitted.plan).toMatchObject({ version: 1, status: 'pending' })

    const tooMany = await harness('POST', `/session/${session.id}/plan`, session.token, {
      steps: Array.from({ length: 31 }, (_, i) => `Step ${i}`)
    })
    expect(tooMany.status).toBe(400)

    harnessService.requestPlanChanges(project, session.id, 'Also update the docs')
    const changes = await value<{ plan: HarnessPlan }>(
      await harness('GET', `/session/${session.id}`, session.token)
    )
    expect(changes.plan).toMatchObject({
      status: 'changes-requested',
      changesNote: 'Also update the docs'
    })

    await value(
      await harness('POST', `/session/${session.id}/plan`, session.token, {
        steps: ['Change the greeting', 'Update the docs'],
        files: ['src/app.ts', 'README.md'],
        risks: 'None'
      })
    )
    await harnessService.approvePlan(project, session.id)
    expect(
      (await value<SessionRead>(await harness('GET', `/session/${session.id}`, session.token))).plan
    ).toMatchObject({ version: 2, status: 'approved' })

    const page = await value<EventPage>(
      await harness('GET', `/events?since=${cursor}`, session.token)
    )
    const types = page.events.map((event) => event.type)
    expect(types.filter((type) => type === 'plan.submitted')).toHaveLength(2)
    expect(types.filter((type) => type === 'plan.decided')).toHaveLength(2)
    expect(
      page.events.every(
        (event) => !event.type.startsWith('plan.') || event.sessionId === session.id
      )
    ).toBe(true)
  })

  it('a waiting agent hears the decision on GET /events', async () => {
    const { session } = await planFirstSession()
    await value(
      await harness('POST', `/session/${session.id}/plan`, session.token, {
        steps: ['Change the greeting'],
        files: [],
        risks: ''
      })
    )
    const waiting = harness('GET', `/events?since=${events.cursor}&wait=10`, session.token)
    await new Promise((resolve) => setTimeout(resolve, 50))
    await harnessService.approvePlan(project, session.id)
    const page = await value<EventPage>(await waiting)
    expect(page.events.map((event) => event.type)).toContain('plan.decided')
  })

  it('refuses a plan from a session whose task did not ask for one', async () => {
    const task = harnessService.addTask(project, 'Plain', '')
    const session = await harnessService.startSessionForTask(project, task.id)
    const refused = await harness('POST', `/session/${session.id}/plan`, session.token, {
      steps: ['Do it']
    })
    expect(refused.status).toBe(400)
    const read = await value<SessionRead>(
      await harness('GET', `/session/${session.id}`, session.token)
    )
    expect(read.planFirst).toBeUndefined()
  })
})
