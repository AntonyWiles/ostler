import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventDatabase } from '../../../electron/services/event-database'
import { AutomationHttpServer } from '../../../electron/services/automation-http-server'
import { HarnessService } from '../../../electron/services/harness-service'
import { PlanningService } from '../../../electron/services/planning-service'
import { runWorkItemHousekeeping } from '../../../electron/services/work-item-housekeeping'
import {
  DEFAULT_CONFIG,
  type OstlerConfig,
  type WatchedProject
} from '../../../src/shared/ostler-api'
import { json, useAutomationServer } from '../../helpers/automation-fixture'
import { createMigratedDatabase } from '../../helpers/database'
import { initProjectRepository, startTaskSession } from '../../helpers/harness'
import { makeWatchedProject } from '../../helpers/projects'
import { useTempDir } from '../../helpers/temp-dir'

// Choosing a run's model asks the provider which efforts the model takes, as
// Settings does. Here the provider says: low and high, never anything else.
vi.mock('../../../electron/services/ai-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../electron/services/ai-access')>()),
  aiModelEffortSupport: async () => ({ model: '', levels: ['low', 'high'], source: 'listing' })
}))

describe('automation-http-server.ts task queue routes', () => {
  const temp = useTempDir('ostler-automation-queue-http-')
  const http = useAutomationServer()
  let root: string
  let project: WatchedProject
  let database: EventDatabase
  let harness: HarnessService
  let planning: PlanningService
  let server: AutomationHttpServer
  const embeddedStarts: string[] = []
  const stoppedSessions: { sessionId: string; note?: string }[] = []

  beforeEach(async () => {
    embeddedStarts.length = 0
    stoppedSessions.length = 0
    root = temp()
    project = makeWatchedProject({
      id: 'automation-queue-project',
      name: 'Automation queue project',
      path: path.join(root, 'project'),
      addedAt: Date.now(),
      automationToken: 'automation-token'
    })
    await initProjectRepository(project.path!)
    database = new EventDatabase(await createMigratedDatabase(root))
    harness = new HarnessService(path.join(root, 'harness'), database)
    planning = new PlanningService(await createMigratedDatabase(root, 'planning.db'), () => [
      project.id
    ])
    server = new AutomationHttpServer(
      () => [project],
      path.join(root, 'runtime'),
      undefined,
      planning,
      harness,
      undefined,
      undefined,
      async (_project, taskId) => {
        embeddedStarts.push(taskId)
        return { id: 'embedded-session', taskId, provenance: 'embedded' }
      },
      async (_project, sessionId) => [
        {
          role: 'assistant',
          content: `live transcript for ${sessionId}`,
          timestamp: new Date().toISOString()
        }
      ],
      async (answerProject, questionId, answer) =>
        harness.answerQuestion(answerProject, questionId, answer),
      async (_project, sessionId, note) => {
        stoppedSessions.push({ sessionId, note })
      }
    )
    await http.start(server, planning, database)
  })

  it('lists sessions and reads a running session transcript', async () => {
    const session = await startTaskSession(harness, project, 'Embedded agent')

    const listed = await call('GET', `/automation/${project.id}/sessions`)
    expect(listed.status).toBe(200)
    const value = (await json<{ value: { active: { id: string }[]; review: unknown[] } }>(listed))
      .value
    expect(value.active.map((entry) => entry.id)).toContain(session.id)

    const transcript = await call(
      'GET',
      `/automation/${project.id}/sessions/${session.id}/transcript`
    )
    expect(transcript.status).toBe(200)
    expect((await json<{ value: { content: string }[] }>(transcript)).value[0].content).toContain(
      session.id
    )
  })

  it("returns a session's report with its walkthrough and pictures, and each picture (N9.1)", async () => {
    const session = await startTaskSession(harness, project, 'Pictured agent')
    const copy = session.workspace!.worktreePath
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7])
    fs.writeFileSync(path.join(copy, 'shot.png'), png)
    const taskId = harness.getState(project).taskQueue.find((t) => t.claimedBy === session.id)!.id
    await harness.completeSessionWithAutoContinuation(project, session.id, 'Done', taskId, {
      summary: 'Done.',
      filesChanged: [],
      submittedAt: new Date().toISOString(),
      pictureRequests: [{ path: 'shot.png', caption: 'After' }],
      walkthrough: [{ path: 'a.ts', startLine: 1, endLine: 2, note: 'Start here.' }]
    })

    const listed = await call('GET', `/automation/${project.id}/sessions`)
    const value = (
      await json<{
        value: { review: { id: string; report: { pictures: unknown; walkthrough: unknown } }[] }
      }>(listed)
    ).value
    const reviewed = value.review.find((entry) => entry.id === session.id)!
    expect(reviewed.report.pictures).toEqual([
      { name: '1-shot.png', path: 'shot.png', caption: 'After', size: png.length }
    ])
    expect(reviewed.report.walkthrough).toEqual([
      { path: 'a.ts', startLine: 1, endLine: 2, note: 'Start here.' }
    ])

    const picture = await call(
      'GET',
      `/automation/${project.id}/sessions/${session.id}/pictures/1-shot.png`
    )
    expect(picture.status).toBe(200)
    expect(picture.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await picture.arrayBuffer()).equals(png)).toBe(true)

    const missing = await call(
      'GET',
      `/automation/${project.id}/sessions/${session.id}/pictures/..%2Fstate.json`
    )
    expect(missing.status).toBe(404)
  })

  it('lists pending agent questions and answers one, unblocking the agent', async () => {
    const session = await startTaskSession(harness, project, 'Asking agent')
    const asked = harness.askQuestion(project, session.id, 'Which migration should I use?')

    const pending = await call('GET', `/automation/${project.id}/questions?status=pending`)
    expect(pending.status).toBe(200)
    expect((await json<{ value: { id: string }[] }>(pending)).value.map((q) => q.id)).toEqual([
      asked.id
    ])

    const answered = await call('POST', `/automation/${project.id}/questions/${asked.id}/answer`, {
      answer: 'Use the existing migration.'
    })
    expect(answered.status).toBe(200)
    const question = (await json<{ value: { status: string; answer: string } }>(answered)).value
    expect(question.status).toBe('answered')
    expect(question.answer).toBe('Use the existing migration.')
    expect(
      (
        await json<{ value: unknown[] }>(
          await call('GET', `/automation/${project.id}/questions?status=pending`)
        )
      ).value
    ).toEqual([])
  })

  it('rejects an empty answer instead of unblocking the agent with nothing', async () => {
    const session = await startTaskSession(harness, project, 'Asking agent')
    const asked = harness.askQuestion(project, session.id, 'Proceed?')

    const response = await call('POST', `/automation/${project.id}/questions/${asked.id}/answer`, {
      answer: '   '
    })

    // A blank answer is a bad request, not a server fault: the route catch
    // maps every thrown validation error to 400.
    expect(response.status).toBe(400)
    expect(harness.getState(project).questions[0].status).toBe('pending')
  })

  it('stops a running agent through the runner callback and puts its task back', async () => {
    const session = await startTaskSession(harness, project, 'Superseded task')
    const response = await call('POST', `/automation/${project.id}/sessions/${session.id}/stop`, {
      note: 'Superseded by a newer task.'
    })

    expect(response.status).toBe(200)
    expect(stoppedSessions).toEqual([
      { sessionId: session.id, note: 'Superseded by a newer task.' }
    ])
    const state = harness.getState(project)
    expect(state.activeSessions).toEqual([])
    expect(state.taskQueue[0]).toMatchObject({ status: 'pending', claimedBy: null })
  })

  it('starts a queued task through the embedded runner callback', async () => {
    const added = await call('POST', `/automation/${project.id}/tasks`, {
      title: 'Embedded smoke test'
    })
    const task = (await json<{ value: { id: string } }>(added)).value

    const started = await call('POST', `/automation/${project.id}/tasks/${task.id}/start-embedded`)

    expect(started.status).toBe(200)
    expect((await json<{ value: { provenance: string } }>(started)).value.provenance).toBe(
      'embedded'
    )
    expect(embeddedStarts).toEqual([task.id])
  })

  it("queues with the run's model and effort, checked as the app checks them (D42)", async () => {
    const config: OstlerConfig = {
      ...DEFAULT_CONFIG,
      ai: { ...DEFAULT_CONFIG.ai, provider: 'anthropic', model: 'claude-sonnet-5-5' }
    }
    server.getConfig = () => config
    const tasks = `/automation/${project.id}/tasks`

    const added = await call('POST', tasks, {
      title: 'Rename a file',
      model: 'claude-haiku-5-5',
      effort: 'low'
    })
    expect(added.status).toBe(200)
    const task = (await json<{ value: { id: string; model: string; effort: string } }>(added)).value
    expect(task).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low' })
    const listed = (
      await json<{ value: { id: string; model?: string }[] }>(await call('GET', tasks))
    ).value
    expect(listed.find((entry) => entry.id === task.id)).toMatchObject({
      model: 'claude-haiku-5-5',
      effort: 'low'
    })

    // Refused before anything is created: no work item is left behind.
    const before = planning.listWorkItems(project.id).length
    const wrongModel = await call('POST', tasks, { title: 'Hard work', model: 'gpt-5' })
    expect(wrongModel.status).toBe(400)
    expect((await json<{ error: string }>(wrongModel)).error).toBe(
      '"gpt-5" is not a model Settings offers for anthropic.'
    )
    const wrongEffort = await call('POST', tasks, {
      title: 'Hard work',
      model: 'claude-opus-5-5',
      effort: 'max'
    })
    expect(wrongEffort.status).toBe(400)
    expect((await json<{ error: string }>(wrongEffort)).error).toBe(
      'claude-opus-5-5 does not take the effort "max".'
    )
    expect(planning.listWorkItems(project.id)).toHaveLength(before)

    // Changed while it waits, back to the default.
    const changed = await call('PATCH', `${tasks}/${task.id}/model`, { model: '', effort: '' })
    expect(changed.status).toBe(200)
    const cleared = (await json<{ value: { model?: string; effort?: string } }>(changed)).value
    expect(cleared.model).toBeUndefined()
    expect(cleared.effort).toBeUndefined()

    // Not once an agent has taken it.
    const session = await harness.startSessionForTask(project, task.id)
    const late = await call('PATCH', `${tasks}/${task.id}/model`, { model: 'claude-opus-5-5' })
    expect(late.status).toBe(400)
    expect((await json<{ error: string }>(late)).error).toMatch(/already started/)

    // "Run again with…" names a model only when the task goes back to the queue.
    const held = await call('POST', `/automation/${project.id}/sessions/${session.id}/send-back`, {
      reason: 'Too slow',
      disposition: 'hold',
      model: 'claude-opus-5-5'
    })
    expect(held.status).toBe(400)

    const help = (
      await json<{ value: { routes: { method: string; path: string }[] } }>(
        await call('GET', `/automation/${project.id}/help?full=1`)
      )
    ).value.routes
    expect(help).toContainEqual(
      expect.objectContaining({ method: 'PATCH', path: '/tasks/:taskId/model' })
    )
  })

  function call(method: string, urlPath: string, body?: unknown, token = project.automationToken) {
    return http.request(method, urlPath, { body, token })
  }

  describe('run history and token limits (R5.3)', () => {
    function record(sessionId: string, overrides: Record<string, unknown> = {}) {
      const startedAt = Date.now() - 60_000
      database.agentRuns!.upsert({
        sessionId,
        projectId: project.id,
        taskId: null,
        title: `Run ${sessionId}`,
        provenance: 'embedded',
        model: 'gpt-5',
        effort: null,
        startedAt,
        endedAt: startedAt + 30_000,
        outcome: 'accepted',
        endedAs: 'in_review',
        detail: '',
        stalls: 0,
        nudges: 0,
        guidance: 0,
        commits: 1,
        filesChanged: 2,
        inputTokens: 1000,
        outputTokens: 500,
        usageReported: false,
        ...overrides
      })
    }

    it('reads the run history as JSON, filtered, and as CSV', async () => {
      record('a')
      record('b', { outcome: 'failed', endedAs: 'failed', model: 'claude-sonnet-5-5' })

      const all = await json<{
        ok: boolean
        value: { runs: { sessionId: string }[]; totals: { runs: number; successRate: number } }
      }>(await call('GET', `/automation/${project.id}/agent-runs`))
      expect(all.ok).toBe(true)
      expect(all.value.runs.map((run) => run.sessionId).sort()).toEqual(['a', 'b'])
      expect(all.value.totals).toMatchObject({ runs: 2, successRate: 0.5 })

      const failed = await json<{ value: { runs: { sessionId: string }[] } }>(
        await call('GET', `/automation/${project.id}/agent-runs?outcome=failed`)
      )
      expect(failed.value.runs.map((run) => run.sessionId)).toEqual(['b'])

      const csv = await call('GET', `/automation/${project.id}/agent-runs?format=csv`)
      expect(csv.status).toBe(200)
      expect(csv.headers.get('content-type')).toContain('text/csv')
      const text = await csv.text()
      expect(text).toContain('Run a')
      expect(text).toContain('Run b')
    })

    it('reads token usage against the limits, and never changes the limits', async () => {
      project.agentLimits = { tokensPerDay: 1000, tokensPerMonth: null }
      record('a')

      const usage = await json<{
        value: {
          limits: { tokensPerDay: number | null }
          day: { used: number; reached: boolean }
        }
      }>(await call('GET', `/automation/${project.id}/agent-usage`))
      expect(usage.value.limits).toEqual({ tokensPerDay: 1000, tokensPerMonth: null })
      expect(usage.value.day).toMatchObject({ used: 1500, reached: true })

      for (const method of ['PATCH', 'PUT', 'POST', 'DELETE']) {
        const refused = await call(method, `/automation/${project.id}/agent-usage`, {
          limits: { tokensPerDay: null }
        })
        expect(refused.status).toBe(405)
      }
      expect(project.agentLimits).toEqual({ tokensPerDay: 1000, tokensPerMonth: null })
    })
  })

  it('adds standalone tasks, lists the queue, reorders it, and changes priority', async () => {
    const added = await Promise.all(
      [
        { title: 'First task', description: 'first', priority: 'low' },
        { title: 'Second task', details: 'second', priority: 'medium' },
        { title: 'Third task', description: 'third', priority: 'high' }
      ].map((body) => call('POST', `/automation/${project.id}/tasks`, body))
    )
    expect(added.every((response) => response.status === 200)).toBe(true)
    const tasks = await Promise.all(
      added.map(async (response) => (await json<{ value: { id: string } }>(response)).value)
    )

    const listed = await call('GET', `/automation/${project.id}/tasks`)
    expect(listed.status).toBe(200)
    expect(
      (await json<{ value: Array<{ id: string }> }>(listed)).value.map((task) => task.id)
    ).toEqual(tasks.map((task) => task.id))

    const reordered = await call('POST', `/automation/${project.id}/tasks/reorder`, {
      taskIds: [tasks[2].id, tasks[0].id, tasks[1].id]
    })
    expect(reordered.status).toBe(200)
    expect(
      (await json<{ value: Array<{ id: string }> }>(reordered)).value.map((task) => task.id)
    ).toEqual([tasks[2].id, tasks[0].id, tasks[1].id])

    const priority = await call(
      'PATCH',
      `/automation/${project.id}/tasks/${tasks[0].id}/priority`,
      { priority: 'critical' }
    )
    expect(priority.status).toBe(200)
    expect((await json<{ value: { priority: string } }>(priority)).value.priority).toBe('critical')

    const auditPath = path.join(root, 'runtime', 'logs', 'automation-audit.log')
    const entries = fs
      .readFileSync(auditPath, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as { origin: string; route: string })
    expect(entries).toHaveLength(5)
    expect(entries.every((entry) => entry.origin === 'automation-api')).toBe(true)
  })

  it('moves work items through the recycle bin and archive', async () => {
    const base = `/automation/${project.id}/work-items`
    const ids = async (scope?: string) => {
      const response = await call('GET', scope ? `${base}?scope=${scope}` : base)
      return (await json<{ value: Array<{ id: string }> }>(response)).value.map((item) => item.id)
    }
    const item = planning.createWorkItem(
      project.id,
      { title: 'Recyclable', status: 'done' },
      { kind: 'human' }
    )

    // Permanent delete is only for items already in the bin.
    expect((await call('DELETE', `${base}/${item.id}?permanent=true`)).status).toBe(400)

    expect((await call('DELETE', `${base}/${item.id}`)).status).toBe(200)
    expect(await ids()).not.toContain(item.id)
    expect(await ids('deleted')).toContain(item.id)

    expect((await call('POST', `${base}/${item.id}/restore`)).status).toBe(200)
    expect(await ids()).toContain(item.id)

    expect((await call('POST', `${base}/${item.id}/archive`)).status).toBe(200)
    expect(await ids()).not.toContain(item.id)
    expect(await ids('archived')).toContain(item.id)
    expect((await call('POST', `${base}/${item.id}/unarchive`)).status).toBe(200)
    expect(await ids()).toContain(item.id)

    await call('DELETE', `${base}/${item.id}`)
    expect((await call('DELETE', `${base}/${item.id}?permanent=true`)).status).toBe(200)
    expect([...(await ids()), ...(await ids('deleted')), ...(await ids('archived'))]).not.toContain(
      item.id
    )
  })

  it('says a task is in the recycle bin and refuses work on it, leaving its dependants editable', async () => {
    const base = `/automation/${project.id}/work-items`
    const human = { kind: 'human' } as const
    const binned = planning.createWorkItem(project.id, { title: 'Binned', status: 'ready' }, human)
    const dependant = planning.createWorkItem(
      project.id,
      { title: 'Waits', dependencyIds: [binned.id] },
      human
    )
    expect((await call('DELETE', `${base}/${binned.id}`)).status).toBe(200)

    const read = await json<{ value: { inRecycleBin: boolean; archived: boolean } }>(
      await call('GET', `${base}/${binned.id}`)
    )
    expect(read.value).toMatchObject({ inRecycleBin: true, archived: false })

    const patched = await call('PATCH', `${base}/${binned.id}`, { status: 'done' })
    expect(patched.status).toBe(409)
    expect((await json<{ error: string }>(patched)).error).toMatch(/recycle bin/)
    expect((await call('POST', `${base}/${binned.id}/comments`, { body: 'Done' })).status).toBe(409)
    const batch = await call('PATCH', `${base}/batch`, {
      items: [{ id: binned.id, status: 'done' }]
    })
    expect(batch.status).toBe(400)
    expect(planning.getWorkItem(binned.id).status).toBe('ready')

    expect((await call('PATCH', `${base}/${dependant.id}`, { title: 'Still waits' })).status).toBe(
      200
    )
    expect((await call('POST', `${base}/${binned.id}/restore`)).status).toBe(200)
    expect((await call('PATCH', `${base}/${binned.id}`, { status: 'done' })).status).toBe(200)
  })

  it('refuses to archive or bin work an agent still has queued', async () => {
    const item = planning.createWorkItem(
      project.id,
      { title: 'In flight', status: 'ready' },
      { kind: 'human' }
    )
    await call('POST', `/automation/${project.id}/tasks`, { workItemId: item.id })
    const archive = await call('POST', `/automation/${project.id}/work-items/${item.id}/archive`)
    expect(archive.status).toBe(400)
    expect((await json<{ error: string }>(archive)).error).toMatch(/cannot be archived/)
    expect((await call('DELETE', `/automation/${project.id}/work-items/${item.id}`)).status).toBe(
      400
    )
  })

  it('creates, updates and filters tasks by showFrom and someday (N1.1a)', async () => {
    const base = `/automation/${project.id}/work-items`
    const created = await call('POST', base, { title: 'Renew', showFrom: '2999-03-01' })
    expect(created.status).toBe(200)
    const renew = (
      await json<{ value: { id: string; showFrom: string; someday: boolean } }>(created)
    ).value
    expect(renew).toMatchObject({ showFrom: '2999-03-01', someday: false })

    const idea = (
      await json<{ value: { id: string } }>(await call('POST', base, { title: 'Cello' }))
    ).value
    const parked = await call('PATCH', `${base}/${idea.id}`, { someday: true })
    expect((await json<{ value: { someday: boolean } }>(parked)).value.someday).toBe(true)
    expect((await call('PATCH', `${base}/${idea.id}`, { someday: 'yes' })).status).toBe(400)
    const shown = (
      await json<{ value: { id: string } }>(await call('POST', base, { title: 'Now' }))
    ).value

    const list = async (conditions: unknown[]) =>
      (
        await json<{ value: Array<{ id: string }> }>(
          await call('GET', `${base}?filter=${encodeURIComponent(JSON.stringify({ conditions }))}`)
        )
      ).value
        .map((entry) => entry.id)
        .filter((id) => [renew.id, idea.id, shown.id].includes(id))
        .sort()
    expect(await list([{ field: 'showFrom', op: 'is', value: 'hidden' }])).toEqual(
      [renew.id, idea.id].sort()
    )
    expect(await list([{ field: 'showFrom', op: 'is', value: 'shown' }])).toEqual([shown.id])
    expect(await list([{ field: 'someday', op: 'is', value: true }])).toEqual([idea.id])
    expect(await list([{ field: 'showFrom', op: 'after', value: '2999-01-01' }])).toEqual([
      renew.id
    ])
  })

  it('closes a task as won’t do, refuses what it must, and reopens it (N1.2)', async () => {
    const base = `/automation/${project.id}/work-items`
    const item = planning.createWorkItem(
      project.id,
      { title: 'Maybe never', status: 'active' },
      { kind: 'human' }
    )
    const child = planning.createWorkItem(
      project.id,
      { title: 'Its part', parentWorkItemId: item.id },
      { kind: 'human' }
    )

    const closed = await call('POST', `${base}/${item.id}/wont-do`, {
      reason: 'Out of scope',
      includeSubtasks: true
    })
    expect(closed.status).toBe(200)
    const value = (
      await json<{
        value: {
          workItem: { status: string; resolution: string; resolutionReason: string }
          closedIds: string[]
          cancelledTask: boolean
        }
      }>(closed)
    ).value
    expect(value.workItem).toMatchObject({
      status: 'active',
      resolution: 'wont-do',
      resolutionReason: 'Out of scope'
    })
    expect(value.closedIds).toEqual([item.id, child.id])
    expect(value.cancelledTask).toBe(false)

    const archived = await call(
      'GET',
      `${base}?scope=archived&filter=${encodeURIComponent(
        JSON.stringify({ conditions: [{ field: 'resolution', op: 'is', value: 'wont-do' }] })
      )}`
    )
    const listed = (await json<{ value: Array<{ id: string; resolution: string }> }>(archived))
      .value
    expect(listed.map((entry) => entry.id).sort()).toEqual([item.id, child.id].sort())

    // Already closed, and bad options, are refused.
    expect((await call('POST', `${base}/${item.id}/wont-do`, {})).status).toBe(400)
    const done = planning.createWorkItem(
      project.id,
      { title: 'Finished', status: 'done' },
      { kind: 'human' }
    )
    expect((await call('POST', `${base}/${done.id}/wont-do`, {})).status).toBe(400)
    expect(
      (await call('POST', `${base}/${child.id}/wont-do`, { includeSubtasks: 'yes' })).status
    ).toBe(400)

    // Unarchive reopens it, with the status it had.
    const reopened = await call('POST', `${base}/${item.id}/unarchive`)
    expect(reopened.status).toBe(200)
    expect(
      (await json<{ value: { status: string; resolution: string | null } }>(reopened)).value
    ).toMatchObject({ status: 'active', resolution: null })
  })

  it('links tasks, marks a duplicate and copies a task (N2.4)', async () => {
    const base = `/automation/${project.id}/work-items`
    const human = { kind: 'human' as const }
    const original = planning.createWorkItem(project.id, { title: 'Login fails' }, human)
    const other = planning.createWorkItem(project.id, { title: 'Sign-in broken' }, human)
    const third = planning.createWorkItem(
      project.id,
      { title: 'Write the guide', labels: ['docs'], acceptanceCriteria: ['Outline'] },
      human
    )
    type Link = { id: string; kind: string; role: string; otherWorkItemId: string }

    const added = await call('POST', `${base}/${original.id}/links`, {
      toWorkItemId: third.id,
      kind: 'relates'
    })
    expect(added.status).toBe(200)
    const link = (await json<{ value: Link }>(added)).value
    expect(link).toMatchObject({ kind: 'relates', role: 'relates', otherWorkItemId: third.id })
    // Read from the other end too.
    const fromThird = (
      await json<{ value: Link[] }>(await call('GET', `${base}/${third.id}/links`))
    ).value
    expect(fromThird.map((entry) => [entry.role, entry.otherWorkItemId])).toEqual([
      ['relates', original.id]
    ])
    // Refusals: twice, itself, a bad kind.
    expect(
      (
        await call('POST', `${base}/${third.id}/links`, {
          toWorkItemId: original.id,
          kind: 'relates'
        })
      ).status
    ).toBe(400)
    expect(
      (await call('POST', `${base}/${third.id}/links`, { toWorkItemId: third.id, kind: 'relates' }))
        .status
    ).toBe(400)
    expect(
      (await call('POST', `${base}/${third.id}/links`, { toWorkItemId: other.id, kind: 'blocks' }))
        .status
    ).toBe(400)
    const removed = await call('DELETE', `${base}/${third.id}/links/${link.id}`)
    expect(removed.status).toBe(200)
    expect(planning.listWorkItemLinks(original.id)).toEqual([])

    // Mark as duplicate: linked and closed as won't do.
    const marked = await call('POST', `${base}/${other.id}/duplicate-of`, {
      originalId: original.id
    })
    expect(marked.status).toBe(200)
    const result = (
      await json<{
        value: { workItem: { resolution: string; resolutionReason: string }; link: Link }
      }>(marked)
    ).value
    expect(result.workItem).toMatchObject({
      resolution: 'wont-do',
      resolutionReason: 'Duplicate of Login fails'
    })
    expect(result.link.role).toBe('duplicate-of')
    const done = planning.createWorkItem(project.id, { title: 'Done', status: 'done' }, human)
    expect(
      (await call('POST', `${base}/${done.id}/duplicate-of`, { originalId: original.id })).status
    ).toBe(400)
    expect(planning.listWorkItemLinks(done.id)).toEqual([])

    // Copy task.
    const copied = await call('POST', `${base}/${third.id}/copy`)
    expect(copied.status).toBe(200)
    const copy = (
      await json<{
        value: { workItem: { title: string; status: string; labels: string[] }; link: Link }
      }>(copied)
    ).value
    expect(copy.workItem).toMatchObject({
      title: 'Write the guide (copy)',
      status: 'backlog',
      labels: ['docs']
    })
    expect(copy.link).toMatchObject({ kind: 'copied-from', role: 'copied-from' })
    expect((await call('POST', `${base}/missing/copy`)).status).toBeGreaterThanOrEqual(400)
  })

  it('lists a task’s description versions, and a PATCH restores one (N2.6)', async () => {
    const base = `/automation/${project.id}/work-items`
    const item = planning.createWorkItem(
      project.id,
      { title: 'Brief', description: 'The first text' },
      { kind: 'human' }
    )
    planning.updateWorkItem(item.id, { description: 'Typed over' }, { kind: 'human' })
    type Version = { id: number; text: string; actor: { kind: string; name: string } }

    const listed = await call('GET', `${base}/${item.id}/description-versions`)
    expect(listed.status).toBe(200)
    const versions = (await json<{ value: Version[] }>(listed)).value
    expect(versions.map((version) => [version.actor.kind, version.text])).toEqual([
      ['human', 'The first text']
    ])

    // Restoring is a normal PATCH: the text it replaces becomes a version too, newest first.
    const patched = await call('PATCH', `${base}/${item.id}`, { description: versions[0].text })
    expect(patched.status).toBe(200)
    const after = (
      await json<{ value: Version[] }>(await call('GET', `${base}/${item.id}/description-versions`))
    ).value
    expect(after.map((version) => [version.actor.kind, version.text])).toEqual([
      ['automation', 'Typed over'],
      ['human', 'The first text']
    ])
    expect((await call('POST', `${base}/${item.id}/description-versions`)).status).toBe(404)
    expect(
      (await call('GET', `${base}/missing/description-versions`)).status
    ).toBeGreaterThanOrEqual(400)
  })

  it('refuses won’t do for queued agent work unless asked to cancel it (N1.2)', async () => {
    const item = planning.createWorkItem(
      project.id,
      { title: 'Queued', status: 'ready' },
      { kind: 'human' }
    )
    await call('POST', `/automation/${project.id}/tasks`, { workItemId: item.id })
    const base = `/automation/${project.id}/work-items/${item.id}/wont-do`
    const refused = await call('POST', base, {})
    expect(refused.status).toBe(400)
    expect((await json<{ error: string }>(refused)).error).toMatch(/cannot be archived/)

    const closed = await call('POST', base, { cancelQueuedWork: true })
    expect(closed.status).toBe(200)
    const value = (
      await json<{ value: { cancelledTask: boolean; workItem: { linkedHarnessTaskId: null } } }>(
        closed
      )
    ).value
    expect(value.cancelledTask).toBe(true)
    expect(value.workItem.linkedHarnessTaskId).toBeNull()
  })

  it('purges old recycle-bin entries and auto-archives done work when enabled', () => {
    const day = 24 * 60 * 60 * 1000
    const now = Date.now()
    const stale = planning.createWorkItem(project.id, { title: 'Old bin entry' }, { kind: 'human' })
    planning.moveWorkItemToBin(stale.id, { kind: 'human' }, now - 31 * day)
    const fresh = planning.createWorkItem(project.id, { title: 'New bin entry' }, { kind: 'human' })
    planning.moveWorkItemToBin(fresh.id, { kind: 'human' }, now - 2 * day)
    const done = planning.createWorkItem(
      project.id,
      { title: 'Finished', status: 'done' },
      { kind: 'human' }
    )
    const open = planning.createWorkItem(
      project.id,
      { title: 'Still open', status: 'ready' },
      { kind: 'human' }
    )

    // Off: only the bin is emptied.
    expect(
      runWorkItemHousekeeping(planning, harness, project, { autoArchiveDoneAfterDays: 0 }, now)
    ).toEqual({ archived: 0, purged: 1 })
    expect(() => planning.getWorkItem(stale.id)).toThrow(/not found/)
    expect(planning.getWorkItem(fresh.id).deletedAt).not.toBeNull()

    // On: done work untouched for the window is archived; open work is not.
    const later = now + 8 * day
    expect(
      runWorkItemHousekeeping(planning, harness, project, { autoArchiveDoneAfterDays: 7 }, later)
    ).toEqual({ archived: 1, purged: 0 })
    expect(planning.getWorkItem(done.id).archivedAt).toBe(later)
    expect(planning.getWorkItem(open.id).archivedAt).toBeNull()
  })

  it('backs a title-only task with a work item and reports its Board column', async () => {
    const added = await call('POST', `/automation/${project.id}/tasks`, {
      title: 'Board-visible task',
      description: 'Should be a card',
      priority: 'high'
    })
    expect(added.status).toBe(200)
    const task = (await json<{ value: { id: string; planningWorkItemId: string } }>(added)).value
    expect(task.planningWorkItemId).toBeTruthy()

    const columnOf = async () => {
      const listed = await call('GET', `/automation/${project.id}/work-items`)
      const items = (
        await json<{ value: Array<{ id: string; status: string; linkedHarnessTaskId: string }> }>(
          listed
        )
      ).value
      return items.find((item) => item.linkedHarnessTaskId === task.id)?.status
    }
    expect(await columnOf()).toBe('ready')

    await harness.startSessionForTask(project, task.id)
    expect(await columnOf()).toBe('active')
  })

  it('adds a planning-linked task idempotently and reuses the reserved task id', async () => {
    const workItem = planning.createWorkItem(
      project.id,
      {
        title: 'Ship the linked task',
        description: 'The linked execution scope.',
        status: 'ready',
        priority: 'high',
        acceptanceCriteria: ['The queue link is stable across retries']
      },
      { kind: 'human' }
    )

    const first = await call('POST', `/automation/${project.id}/tasks`, {
      workItemId: workItem.id
    })
    const second = await call('POST', `/automation/${project.id}/tasks`, {
      workItemId: workItem.id
    })
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    const firstTask = (
      await json<{ value: { id: string; planningWorkItemId: string | null } }>(first)
    ).value
    const secondTask = (await json<{ value: { id: string } }>(second)).value
    expect(secondTask.id).toBe(firstTask.id)
    expect(firstTask.planningWorkItemId).toBe(workItem.id)
    expect(planning.getWorkItem(workItem.id).linkedHarnessTaskId).toBe(firstTask.id)
    expect(harness.getState(project).taskQueue).toHaveLength(1)
  })

  it('synchronizes priority changes for planning-linked tasks', async () => {
    const workItem = planning.createWorkItem(
      project.id,
      {
        title: 'Prioritize the linked task',
        status: 'ready',
        priority: 'low'
      },
      { kind: 'human' }
    )
    const added = await call('POST', `/automation/${project.id}/tasks`, {
      workItemId: workItem.id
    })
    const taskId = (await json<{ value: { id: string } }>(added)).value.id

    const priority = await call('PATCH', `/automation/${project.id}/tasks/${taskId}/priority`, {
      priority: 'critical'
    })

    expect(priority.status).toBe(200)
    expect(planning.getWorkItem(workItem.id).priority).toBe('critical')
    expect(harness.getState(project).taskQueue[0].priority).toBe('critical')
  })

  it('delegates queue validation and exposes no ownership routes', async () => {
    const add = await call('POST', `/automation/${project.id}/tasks`, { title: 'Protected task' })
    const taskId = (await json<{ value: { id: string } }>(add)).value.id

    const invalidOrder = await call('POST', `/automation/${project.id}/tasks/reorder`, {
      taskIds: [taskId, taskId]
    })
    expect(invalidOrder.status).toBe(400)

    const invalidPriority = await call(
      'PATCH',
      `/automation/${project.id}/tasks/${taskId}/priority`,
      { priority: 'urgent' }
    )
    expect(invalidPriority.status).toBe(400)

    const help = await call('GET', `/automation/${project.id}/help?full=1`, undefined, '')
    const routes = (await json<{ value: { routes: Array<{ path: string }> } }>(help)).value.routes
    expect(routes.map((route) => route.path).join(' ')).not.toMatch(
      /(?:claim|complete|force-release|force-end)/i
    )

    for (const forbidden of ['claim', 'complete', 'release', 'force-release']) {
      const response = await call(
        'POST',
        `/automation/${project.id}/tasks/${taskId}/${forbidden}`,
        { sessionId: 'not-an-automation-session' }
      )
      expect(response.status).toBe(404)
    }
    const forceEnd = await call(
      'POST',
      `/automation/${project.id}/sessions/session-id/force-end`,
      {}
    )
    expect(forceEnd.status).toBe(404)
  })

  it('cancels a queued task through POST cancel and DELETE', async () => {
    const first = await call('POST', `/automation/${project.id}/tasks`, { title: 'Cancel me' })
    const firstId = (await json<{ value: { id: string } }>(first)).value.id
    const second = await call('POST', `/automation/${project.id}/tasks`, { title: 'Delete me' })
    const secondId = (await json<{ value: { id: string } }>(second)).value.id

    const cancelled = await call('POST', `/automation/${project.id}/tasks/${firstId}/cancel`)
    expect(cancelled.status).toBe(200)
    const cancelledValue = (
      await json<{ value: { task: { status: string }; workItem: unknown } }>(cancelled)
    ).value
    expect(cancelledValue.task.status).toBe('cancelled')
    // Every task is backed by a work item, which returns to Ready on cancel.
    expect(cancelledValue.workItem).not.toBeNull()

    const deleted = await call('DELETE', `/automation/${project.id}/tasks/${secondId}`)
    expect(deleted.status).toBe(200)
    expect((await json<{ value: { task: { status: string } } }>(deleted)).value.task.status).toBe(
      'cancelled'
    )

    const again = await call('POST', `/automation/${project.id}/tasks/${firstId}/cancel`)
    expect(again.status).toBe(400)
  })

  it('clears the planning handoff when a linked task is cancelled', async () => {
    const item = planning.createWorkItem(
      project.id,
      { title: 'Linked', status: 'ready' },
      { kind: 'human' }
    )
    const queued = await call('POST', `/automation/${project.id}/tasks`, { workItemId: item.id })
    const taskId = (await json<{ value: { id: string } }>(queued)).value.id

    const cancelled = await call('DELETE', `/automation/${project.id}/tasks/${taskId}`)
    expect(cancelled.status).toBe(200)
    const workItem = (
      await json<{ value: { workItem: { id: string; linkedHarnessTaskId: string | null } } }>(
        cancelled
      )
    ).value.workItem
    expect(workItem.id).toBe(item.id)
    expect(planning.getWorkItem(item.id).linkedHarnessTaskId).toBeNull()
  })

  it('validates review routes and refuses them while the agent is still working', async () => {
    const session = await startTaskSession(harness, project, 'Working agent')
    const base = `/automation/${project.id}/sessions/${session.id}`

    for (const action of ['apply', 'discard']) {
      const response = await call('POST', `${base}/${action}`)
      expect(response.status).toBe(400)
    }

    const noReason = await call('POST', `${base}/send-back`, {})
    expect(noReason.status).toBe(400)
    expect((await json<{ error: string }>(noReason)).error).toMatch(/reason is required/)

    const badDisposition = await call('POST', `${base}/send-back`, {
      reason: 'Wrong',
      disposition: 'later'
    })
    expect(badDisposition.status).toBe(400)
    expect((await json<{ error: string }>(badDisposition)).error).toMatch(/disposition/)

    const help = await call('GET', `/automation/${project.id}/help?full=1`, undefined, '')
    const paths = (
      await json<{ value: { routes: Array<{ path: string }> } }>(help)
    ).value.routes.map((route) => route.path)
    for (const expected of [
      '/tasks/:taskId/cancel',
      '/tasks/:taskId',
      '/sessions/:sessionId/apply',
      '/sessions/:sessionId/send-back',
      '/sessions/:sessionId/discard',
      '/sessions/:sessionId/stop'
    ])
      expect(paths).toContain(expected)
    for (const removed of ['/sessions/:sessionId/merge', '/checkout', '/checkout/export'])
      expect(paths).not.toContain(removed)
  })

  it('applies finished work to the project folder and records it in the history', async () => {
    const task = harness.addTask(project, 'Agent change', '')
    const session = await harness.startSessionForTask(project, task.id)
    fs.writeFileSync(path.join(session.workspace!.worktreePath, 'app.txt'), 'agent\n')
    await harness.completeSessionWithAutoContinuation(project, session.id, 'Done', task.id)

    const applied = await call('POST', `/automation/${project.id}/sessions/${session.id}/apply`)
    expect(applied.status).toBe(200)
    expect((await json<{ value: { outcome: string } }>(applied)).value.outcome).toBe('applied')
    expect(fs.readFileSync(path.join(project.path!, 'app.txt'), 'utf8')).toBe('agent\n')
  }, 30_000)

  it('sends work back with line comments, and lists drafts and earlier comments with sessions (N9.2a)', async () => {
    const task = harness.addTask(project, 'Commented change', '')
    const session = await harness.startSessionForTask(project, task.id)
    fs.writeFileSync(path.join(session.workspace!.worktreePath, 'app.txt'), 'agent\n')
    await harness.completeSessionWithAutoContinuation(project, session.id, 'Done', task.id)
    harness.saveReviewDrafts(project, session.id, [
      { id: 'draft-1', file: 'app.txt', side: 'new', firstLine: 1, lastLine: 1, comment: 'Draft' }
    ])
    const sessions = `/automation/${project.id}/sessions`

    type Listed = {
      value: {
        review: { id: string; reviewDrafts?: { id: string }[]; lastReviewComments: unknown[] }[]
      }
    }
    const listed = (await json<Listed>(await call('GET', sessions))).value.review
    expect(listed.find((item) => item.id === session.id)?.reviewDrafts).toEqual([
      expect.objectContaining({ id: 'draft-1', comment: 'Draft' })
    ])

    const notShown = await call('POST', `${sessions}/${session.id}/send-back`, {
      comments: [{ file: 'app.txt', firstLine: 9, comment: 'Nowhere' }]
    })
    expect(notShown.status).toBe(400)
    expect((await json<{ error: string }>(notShown)).error).toMatch(/does not show/)

    const sent = await call('POST', `${sessions}/${session.id}/send-back`, {
      comments: [{ file: 'app.txt', side: 'new', firstLine: 1, lastLine: 1, comment: 'Say more' }]
    })
    expect(sent.status).toBe(200)
    const queued = harness.getState(project).taskQueue.find((item) => item.id === task.id)!
    expect(queued.details).toContain('[Sent back 1] See the line comments (1 line comment)')
    expect(queued.rejections?.at(-1)?.comments).toEqual([
      expect.objectContaining({ comment: 'Say more', excerpt: expect.stringContaining('+agent') })
    ])

    // The next attempt's session lists them as the last review's comments.
    const next = await harness.startSessionForTask(project, task.id)
    const active = (
      await json<{ value: { active: { id: string; lastReviewComments: unknown[] }[] } }>(
        await call('GET', sessions)
      )
    ).value.active
    expect(active.find((item) => item.id === next.id)?.lastReviewComments).toEqual([
      expect.objectContaining({ file: 'app.txt', comment: 'Say more' })
    ])
  }, 30_000)

  it('returns the answers to line comments with each report, and the alert (N9.2b)', async () => {
    const task = harness.addTask(project, 'Answered change', '')
    const session = await harness.startSessionForTask(project, task.id)
    fs.writeFileSync(path.join(session.workspace!.worktreePath, 'app.txt'), 'agent\n')
    await harness.completeSessionWithAutoContinuation(project, session.id, 'Done', task.id)
    const sessions = `/automation/${project.id}/sessions`
    const sent = await call('POST', `${sessions}/${session.id}/send-back`, {
      comments: [
        { id: 'c1', file: 'app.txt', firstLine: 1, comment: 'Say more' },
        { id: 'c2', file: 'app.txt', firstLine: 1, comment: 'And less' }
      ]
    })
    expect(sent.status).toBe(200)

    const next = await harness.startSessionForTask(project, task.id)
    fs.writeFileSync(path.join(next.workspace!.worktreePath, 'app.txt'), 'agent, more\n')
    await harness.completeSessionWithAutoContinuation(project, next.id, 'Done', task.id, {
      filesChanged: ['app.txt'],
      summary: 'Said more',
      submittedAt: new Date().toISOString(),
      outcome: 'reported',
      commentAnswers: [{ id: 'c1', status: 'done', note: 'Said more', path: 'app.txt' }]
    })

    type Listed = {
      value: {
        review: {
          id: string
          report: { commentAnswers?: unknown[] } | null
          commentAnswerAlerts: string[]
        }[]
      }
    }
    const listed = (await json<Listed>(await call('GET', sessions))).value.review.find(
      (item) => item.id === next.id
    )
    expect(listed?.report?.commentAnswers).toEqual([
      { id: 'c1', status: 'done', note: 'Said more', path: 'app.txt' }
    ])
    expect(listed?.commentAnswerAlerts).toEqual(['1 of 2 comments answered'])

    const help = await call('GET', `/automation/${project.id}/help?full=1`, undefined, '')
    expect(JSON.stringify(await help.json())).toContain('commentAnswerAlerts')
  }, 30_000)

  it('returns read-only status, report, and project directory data without credentials', async () => {
    planning.createGoal(project.id, { title: 'Active goal' })
    const achievedGoal = planning.createGoal(project.id, { title: 'Achieved goal' })
    planning.updateGoal(achievedGoal.id, { status: 'achieved' })
    planning.createMilestone(project.id, { name: 'Planned milestone' })
    const activeMilestone = planning.createMilestone(project.id, { name: 'Active milestone' })
    planning.updateMilestone(activeMilestone.id, { status: 'active' })
    planning.createWorkItem(project.id, { title: 'Backlog item' }, { kind: 'human' })
    planning.createWorkItem(project.id, { title: 'Ready item', status: 'ready' }, { kind: 'human' })
    planning.createWorkItem(
      project.id,
      { title: 'Blocked item', status: 'blocked' },
      { kind: 'human' }
    )

    const queued = harness.addTask(project, 'Pending task', 'Wait for an agent')
    const statusResponse = await call('GET', `/automation/${project.id}/status`)
    expect(statusResponse.status, await statusResponse.clone().text()).toBe(200)
    const status = (
      await json<{
        ok: boolean
        value: {
          harness: {
            queue: { pending: number; active: number; review: number; done: number }
            unansweredQuestions: number
            workspacesAwaitingReview: number
          }
          planning: {
            goals: Record<string, number>
            milestones: Record<string, number>
            workItems: Record<string, number>
            metrics: { itemCount: number }
          }
          readinessReports?: unknown
        }
      }>(statusResponse)
    ).value
    expect(status.harness).toMatchObject({
      queue: { pending: 1, active: 0, review: 0, done: 0 },
      unansweredQuestions: 0,
      workspacesAwaitingReview: 0
    })
    expect(status.planning).toMatchObject({
      goals: { active: 1, achieved: 1, archived: 0 },
      milestones: { planned: 1, active: 1, complete: 0, archived: 0 },
      workItems: { backlog: 1, ready: 1, blocked: 1, active: 0, review: 0, done: 0 },
      metrics: { itemCount: 3 }
    })
    expect(queued.status).toBe('pending')
    expect(status.readinessReports).toBeUndefined()

    const reportResponse = await call('GET', `/automation/${project.id}/report`)
    expect(reportResponse.status).toBe(200)
    const report = await json<{ ok: boolean; value: { projectId: string; metrics: unknown } }>(
      reportResponse
    )
    expect(report.value).toMatchObject({ projectId: project.id, metrics: expect.any(Object) })

    const projectsResponse = await call('GET', '/automation/projects')
    expect(projectsResponse.status).toBe(200)
    const projectsBody = await json<{
      value: Array<{
        id: string
        name: string
        enabled: boolean
        automationTokenConfigured: boolean
      }>
    }>(projectsResponse)
    expect(projectsBody.value).toEqual([
      {
        id: project.id,
        name: project.name,
        enabled: true,
        hasFolder: true,
        automationTokenConfigured: true,
        areaId: null,
        icon: null,
        stage: 'active'
      }
    ])
    const serialized = JSON.stringify({ status, report, projectsBody })
    expect(serialized).not.toContain(project.automationToken!)
    expect(serialized).not.toContain('apiKey')
  })

  it('answers folder routes with 409 for a project without a folder, and planning routes as usual', async () => {
    project.path = null
    const workItem = planning.createWorkItem(
      project.id,
      {
        title: 'Book the venue',
        status: 'ready'
      },
      { kind: 'human' }
    )

    const queued = await call('POST', `/automation/${project.id}/tasks`, {
      workItemId: workItem.id
    })
    expect(queued.status).toBe(409)
    expect((await json<{ error: string }>(queued)).error).toBe(
      "Queuing a task for an agent needs a linked folder. Link one in the project's settings."
    )
    const titled = await call('POST', `/automation/${project.id}/tasks`, { title: 'Order cake' })
    expect(titled.status).toBe(409)
    const started = await call('POST', `/automation/${project.id}/tasks/any/start-embedded`)
    expect(started.status).toBe(409)
    expect(embeddedStarts).toEqual([])

    // Nothing was created by the refused title-only queue call.
    const items = await call('GET', `/automation/${project.id}/work-items`)
    expect(items.status).toBe(200)
    expect((await json<{ value: { title: string }[] }>(items)).value.map((i) => i.title)).toEqual([
      'Book the venue'
    ])
    const created = await call('POST', `/automation/${project.id}/work-items`, { title: 'Guests' })
    expect(created.status).toBe(200)
    expect((await call('GET', `/automation/${project.id}/status`)).status).toBe(200)

    const listed = await call('GET', '/automation/projects')
    expect((await json<{ value: { hasFolder: boolean }[] }>(listed)).value[0].hasFolder).toBe(false)
    const help = await json<{ value: { instructions: string } }>(
      await call('GET', `/automation/${project.id}/help?full=1`, undefined, '')
    )
    expect(help.value.instructions).toContain('HTTP 409')
  })
})
