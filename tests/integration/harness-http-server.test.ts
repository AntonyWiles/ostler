import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import simpleGit from 'simple-git'
import { EventDatabase } from '../../electron/services/event-database'
import { HarnessService } from '../../electron/services/harness-service'
import { HarnessHttpServer } from '../../electron/services/harness-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import {
  DEFAULT_CONFIG,
  type HarnessSession,
  type WatchedProject
} from '../../src/shared/ostler-api'
import { syncHttpServers } from '../../electron/services/agents-switch'
import { createMigratedDatabase } from '../helpers/database'
import { initProjectRepository, startTaskSession } from '../helpers/harness'
import { resolveProjectConventions } from '../../electron/services/project-conventions'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

describe('harness-http-server.ts', () => {
  const root = useTempDir('ostler-harness-http-')
  let project: WatchedProject
  let database: EventDatabase
  let harnessService: HarnessService
  let server: HarnessHttpServer
  /** A running agent: every call needs a session's own password (§2.3). */
  let agent: HarnessSession

  beforeEach(async () => {
    const projectPath = path.join(root(), 'project')
    await initProjectRepository(projectPath)
    project = makeWatchedProject({
      id: 'http-project',
      name: 'HTTP project',
      path: projectPath,
      addedAt: Date.now()
    })
    database = new EventDatabase(await createMigratedDatabase(root()))
    harnessService = new HarnessService(path.join(root(), 'data'), database)
    agent = await startTaskSession(harnessService, project, 'Agent session', 'Working the queue')
    server = new HarnessHttpServer(
      () => [project],
      harnessService,
      () => {},
      path.join(root(), 'data')
    )
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server.stop()
    harnessService.stopAll()
    database.close()
  })

  function call(method: string, urlPath: string, body?: unknown, token: string = agent.token) {
    return fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })
  }

  /** The agent saves real work in its copy, as a completion needs. */
  async function saveWork(session: HarnessSession): Promise<void> {
    const worktree = simpleGit(session.workspace!.worktreePath)
    fs.writeFileSync(path.join(session.workspace!.worktreePath, 'README.md'), '# Agent work\n')
    await worktree.add('.')
    await worktree.commit('agent change')
  }

  it('stops listening while harness.enabled is false, and listens again when it is on', async () => {
    const config = (enabled: boolean) => ({
      harness: { ...DEFAULT_CONFIG.harness, enabled, port: PORT },
      automationApi: { enabled: false, port: PORT + 1 }
    })
    const automation = { start: () => {}, stop: () => {} }

    syncHttpServers(config(true), config(false), { harness: server, automation })
    await new Promise((resolve) => setTimeout(resolve, 50))
    await expect(call('GET', `/harness/${project.id}/status`)).rejects.toThrow()

    syncHttpServers(config(false), config(true), { harness: server, automation })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await call('GET', `/harness/${project.id}/status`)).status).toBe(200)
  })

  it('rejects requests with a missing or wrong password', async () => {
    const noAuth = await call('GET', `/harness/${project.id}/status`, undefined, '')
    expect(noAuth.status).toBe(401)

    const wrongAuth = await call('GET', `/harness/${project.id}/status`, undefined, 'wrong')
    expect(wrongAuth.status).toBe(401)
  })

  it('rejects an unknown project', async () => {
    const res = await call('GET', `/harness/unknown-project/status`)
    expect(res.status).toBe(404)
  })

  it('rejects all harness access for a disabled project', async () => {
    project.enabled = false

    const res = await call('GET', `/harness/${project.id}/help`)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ ok: false, error: 'Project is disabled' })
  })

  it('accepts bounded voluntary transcript evidence from an active session', async () => {
    const upload = await call('POST', `/harness/${project.id}/session/${agent.id}/transcript`, {
      entries: [
        {
          role: 'user',
          content: 'Please investigate the failing test.',
          timestamp: new Date().toISOString()
        },
        {
          role: 'assistant',
          content: 'I will inspect the test output.',
          timestamp: new Date().toISOString()
        }
      ]
    })
    expect(upload.status).toBe(200)
    await expect(upload.json()).resolves.toMatchObject({ ok: true, value: { accepted: 2 } })
    expect(database.getRecentSessionTranscripts(project.id)[0].entries).toHaveLength(2)
  })

  it('audits every request without recording passwords or request bodies', async () => {
    const response = await call('POST', `/harness/${project.id}/tasks`, {
      title: 'Sensitive task title',
      details: 'Sensitive task details'
    })
    expect(response.status).toBe(200)

    const auditLog = fs.readFileSync(path.join(root(), 'data', 'logs', 'harness-audit.log'), 'utf8')
    expect(auditLog).toContain('"endpoint":"/harness/:project/tasks"')
    expect(auditLog).toContain('"authentication":"valid"')
    expect(auditLog).toContain('"status":200')
    expect(auditLog).not.toContain(agent.token)
    expect(auditLog).not.toContain('Sensitive task title')
    expect(auditLog).not.toContain('Sensitive task details')
  })

  it('serves a self-describing help response, without the removed routes', async () => {
    const res = await call('GET', `/harness/${project.id}/help`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      value: { instructions: string; routes: { method: string; path: string }[] }
    }
    expect(body.ok).toBe(true)
    const paths = body.value.routes.map((route) => route.path)
    expect(paths).toContain('/session/:sessionId/ask')
    expect(paths).toContain('/session/:sessionId/update')
    expect(paths).not.toContain('/session/start')
    expect(paths).not.toContain('/commit-rules')
    expect(paths.some((route) => route.startsWith('/files'))).toBe(false)
    expect(paths).not.toContain('/snapshot')
  })

  it('runs the setup command while preparing the copy, so the agent starts in a ready folder', async () => {
    project.agentSetup = { mode: 'custom', command: 'node -e "setTimeout(()=>{},300)"' }
    const prepared = await startTaskSession(harnessService, project, 'Prepared session')

    const status = await call(
      'GET',
      `/harness/${project.id}/session/${prepared.id}`,
      undefined,
      prepared.token
    )
    const current = (await status.json()) as { value: { workspace: { setup: { status: string } } } }
    expect(current.value.workspace.setup.status).toBe('succeeded')
    const update = await call(
      'POST',
      `/harness/${project.id}/session/${prepared.id}/update`,
      { note: 'Starting' },
      prepared.token
    )
    expect(update.status).toBe(200)
  }, 30_000)

  it('drives a task/question workflow over HTTP', async () => {
    const taskRes = await call('POST', `/harness/${project.id}/tasks`, {
      title: 'Ship the feature',
      details: 'Implement and test',
      priority: 'high'
    })
    const taskBody = (await taskRes.json()) as {
      ok: boolean
      value: { id: string; priority: string }
    }
    expect(taskBody.value.priority).toBe('high')

    const askRes = await call('POST', `/harness/${project.id}/session/${agent.id}/ask`, {
      question: 'Which environment should I deploy to?'
    })
    expect(askRes.status).toBe(200)

    const statusRes = await call('GET', `/harness/${project.id}/status`)
    const statusBody = (await statusRes.json()) as {
      ok: boolean
      value: { state: { activeSessions: { id: string; blocked: boolean }[] } }
    }
    expect(
      statusBody.value.state.activeSessions.find((item) => item.id === agent.id)?.blocked
    ).toBe(true)
  })

  it("refuses one session's password acting on another session", async () => {
    const other = await startTaskSession(harnessService, project, 'Other agent')

    const res = await call('POST', `/harness/${project.id}/session/${other.id}/ask`, {
      question: 'Not mine to ask'
    })
    expect(res.status).toBe(400)
    expect(harnessService.getState(project).questions).toEqual([])
  })

  it('hands a session the project conventions from the one resolver, and nothing when there are none', async () => {
    project.agentConventions = '# House rules\n\nUse tabs.'
    const expected = resolveProjectConventions(project)

    const own = await call('GET', `/harness/${project.id}/session/${agent.id}`)
    expect(
      ((await own.json()) as { value: Record<string, unknown> }).value.projectConventions
    ).toBe(expected)
    const conventions = await call('GET', `/harness/${project.id}/conventions`)
    await expect(conventions.json()).resolves.toEqual({
      ok: true,
      value: { projectConventions: expected }
    })

    project.agentConventions = '   '
    const empty = await call('GET', `/harness/${project.id}/session/${agent.id}`)
    expect((await empty.json()) as { value: Record<string, unknown> }).not.toHaveProperty(
      'value.projectConventions'
    )
    const none = await call('GET', `/harness/${project.id}/conventions`)
    await expect(none.json()).resolves.toEqual({ ok: true, value: { projectConventions: null } })
  })

  it('tells an agent when it retries with a completed session password', async () => {
    harnessService.updateSession(project, agent.id, 'Finished', true)

    const res = await call('POST', `/harness/${project.id}/session/${agent.id}/update`, {
      note: 'Retry',
      done: true
    })

    expect(res.status).toBe(410)
    const body = (await res.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).toContain('already complete')
    expect(body.error).toContain('Stop retrying')
  })

  it('atomically completes a session and its task through the agent HTTP route', async () => {
    await saveWork(agent)
    const res = await call('POST', `/harness/${project.id}/session/${agent.id}/update`, {
      note: 'Finished and verified',
      done: true,
      report: { filesChanged: ['README.md'], summary: 'Rewrote the README.' }
    })

    expect(res.status).toBe(200)
    const state = harnessService.getState(project)
    expect(state.activeSessions).toHaveLength(0)
    expect(state.taskQueue.find((item) => item.claimedBy === agent.id)).toMatchObject({
      status: 'complete'
    })
    expect(state.reviewSessions.map((item) => item.id)).toEqual([agent.id])
  })

  it('hands the next attempt the line comments it was sent back with (N9.2a)', async () => {
    await saveWork(agent)
    await call('POST', `/harness/${project.id}/session/${agent.id}/update`, {
      done: true,
      report: { filesChanged: ['README.md'], summary: 'Rewrote the README.' }
    })
    const taskId = agent.taskId!
    await harnessService.sendBackTaskWork(project, agent.id, 'Close', 'retry', undefined, [
      { file: 'README.md', firstLine: 1, comment: 'Say what the project is' }
    ])

    // The next session for the task reads them with its session.
    const next = await harnessService.startSessionForTask(project, taskId)
    const res = await call(
      'GET',
      `/harness/${project.id}/session/${next.id}`,
      undefined,
      next.token
    )
    const body = (await res.json()) as {
      value: { reviewComments?: { file: string; comment: string; excerpt: string }[] }
    }
    expect(body.value.reviewComments).toEqual([
      expect.objectContaining({
        file: 'README.md',
        side: 'new',
        firstLine: 1,
        lastLine: 1,
        comment: 'Say what the project is',
        excerpt: expect.stringContaining('+# Agent work')
      })
    ])
    const help = (await (
      await call('GET', `/harness/${project.id}/help`, undefined, next.token)
    ).json()) as {
      value: { instructions: string }
    }
    expect(help.value.instructions).toContain('the attempt that was sent back')
  })

  it('keeps an external agent answers to line comments by id (N9.2b)', async () => {
    await saveWork(agent)
    await call('POST', `/harness/${project.id}/session/${agent.id}/update`, {
      done: true,
      report: { filesChanged: ['README.md'], summary: 'Rewrote the README.' }
    })
    const taskId = agent.taskId!
    await harnessService.sendBackTaskWork(project, agent.id, 'Close', 'retry', undefined, [
      { id: 'c1', file: 'README.md', firstLine: 1, comment: 'Say what the project is' }
    ])
    const next = await harnessService.startSessionForTask(project, taskId)
    const sent = (await (
      await call('GET', `/harness/${project.id}/session/${next.id}`, undefined, next.token)
    ).json()) as { value: { reviewComments: { id: string }[] } }
    expect(sent.value.reviewComments.map((entry) => entry.id)).toEqual(['c1'])
    const help = (await (
      await call('GET', `/harness/${project.id}/help`, undefined, next.token)
    ).json()) as { value: { instructions: string } }
    expect(help.value.instructions).toContain('Answer every line comment by its id')

    const copy = next.workspace!.worktreePath
    fs.writeFileSync(path.join(copy, 'README.md'), '# Agent work\n\nA project manager.\n')
    await simpleGit(copy).add('.')
    await simpleGit(copy).commit('say what it is')
    const res = await call(
      'POST',
      `/harness/${project.id}/session/${next.id}/update`,
      {
        done: true,
        report: {
          filesChanged: ['README.md'],
          summary: 'Said what the project is.',
          commentAnswers: [
            { id: 'c1', status: 'done', note: 'Added a line', path: 'README.md', startLine: 3 },
            { id: 'not-there', status: 'not-done', note: 'Old' }
          ]
        }
      },
      next.token
    )
    expect(res.status).toBe(200)
    const report = harnessService
      .getState(project)
      .taskQueue.find((task) => task.id === taskId)?.report
    expect(report?.commentAnswers).toEqual([
      {
        id: 'c1',
        status: 'done',
        note: 'Added a line',
        path: 'README.md',
        startLine: 3,
        endLine: 3
      }
    ])
    expect(report?.commentAnswersIgnored).toEqual(['not-there'])
  })

  it('turns a direct task-complete call into a review, keeping its copy', async () => {
    await saveWork(agent)
    const taskId = harnessService.getState(project).taskQueue[0].id

    const res = await call('POST', `/harness/${project.id}/tasks/${taskId}/complete`, {
      sessionId: agent.id,
      note: 'Finished',
      report: { filesChanged: ['README.md'], summary: 'Rewrote the README heading.' }
    })

    expect(res.status).toBe(200)
    const state = harnessService.getState(project)
    expect(state.taskQueue.find((item) => item.id === taskId)).toMatchObject({
      status: 'complete',
      claimedBy: agent.id,
      report: { filesChanged: ['README.md'], summary: 'Rewrote the README heading.' }
    })
    expect(state.reviewSessions).toMatchObject([{ id: agent.id, status: 'done' }])
    expect(fs.existsSync(state.reviewSessions[0].workspace!.worktreePath)).toBe(true)
  })

  it('keeps the token usage an agent reports with its completion, marked as reported (R5.3)', async () => {
    await saveWork(agent)
    const taskId = harnessService.getState(project).taskQueue[0].id

    const res = await call('POST', `/harness/${project.id}/tasks/${taskId}/complete`, {
      sessionId: agent.id,
      report: {
        filesChanged: ['README.md'],
        summary: 'Done.',
        usage: { inputTokens: 1200, outputTokens: 300, model: 'gpt-5', extra: 'ignored' }
      }
    })

    expect(res.status).toBe(200)
    const state = harnessService.getState(project)
    expect(state.taskQueue.find((item) => item.id === taskId)?.report?.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      model: 'gpt-5'
    })
    const history = await harnessService.getRunHistory(project)
    expect(history.runs).toMatchObject([
      { sessionId: agent.id, inputTokens: 1200, outputTokens: 300, usageReported: true }
    ])
    expect(history.totals.includesReportedUsage).toBe(true)
  })

  it('copies the pictures out of the copy and keeps the walkthrough of a report (N9.1)', async () => {
    await saveWork(agent)
    const copy = agent.workspace!.worktreePath
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    fs.mkdirSync(path.join(copy, '.ostler-pictures'), { recursive: true })
    fs.writeFileSync(path.join(copy, '.ostler-pictures', 'home.png'), png)
    fs.writeFileSync(path.join(copy, 'notes.txt'), 'not a picture')
    const help = (await (await call('GET', `/harness/${project.id}/help`)).json()) as {
      value: { instructions: string }
    }
    expect(help.value.instructions).toContain('Pictures and a walkthrough')
    const taskId = harnessService.getState(project).taskQueue[0].id

    const res = await call('POST', `/harness/${project.id}/session/${agent.id}/update`, {
      done: true,
      completedTaskId: taskId,
      report: {
        filesChanged: ['README.md'],
        summary: 'Rewrote the README heading.',
        pictures: [
          { path: '.ostler-pictures/home.png', caption: 'The new heading' },
          'notes.txt',
          '../x.png'
        ],
        walkthrough: [
          { path: 'README.md', startLine: 1, endLine: 1, note: 'Start here: the heading.' },
          { path: '/etc/passwd', startLine: 1, endLine: 1, note: 'dropped' }
        ]
      }
    })

    expect(res.status).toBe(200)
    const report = harnessService
      .getState(project)
      .taskQueue.find((item) => item.id === taskId)?.report
    expect(report?.pictures).toEqual([
      {
        name: '1-home.png',
        path: '.ostler-pictures/home.png',
        caption: 'The new heading',
        size: png.length
      }
    ])
    expect(report?.picturesLeftOut).toEqual([
      { path: 'notes.txt', reason: 'not-image' },
      { path: '../x.png', reason: 'outside-copy' }
    ])
    expect(report?.walkthrough).toEqual([
      { path: 'README.md', startLine: 1, endLine: 1, note: 'Start here: the heading.' }
    ])
    expect(report).not.toHaveProperty('pictureRequests')
    // The copy goes with Discard; the picture stays until the session's record does.
    await harnessService.discardTaskWork(project, agent.id)
    expect(
      harnessService.readReportPicture(project, agent.id, '1-home.png')?.bytes.equals(png)
    ).toBe(true)
  })

  it('records when a session last connected, keyed off its own password', async () => {
    expect(agent.lastSeenAt).toBeNull()

    await call('GET', `/harness/${project.id}/status`)

    const updated = harnessService
      .getState(project)
      .activeSessions.find((item) => item.id === agent.id)
    expect(updated?.lastSeenAt).toBeTruthy()
  })

  it("works in the agent's own copy, a worktree apart from the person's folder", async () => {
    fs.writeFileSync(path.join(project.path!, 'README.md'), 'original\n')
    const workspace = harnessService
      .getState(project)
      .activeSessions.find((item) => item.id === agent.id)!.workspace
    expect(workspace?.branchName).toMatch(/^ostler\//)

    fs.writeFileSync(path.join(workspace!.worktreePath, 'README.md'), 'edited by agent\n')
    expect(fs.readFileSync(path.join(project.path!, 'README.md'), 'utf8')).toBe('original\n')
  })

  describe('agent-reported blockers', () => {
    let planningService: PlanningService

    beforeEach(async () => {
      planningService = new PlanningService(
        await createMigratedDatabase(root(), 'planning.db'),
        () => [project.id]
      )
      server.stop()
      server = new HarnessHttpServer(
        () => [project],
        harnessService,
        () => {},
        path.join(root(), 'data'),
        planningService
      )
      PORT = await startOnFreePort((port) => server.start(port))
    })

    afterEach(() => planningService.close())

    it("lets an active session report a blocker on its task's linked planning work item", async () => {
      const item = planningService.createWorkItem(
        project.id,
        {
          title: 'Agent-owned work',
          status: 'ready'
        },
        { kind: 'human' }
      )
      const task = harnessService.addTask(
        project,
        item.title,
        'Do the work',
        undefined,
        'medium',
        item.id
      )
      const session = await harnessService.startSessionForTask(project, task.id)

      const res = await call(
        'POST',
        `/harness/${project.id}/tasks/${task.id}/blocker`,
        {
          sessionId: session.id,
          description: 'Waiting on a design decision.',
          resolutionOptions: ['Proceed with option A', 'Cancel']
        },
        session.token
      )
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        ok: boolean
        value: { workItemId: string; reportedBy: string; status: string }
      }
      expect(body.value).toMatchObject({
        workItemId: item.id,
        reportedBy: 'agent',
        status: 'open'
      })

      expect(planningService.isWorkItemEligibleForDispatch(project.id, item.id)).toBe(false)
    })

    it('rejects a blocker report from an inactive session and a task with no linked work item', async () => {
      const task = harnessService.addTask(project, 'Standalone task', 'No planning link')

      const noSession = await call('POST', `/harness/${project.id}/tasks/${task.id}/blocker`, {
        sessionId: 'not-a-real-session',
        description: 'Should be rejected'
      })
      expect(noSession.status).toBe(400)

      const session = await harnessService.startSessionForTask(project, task.id)
      const unlinked = await call(
        'POST',
        `/harness/${project.id}/tasks/${task.id}/blocker`,
        { sessionId: session.id, description: 'This task has no planning work item' },
        session.token
      )
      expect(unlinked.status).toBe(400)
    })
  })

  it('answers folder routes with 409 for a project without a folder, and the rest as usual', async () => {
    project.path = null
    const update = await call('POST', `/harness/${project.id}/session/${agent.id}/update`, {
      note: 'Working'
    })
    expect(update.status).toBe(409)

    expect((await call('GET', `/harness/${project.id}/status`)).status).toBe(200)
    expect((await call('GET', `/harness/${project.id}/tasks`)).status).toBe(200)
    const help = (await (await call('GET', `/harness/${project.id}/help`)).json()) as {
      value: { instructions: string }
    }
    expect(help.value.instructions).toContain('HTTP 409')
  })
})
