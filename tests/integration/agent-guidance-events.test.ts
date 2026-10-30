import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as path from 'path'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { HarnessHttpServer } from '../../electron/services/harness-http-server'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { AgentEventStream, MAX_CONCURRENT_EVENT_WAITS } from '../../electron/services/agent-events'
import { RunGuidanceService } from '../../electron/services/run-guidance'
import type { AgentEvent, HarnessGuidance, WatchedProject } from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { initProjectRepository, startTaskSession } from '../helpers/harness'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let HARNESS_PORT = 0
let AUTOMATION_PORT = 0

interface EventPage {
  events: AgentEvent[]
  cursor: number
  resync?: true
}

/** Guidance from the person (D41) and GET /events on both APIs. */
describe('guidance and agent events over HTTP', () => {
  const root = useTempDir('ostler-guidance-events-')
  let project: WatchedProject
  let database: EventDatabase
  let harnessService: HarnessService
  let events: AgentEventStream
  let guidance: RunGuidanceService
  let harnessServer: HarnessHttpServer
  let automationServer: AutomationHttpServer

  beforeEach(async () => {
    const projectPath = path.join(root(), 'project')
    await initProjectRepository(projectPath)
    project = makeWatchedProject({
      id: 'guidance-project',
      name: 'Guidance project',
      path: projectPath,
      addedAt: Date.now(),
      automationToken: 'automation-token'
    })
    database = new EventDatabase(await createMigratedDatabase(root()))
    harnessService = new HarnessService(path.join(root(), 'data'), database)
    events = new AgentEventStream()
    harnessService.setAgentEventStream(events)
    guidance = new RunGuidanceService(
      harnessService,
      { isRunning: () => false, deliverGuidance: async () => {} },
      () => 'Sam'
    )
    harnessServer = new HarnessHttpServer(
      () => [project],
      harnessService,
      () => {},
      path.join(root(), 'data'),
      undefined,
      undefined,
      events
    )
    automationServer = new AutomationHttpServer(
      () => [project],
      path.join(root(), 'data'),
      undefined,
      undefined,
      harnessService,
      // Every other dependency this server takes, unused here.
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
      undefined,
      {
        events,
        sendGuidance: (target, sessionId, text) =>
          guidance.send(target, sessionId, text, 'automation')
      }
    )
    HARNESS_PORT = await startOnFreePort((port) => harnessServer.start(port))
    AUTOMATION_PORT = await startOnFreePort((port) => automationServer.start(port))
  })

  afterEach(() => {
    harnessServer.stop()
    automationServer.stop()
    database.close()
  })

  function harness(method: string, urlPath: string, token: string, body?: unknown) {
    return fetch(`http://127.0.0.1:${HARNESS_PORT}/harness/${project.id}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }

  function automation(method: string, urlPath: string, body?: unknown) {
    return fetch(`http://127.0.0.1:${AUTOMATION_PORT}/automation/${project.id}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${project.automationToken}`
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }

  async function value<T>(response: Response): Promise<T> {
    const body = (await response.json()) as { ok: boolean; value: T; error?: string }
    if (!body.ok) throw new Error(`${response.status}: ${body.error}`)
    return body.value
  }

  describe('guidance to an external run', () => {
    it('appears on its next session read exactly once, labelled as from the person, and is marked delivered', async () => {
      const session = await startTaskSession(harnessService, project, 'External agent')

      const sent = await value<HarnessGuidance>(
        await automation('POST', `/sessions/${session.id}/guidance`, {
          text: 'The **old** parser tests can stay as they are.'
        })
      )
      expect(sent).toMatchObject({ from: 'Sam', via: 'automation', deliveredAt: null })

      const first = await value<{ guidance: Array<{ id: string; from: string; text: string }> }>(
        await harness('GET', `/session/${session.id}`, session.token)
      )
      expect(first.guidance).toEqual([
        expect.objectContaining({
          id: sent.id,
          from: 'Sam',
          text: 'The **old** parser tests can stay as they are.'
        })
      ])

      const second = await value<{ guidance: unknown[] }>(
        await harness('GET', `/session/${session.id}`, session.token)
      )
      expect(second.guidance).toEqual([])

      const listed = await value<HarnessGuidance[]>(
        await automation('GET', `/sessions/${session.id}/guidance`)
      )
      expect(listed).toHaveLength(1)
      expect(listed[0].deliveredAt).not.toBeNull()
    })

    it("does not let a session token read another session's guidance", async () => {
      const mine = await startTaskSession(harnessService, project, 'Mine')
      const theirs = await startTaskSession(harnessService, project, 'Theirs')
      await guidance.send(project, theirs.id, 'For the other agent only.', 'app')

      const refused = await harness('GET', `/session/${theirs.id}`, mine.token)
      expect(refused.status).toBe(400)

      const own = await value<{ guidance: unknown[] }>(
        await harness('GET', `/session/${mine.id}`, mine.token)
      )
      expect(own.guidance).toEqual([])
      // Still waiting for the agent it was sent to.
      expect(harnessService.getState(project).guidance?.[0].deliveredAt).toBeNull()

      // The other session's guidance events are not in this token's stream either.
      const page = await value<EventPage>(
        await harness('GET', `/events?since=${events.cursor - 10}`, mine.token)
      )
      expect(page.events.some((event) => event.type.startsWith('guidance.'))).toBe(false)
    })

    it('refuses guidance to a run that is not running, an empty message, and one over the caps', async () => {
      const session = await startTaskSession(harnessService, project, 'Agent')

      const empty = await automation('POST', `/sessions/${session.id}/guidance`, { text: '  ' })
      expect(empty.status).toBe(400)
      const tooLong = await automation('POST', `/sessions/${session.id}/guidance`, {
        text: 'x'.repeat(4001)
      })
      expect(tooLong.status).toBe(413)

      for (let index = 0; index < 5; index += 1) {
        await value(
          await automation('POST', `/sessions/${session.id}/guidance`, { text: `Note ${index}` })
        )
      }
      const tooMany = await automation('POST', `/sessions/${session.id}/guidance`, {
        text: 'One more'
      })
      expect(tooMany.status).toBe(429)

      await harnessService.stopSession(project, session.id)
      const ended = await automation('POST', `/sessions/${session.id}/guidance`, {
        text: 'Too late'
      })
      expect(ended.status).toBe(409)
      await expect(ended.json()).resolves.toMatchObject({ ok: false, error: expect.any(String) })
    })
  })

  describe('GET /events', () => {
    it('returns at once when there are events after the cursor', async () => {
      const session = await startTaskSession(harnessService, project, 'Agent')
      const start = await value<EventPage>(await automation('GET', '/events'))
      await guidance.send(project, session.id, 'Use the new parser.', 'app')

      const began = Date.now()
      const page = await value<EventPage>(
        await automation('GET', `/events?since=${start.cursor}&wait=30`)
      )
      expect(Date.now() - began).toBeLessThan(2000)
      expect(page.events.map((event) => event.type)).toEqual(['guidance.sent'])
      expect(page.events[0]).toMatchObject({ sessionId: session.id, text: 'Use the new parser.' })
      expect(page.cursor).toBe(page.events[0].cursor)
    })

    it('waits for the next event, and returns empty when none comes', async () => {
      const start = await value<EventPage>(await automation('GET', '/events'))

      const began = Date.now()
      const empty = await value<EventPage>(
        await automation('GET', `/events?since=${start.cursor}&wait=1`)
      )
      expect(Date.now() - began).toBeGreaterThanOrEqual(900)
      expect(empty).toEqual({ events: [], cursor: start.cursor })

      const waiting = automation('GET', `/events?since=${start.cursor}&wait=30`)
      await new Promise((resolve) => setTimeout(resolve, 100))
      const task = harnessService.addTask(project, 'Write the parser', '')
      const page = await value<EventPage>(await waiting)
      expect(page.events).toEqual([
        expect.objectContaining({ type: 'task.queued', taskId: task.id })
      ])
    })

    it('scopes a session password to its own session and the queue', async () => {
      const mine = await startTaskSession(harnessService, project, 'Mine')
      const theirs = await startTaskSession(harnessService, project, 'Theirs')
      const start = events.cursor
      await guidance.send(project, mine.id, 'For me.', 'app')
      await guidance.send(project, theirs.id, 'For them.', 'app')
      harnessService.addTask(project, 'Queued work', '')

      const own = await value<EventPage>(await harness('GET', `/events?since=${start}`, mine.token))
      expect(own.events.map((event) => [event.type, event.sessionId])).toEqual([
        ['guidance.sent', mine.id],
        ['task.queued', undefined]
      ])
      const all = await value<EventPage>(await automation('GET', `/events?since=${start}`))
      expect(all.events.map((event) => event.type)).toEqual([
        'guidance.sent',
        'guidance.sent',
        'task.queued'
      ])
    })

    it('answers resync for a cursor older than the buffer or from before a restart', async () => {
      const page = await value<EventPage>(await automation('GET', '/events?since=1'))
      expect(page).toMatchObject({ events: [], resync: true, cursor: events.cursor })

      const session = await startTaskSession(harnessService, project, 'Agent')
      const future = await value<EventPage>(
        await harness('GET', `/events?since=${events.cursor + 100}`, session.token)
      )
      expect(future.resync).toBe(true)

      const bad = await automation('GET', '/events?wait=61')
      expect(bad.status).toBe(400)
    })

    it('refuses a wait past the concurrent cap on one token', async () => {
      const session = await startTaskSession(harnessService, project, 'Agent')
      const waits = Array.from({ length: MAX_CONCURRENT_EVENT_WAITS }, () =>
        automation('GET', '/events?wait=30')
      )
      await new Promise((resolve) => setTimeout(resolve, 150))

      const refused = await automation('GET', '/events?wait=30')
      expect(refused.status).toBe(429)

      // Another token has its own allowance.
      const other = harness('GET', '/events?wait=30', session.token)
      await new Promise((resolve) => setTimeout(resolve, 150))

      harnessService.addTask(project, 'Wake everyone', '')
      const answered = await Promise.all(waits)
      expect(answered.every((response) => response.status === 200)).toBe(true)
      expect((await other).status).toBe(200)
    })

    it('ends its waits when the server stops', async () => {
      const session = await startTaskSession(harnessService, project, 'Agent')
      const automationWait = automation('GET', '/events?wait=60')
      const harnessWait = harness('GET', '/events?wait=60', session.token)
      await new Promise((resolve) => setTimeout(resolve, 150))

      const began = Date.now()
      automationServer.stop()
      harnessServer.stop()
      const [fromAutomation, fromHarness] = await Promise.all([automationWait, harnessWait])
      expect(Date.now() - began).toBeLessThan(2000)
      expect(await value<EventPage>(fromAutomation)).toMatchObject({ events: [] })
      expect(await value<EventPage>(fromHarness)).toMatchObject({ events: [] })
    })
  })
})
