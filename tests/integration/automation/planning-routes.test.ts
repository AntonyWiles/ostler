import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../../electron/services/automation-http-server'
import { PlanningService } from '../../../electron/services/planning-service'
import { GettingStartedService } from '../../../electron/services/getting-started-service'
import { shiftIsoDate, todayIsoDate } from '../../../src/shared/dates'
import type { WatchedProject } from '../../../src/shared/ostler-api'
import { json, useAutomationServer } from '../../helpers/automation-fixture'
import { createMigratedDatabase } from '../../helpers/database'
import { makeWatchedProject } from '../../helpers/projects'
import { useTempDir } from '../../helpers/temp-dir'

describe('automation-http-server.ts planning routes', () => {
  const temp = useTempDir('ostler-automation-http-')
  const http = useAutomationServer()
  let root: string
  let project: WatchedProject
  let planning: PlanningService
  let server: AutomationHttpServer

  beforeEach(async () => {
    root = temp()
    project = makeWatchedProject({
      id: 'automation-project',
      name: 'Automation project',
      path: path.join(root, 'project'),
      addedAt: Date.now(),
      automationToken: 'automation-token'
    })
    fs.mkdirSync(project.path!, { recursive: true })
    planning = new PlanningService(await createMigratedDatabase(root), () => [
      project.id,
      'other-project'
    ])
    server = new AutomationHttpServer(
      () => [project],
      path.join(root, 'runtime'),
      undefined,
      planning
    )
    await http.start(server, planning)
  })

  function call(method: string, urlPath: string, body?: unknown, token = project.automationToken) {
    return http.request(method, urlPath, { body, token })
  }

  it('ticks "Create a task" on getting started when a task is created through the API (P8.1)', async () => {
    const gettingStarted = new GettingStartedService({
      db: planning.database,
      getProjectIds: () => [project.id],
      aiConfigured: () => false,
      getProgress: () => ({
        dismissed: false,
        triedView: false,
        usedSearch: false,
        sawBackups: false
      }),
      saveProgress: () => {}
    })
    const step = () => gettingStarted.read().steps.find((entry) => entry.id === 'createTask')!
    expect(step().done).toBe(false)

    const response = await call('POST', `/automation/${project.id}/work-items`, {
      title: 'Write the agenda'
    })
    expect(response.ok).toBe(true)
    expect(step().done).toBe(true)
  })

  it('lists the planning routes with usable request and response examples', async () => {
    const response = await call('GET', `/automation/${project.id}/help`, undefined, '')
    expect(response.status).toBe(200)
    const body = await json<{
      ok: boolean
      value: {
        routes: Array<{
          method: string
          path: string
          request?: string
          response: string
          exampleBody?: unknown
        }>
      }
    }>(response)

    expect(body.ok).toBe(true)
    for (const route of [
      ['GET', '/projects'],
      ['GET', '/status'],
      ['GET', '/report'],
      ['GET', '/goals'],
      ['POST', '/goals'],
      ['PATCH', '/goals/:goalId'],
      ['POST', '/goals/:goalId/split'],
      ['GET', '/milestones'],
      ['POST', '/milestones'],
      ['PATCH', '/milestones/:milestoneId'],
      ['GET', '/work-items'],
      ['POST', '/work-items'],
      ['PATCH', '/work-items/:workItemId'],
      ['GET', '/dependency-conflicts'],
      ['GET', '/critical-path'],
      ['GET', '/blockers'],
      ['POST', '/blockers'],
      ['POST', '/blockers/:blockerId/resolve']
    ]) {
      const found = body.value.routes.find(
        (candidate) => candidate.method === route[0] && candidate.path === route[1]
      )
      expect(found).toBeDefined()
      expect(found?.response).toBeTruthy()
      if (route[0] !== 'GET') expect(found?.request).toBeTruthy()
    }

    const splitRoute = body.value.routes.find(
      (candidate) => candidate.method === 'POST' && candidate.path === '/goals/:goalId/split'
    )
    expect(splitRoute?.exampleBody).toEqual(expect.objectContaining({ items: expect.any(Array) }))
  })

  it('creates, lists, and updates goals, milestones, and work items through PlanningService', async () => {
    const goalResponse = await call('POST', `/automation/${project.id}/goals`, {
      title: 'Launch the beta',
      outcome: 'Users can complete the first trip.'
    })
    expect(goalResponse.status).toBe(200)
    const goalBody = await json<{ value: { id: string; status: string } }>(goalResponse)
    expect(goalBody.value.status).toBe('active')

    const goalId = goalBody.value.id
    const goalUpdate = await call('PATCH', `/automation/${project.id}/goals/${goalId}`, {
      status: 'achieved'
    })
    expect(goalUpdate.status).toBe(200)
    expect((await json<{ value: { status: string } }>(goalUpdate)).value.status).toBe('achieved')

    const milestoneResponse = await call('POST', `/automation/${project.id}/milestones`, {
      name: 'Sea trials',
      goalId,
      targetDate: '2026-09-30',
      successCriteria: ['The trial completes without critical findings']
    })
    expect(milestoneResponse.status).toBe(200)
    const milestone = (await json<{ value: { id: string } }>(milestoneResponse)).value

    const milestoneUpdate = await call(
      'PATCH',
      `/automation/${project.id}/milestones/${milestone.id}`,
      { status: 'complete' }
    )
    expect(milestoneUpdate.status).toBe(200)

    const workItemResponse = await call('POST', `/automation/${project.id}/work-items`, {
      title: 'Document the checklist',
      milestoneId: milestone.id,
      status: 'ready',
      priority: 'high',
      labels: ['documentation'],
      acceptanceCriteria: ['The checklist is reviewed']
    })
    expect(workItemResponse.status).toBe(200)
    const workItem = (await json<{ value: { id: string; origin: string } }>(workItemResponse)).value
    expect(workItem.origin).toBe('human')

    const workItemUpdate = await call(
      'PATCH',
      `/automation/${project.id}/work-items/${workItem.id}`,
      { status: 'done', priority: 'critical' }
    )
    expect(workItemUpdate.status).toBe(200)
    expect((await json<{ value: { status: string } }>(workItemUpdate)).value.status).toBe('done')

    const [goals, milestones, workItems] = await Promise.all([
      call('GET', `/automation/${project.id}/goals`),
      call('GET', `/automation/${project.id}/milestones`),
      call('GET', `/automation/${project.id}/work-items`)
    ])
    expect((await json<{ value: unknown[] }>(goals)).value).toHaveLength(1)
    expect((await json<{ value: unknown[] }>(milestones)).value).toHaveLength(1)
    expect((await json<{ value: unknown[] }>(workItems)).value).toHaveLength(1)
  })

  it('manages rules, and a change made through the API sets them off (R6.2)', async () => {
    const base = `/automation/${project.id}`
    const created = await call('POST', `${base}/rules`, {
      name: 'Escalate',
      trigger: { kind: 'statusChanged', to: 'blocked' },
      conditions: [{ kind: 'label', op: 'is', label: 'urgent' }],
      actions: [{ kind: 'setPriority', priority: 'critical' }]
    })
    expect(created.status).toBe(200)
    const rule = (await json<{ value: { id: string; enabled: boolean } }>(created)).value
    expect(rule.enabled).toBe(true)
    // Only the actions D45 lists exist.
    expect(
      (
        await call('POST', `${base}/rules`, {
          name: 'Bad',
          trigger: { kind: 'taskCreated' },
          actions: [{ kind: 'queueForAgents' }]
        })
      ).status
    ).toBe(400)

    const task = (
      await json<{ value: { id: string } }>(
        await call('POST', `${base}/work-items`, { title: 'Urgent', labels: ['urgent'] })
      )
    ).value
    const preview = await call('POST', `${base}/rules/preview`, {
      workItemId: task.id,
      conditions: [{ kind: 'label', op: 'is', label: 'urgent' }],
      actions: [{ kind: 'setPriority', priority: 'critical' }]
    })
    expect((await json<{ value: { matches: boolean } }>(preview)).value.matches).toBe(true)

    const blocked = await call('PATCH', `${base}/work-items/${task.id}`, { status: 'blocked' })
    const moved = (
      await json<{ value: { priority: string; ruleRun: { id: string; ruleNames: string[] } } }>(
        blocked
      )
    ).value
    expect(moved.priority).toBe('critical')
    expect(moved.ruleRun.ruleNames).toEqual(['Escalate'])
    const undone = await call('PATCH', `${base}/work-items/${task.id}`, {
      status: 'backlog',
      undoRuleRun: moved.ruleRun.id
    })
    expect((await json<{ value: { priority: string } }>(undone)).value.priority).toBe('medium')

    const off = await call('PATCH', `${base}/rules/${rule.id}`, { enabled: false })
    expect((await json<{ value: { enabled: boolean } }>(off)).value.enabled).toBe(false)
    const listed = await json<{ value: unknown[] }>(await call('GET', `${base}/rules`))
    expect(listed.value).toHaveLength(1)
    const deleted = await call('DELETE', `${base}/rules/${rule.id}`)
    const deletion = (await json<{ value: unknown }>(deleted)).value
    expect((await json<{ value: unknown[] }>(await call('GET', `${base}/rules`))).value).toEqual([])
    expect((await call('POST', `${base}/rules/restore`, deletion as object)).status).toBe(200)
    expect(
      (await json<{ value: unknown[] }>(await call('GET', `${base}/rules`))).value
    ).toHaveLength(1)
  })

  it('saves, lists, changes, uses and deletes task templates (N2.1)', async () => {
    const base = `/automation/${project.id}`
    type Template = { id: string; name: string; projectId: string | null }
    const created = await call('POST', `${base}/task-templates`, {
      name: 'Invoice run',
      body: {
        title: 'Send invoices',
        checklist: ['Export', 'Send'],
        dueDate: '+2d',
        subtasks: [{ title: 'Chase unpaid' }]
      }
    })
    expect(created.status).toBe(200)
    const template = (await json<{ value: Template }>(created)).value
    expect(template.projectId).toBe(project.id)
    // The same name in the same scope is refused, a bad body too.
    expect(
      (await call('POST', `${base}/task-templates`, { name: 'invoice RUN', body: { title: 'x' } }))
        .status
    ).toBe(400)
    expect(
      (
        await call('POST', `${base}/task-templates`, {
          name: 'Bad',
          body: { title: 'x', dueDate: '2026-01-01' }
        })
      ).status
    ).toBe(400)

    // From a task, for every project; another project's template is not listed.
    const task = (
      await json<{ value: { id: string } }>(
        await call('POST', `${base}/work-items`, { title: 'Bug', labels: ['bug'] })
      )
    ).value
    const fromTask = await call('POST', `${base}/task-templates`, {
      fromWorkItemId: task.id,
      scope: 'every'
    })
    expect((await json<{ value: Template }>(fromTask)).value).toMatchObject({
      name: 'Bug',
      projectId: null
    })
    planning.taskTemplates.save({
      name: 'Theirs',
      projectId: 'other-project',
      body: { title: 'x' }
    })
    const listed = await json<{ value: Template[] }>(await call('GET', `${base}/task-templates`))
    expect(listed.value.map((entry) => entry.name)).toEqual(['Bug', 'Invoice run'])

    const renamed = await call('PATCH', `${base}/task-templates/${template.id}`, {
      name: 'Weekly invoices',
      scope: 'every'
    })
    expect((await json<{ value: Template }>(renamed)).value).toMatchObject({
      name: 'Weekly invoices',
      projectId: null
    })

    const used = await call('POST', `${base}/task-templates/${template.id}/use`, {
      overrides: { title: 'This week’s invoices' }
    })
    expect(used.status).toBe(200)
    const made = (
      await json<{
        value: {
          workItem: { id: string; title: string; targetDate: string }
          subtasks: { parentWorkItemId: string }[]
        }
      }>(used)
    ).value
    expect(made.workItem.title).toBe('This week’s invoices')
    expect(made.workItem.targetDate).toBe(shiftIsoDate(todayIsoDate(), 2))
    expect(made.subtasks.map((subtask) => subtask.parentWorkItemId)).toEqual([made.workItem.id])

    expect((await call('DELETE', `${base}/task-templates/${template.id}`)).status).toBe(200)
    expect((await call('POST', `${base}/task-templates/${template.id}/use`, {})).status).toBe(400)
  })

  it('plans, starts, finishes and deletes iterations, with the app rules (R6.1)', async () => {
    const base = `/automation/${project.id}`
    const create = (name: string, startDate: string, endDate: string) =>
      call('POST', `${base}/iterations`, { name, startDate, endDate })
    const one = (
      await json<{ value: { id: string } }>(await create('One', '2026-10-01', '2026-10-14'))
    ).value
    const two = (
      await json<{ value: { id: string } }>(await create('Two', '2026-10-15', '2026-10-28'))
    ).value
    expect((await create('Clash', '2026-10-14', '2026-10-20')).status).toBe(400)

    const renamed = await call('PATCH', `${base}/iterations/${two.id}`, { goal: 'Ship it' })
    expect((await json<{ value: { goal: string } }>(renamed)).value.goal).toBe('Ship it')

    const task = (
      await json<{ value: { id: string; iterationId: string } }>(
        await call('POST', `${base}/work-items`, { title: 'Open', iterationId: one.id })
      )
    ).value
    expect(task.iterationId).toBe(one.id)

    expect((await call('POST', `${base}/iterations/${one.id}/start`, {})).status).toBe(200)
    expect((await call('POST', `${base}/iterations/${two.id}/start`, {})).status).toBe(400)
    const filtered = await call(
      'GET',
      `${base}/work-items?filter=${encodeURIComponent(
        JSON.stringify({
          match: 'all',
          conditions: [{ field: 'iteration', op: 'is', value: ['current'] }]
        })
      )}`
    )
    expect((await json<{ value: unknown[] }>(filtered)).value).toHaveLength(1)

    const finished = await call('POST', `${base}/iterations/${one.id}/finish`, {
      carryOver: 'next'
    })
    expect(finished.status).toBe(200)
    const finish = (
      await json<{ value: { iteration: { status: string }; movedTaskIds: string[] } }>(finished)
    ).value
    expect(finish.iteration.status).toBe('finished')
    expect(finish.movedTaskIds).toEqual([task.id])
    expect(
      (await call('POST', `${base}/iterations/${two.id}/finish`, { carryOver: 'x' })).status
    ).toBe(400)

    expect((await call('DELETE', `${base}/iterations/${two.id}`)).status).toBe(200)
    const listed = await json<{ value: Array<{ name: string }> }>(
      await call('GET', `${base}/iterations`)
    )
    expect(listed.value.map((iteration) => iteration.name)).toEqual(['One'])
    expect(planning.listWorkItems(project.id)[0].iterationId).toBeNull()
    expect((await call('PATCH', `${base}/iterations/nope`, { name: 'X' })).status).toBe(400)
  })

  it('returns the critical path for the project and for a milestone (N7.3)', async () => {
    const base = `/automation/${project.id}`
    const create = async (body: Record<string, unknown>) =>
      (await json<{ value: { id: string } }>(await call('POST', `${base}/work-items`, body))).value
    const milestone = (
      await json<{ value: { id: string } }>(
        await call('POST', `${base}/milestones`, { name: 'Launch', targetDate: '2026-10-20' })
      )
    ).value
    const design = await create({
      title: 'Design',
      startDate: '2026-10-01',
      targetDate: '2026-10-05'
    })
    const build = await create({
      title: 'Build',
      milestoneId: milestone.id,
      startDate: '2026-10-05',
      targetDate: '2026-10-15',
      dependencyIds: [design.id]
    })
    const notes = await create({ title: 'Notes', targetDate: '2026-10-03' })
    const later = await create({ title: 'Party', targetDate: '2026-10-25' })
    const undated = await create({ title: 'Someday' })

    type Result = {
      milestoneId: string | null
      end: string | null
      endFrom: string
      chains: string[][]
      tasks: Array<{ taskId: string; slackDays: number; critical: boolean }>
      undatedTaskIds: string[]
    }
    const whole = await json<{ value: Result }>(await call('GET', `${base}/critical-path`))
    expect(whole.value.end).toBe('2026-10-25')
    expect(whole.value.chains).toEqual([[later.id]])
    expect(whole.value.undatedTaskIds).toEqual([undated.id])
    const slack = Object.fromEntries(whole.value.tasks.map((task) => [task.taskId, task.slackDays]))
    expect(slack[notes.id]).toBe(22)
    expect(slack[build.id]).toBe(10)

    const forMilestone = await json<{ value: Result }>(
      await call('GET', `${base}/critical-path?milestoneId=${milestone.id}`)
    )
    expect(forMilestone.value).toMatchObject({
      milestoneId: milestone.id,
      end: '2026-10-20',
      endFrom: 'milestone',
      chains: [],
      undatedTaskIds: []
    })
    expect(forMilestone.value.tasks.map((task) => [task.taskId, task.slackDays])).toEqual([
      [design.id, 5],
      [build.id, 5]
    ])

    expect((await call('GET', `${base}/critical-path?milestoneId=nope`)).status).toBe(404)
  })

  it('lists the tasks that start before a dependency is due, as the Timeline flags them', async () => {
    const create = async (body: Record<string, unknown>) =>
      (
        await json<{ value: { id: string } }>(
          await call('POST', `/automation/${project.id}/work-items`, body)
        )
      ).value
    const design = await create({
      title: 'Design review',
      startDate: '2026-10-05',
      targetDate: '2026-10-12'
    })
    const build = await create({
      title: 'Build stage',
      startDate: '2026-10-10',
      targetDate: '2026-10-15',
      dependencyIds: [design.id]
    })
    await create({
      title: 'Print badges',
      targetDate: '2026-10-20',
      dependencyIds: [build.id]
    })
    const response = await call('GET', `/automation/${project.id}/dependency-conflicts`)
    expect(response.status).toBe(200)
    expect((await json<{ value: unknown[] }>(response)).value).toEqual([
      {
        taskId: build.id,
        dependencyId: design.id,
        start: '2026-10-10',
        dependencyDue: '2026-10-12'
      }
    ])
  })

  it('returns PlanningService validation errors for each mutation family', async () => {
    const invalidGoal = await call('POST', `/automation/${project.id}/goals`, { title: '   ' })
    expect(invalidGoal.status).toBe(400)
    expect((await json<{ error: string }>(invalidGoal)).error).toContain('Goal title is required')

    const goal = planning.createGoal(project.id, { title: 'Existing goal' })
    const invalidGoalUpdate = await call('PATCH', `/automation/${project.id}/goals/${goal.id}`, {
      status: 'complete'
    })
    expect(invalidGoalUpdate.status).toBe(400)

    const invalidMilestone = await call('POST', `/automation/${project.id}/milestones`, {
      name: 'Bad date',
      targetDate: '2026-02-30'
    })
    expect(invalidMilestone.status).toBe(400)

    const milestone = planning.createMilestone(project.id, { name: 'Existing milestone' })
    const invalidMilestoneUpdate = await call(
      'PATCH',
      `/automation/${project.id}/milestones/${milestone.id}`,
      { status: 'complete-ish' }
    )
    expect(invalidMilestoneUpdate.status).toBe(400)

    const invalidWorkItem = await call('POST', `/automation/${project.id}/work-items`, {
      title: 'Bad priority',
      priority: 'urgent'
    })
    expect(invalidWorkItem.status).toBe(400)

    const workItem = planning.createWorkItem(
      project.id,
      { title: 'Existing work item' },
      { kind: 'human' }
    )
    const invalidWorkItemUpdate = await call(
      'PATCH',
      `/automation/${project.id}/work-items/${workItem.id}`,
      { dependencyIds: ['missing-dependency'] }
    )
    expect(invalidWorkItemUpdate.status).toBe(400)
  })

  it('reads and replaces the project conventions, as Project settings does', async () => {
    const saved: string[] = []
    server.stop()
    server = new AutomationHttpServer(
      () => [project],
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
      undefined,
      undefined,
      undefined,
      undefined,
      {
        update: (_projectId: string, text: string) => {
          saved.push(text)
          project.agentConventions = text
          return text
        }
      }
    )
    await http.start(server, planning)

    const empty = await call('GET', `/automation/${project.id}/conventions`)
    await expect(empty.json()).resolves.toEqual({
      ok: true,
      value: { agentConventions: '', lessons: [] }
    })
    const changed = await call('PATCH', `/automation/${project.id}/conventions`, {
      agentConventions: '- Use tabs'
    })
    await expect(changed.json()).resolves.toEqual({
      ok: true,
      value: { agentConventions: '- Use tabs' }
    })
    expect(saved).toEqual(['- Use tabs'])
    const refused = await call('PATCH', `/automation/${project.id}/conventions`, {})
    expect(refused.status).toBe(400)
  })

  describe('split with batch references', () => {
    type SplitBody = {
      ok: boolean
      error?: string
      value?: Array<{
        index: number
        ok: boolean
        value: {
          id: string
          milestoneId?: string | null
          parentWorkItemId?: string | null
          dependencyIds?: string[]
        }
      }>
    }
    const splitWith = async (items: unknown[]) => {
      const goal = planning.createGoal(project.id, { title: 'Ship it' })
      const response = await call('POST', `/automation/${project.id}/goals/${goal.id}/split`, {
        items
      })
      return { goal, status: response.status, body: await json<SplitBody>(response) }
    }

    it('builds a goal, milestones and dependent tasks in one call, in any order', async () => {
      const { goal, status, body } = await splitWith([
        {
          type: 'work-item',
          ref: 'page',
          title: 'Build the page',
          milestoneRef: 'design',
          dependencyRefs: ['mock', 'api']
        },
        { type: 'milestone', ref: 'design', name: 'Design' },
        { type: 'milestone', ref: 'backend', name: 'Backend' },
        { type: 'work-item', ref: 'mock', title: 'Mock it', milestoneRef: 'design' },
        { type: 'work-item', ref: 'api', title: 'Add the API', milestoneRef: 'backend' },
        { type: 'work-item', title: 'Write the copy', parentRef: 'page' }
      ])
      expect(status).toBe(200)
      const results = body.value!
      expect(results.map((result) => [result.index, result.ok])).toEqual(
        [0, 1, 2, 3, 4, 5].map((index) => [index, true])
      )
      const [page, design, backend, mock, api, copy] = results.map((result) => result.value)
      expect(planning.listMilestones(project.id).find((m) => m.id === design.id)?.goalId).toBe(
        goal.id
      )
      expect(page.milestoneId).toBe(design.id)
      expect(api.milestoneId).toBe(backend.id)
      expect(page.dependencyIds).toEqual([mock.id, api.id])
      expect(copy.parentWorkItemId).toBe(page.id)
    })

    it('refuses an unknown ref and creates nothing', async () => {
      const { status, body } = await splitWith([
        { type: 'milestone', ref: 'design', name: 'Design' },
        { type: 'work-item', ref: 'a', title: 'A', milestoneRef: 'nope' }
      ])
      expect(status).toBe(400)
      expect(body.error).toBe("items[1].milestoneRef 'nope' does not match any milestone")
      expect(planning.listMilestones(project.id)).toHaveLength(0)
      expect(planning.listWorkItems(project.id)).toHaveLength(0)
    })

    it('refuses a dependency loop', async () => {
      const { status, body } = await splitWith([
        { type: 'work-item', ref: 'a', title: 'A', dependencyRefs: ['b'] },
        { type: 'work-item', ref: 'b', title: 'B', dependencyRefs: ['a'] }
      ])
      expect(status).toBe(400)
      expect(body.error).toMatch(/is part of a dependency loop/)
      expect(planning.listWorkItems(project.id)).toHaveLength(0)
    })

    it('rolls the whole batch back when one item fails to create', async () => {
      const { status, body } = await splitWith([
        { type: 'milestone', ref: 'design', name: 'Design' },
        { type: 'work-item', ref: 'a', title: 'A', milestoneRef: 'design' },
        { type: 'work-item', ref: 'b', title: '   ', dependencyRefs: ['a'] }
      ])
      expect(status).toBe(400)
      expect(body.error).toMatch(/^items\[2\]: .*Nothing was created\.$/)
      expect(planning.listMilestones(project.id)).toHaveLength(0)
      expect(planning.listWorkItems(project.id)).toHaveLength(0)
    })
  })

  it('returns per-item split results and keeps valid records when one item fails', async () => {
    const goal = planning.createGoal(project.id, { title: 'Split this goal' })
    const response = await call('POST', `/automation/${project.id}/goals/${goal.id}/split`, {
      items: [
        { type: 'milestone', name: 'Valid milestone', goalId: 'ignored-by-route' },
        { type: 'work-item', title: '   ' },
        { type: 'unknown', title: 'Unsupported definition' },
        { type: 'work-item', title: 'Valid work item', status: 'ready' }
      ]
    })

    expect(response.status).toBe(200)
    const body = await json<{
      ok: boolean
      value: Array<{
        index: number
        ok: boolean
        value?: { title?: string; goalId?: string }
        error?: string
      }>
    }>(response)
    expect(body.value).toHaveLength(4)
    expect(body.value.map((item) => item.ok)).toEqual([true, false, false, true])
    expect(body.value[0].value?.goalId).toBe(goal.id)
    expect(body.value[3].value?.title).toBe('Valid work item')
    expect(planning.listMilestones(project.id)).toHaveLength(1)
    expect(planning.listWorkItems(project.id)).toHaveLength(1)

    const missingItems = await call('POST', `/automation/${project.id}/goals/${goal.id}/split`, {})
    expect(missingItems.status).toBe(400)
    expect((await json<{ error: string }>(missingItems)).error).toContain(
      'Split items must be an array'
    )
  })

  it('pushes a planning change for each successful mutation and none for a read', async () => {
    server.stop()
    const changed: string[] = []
    server = new AutomationHttpServer(
      () => [project],
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
      (changedProject) => changed.push(changedProject.id)
    )
    await http.start(server, planning)

    expect((await call('GET', `/automation/${project.id}/goals`)).status).toBe(200)
    expect(changed).toEqual([])
    const created = await call('POST', `/automation/${project.id}/goals`, {
      title: 'Ship it',
      outcome: 'Shipped'
    })
    expect(created.status).toBe(200)
    expect((await call('POST', `/automation/${project.id}/goals`, { title: '' })).status).toBe(400)
    expect(changed).toEqual([project.id])
  })

  it('writes a credential-free audit entry for each successful planning mutation', async () => {
    const goal = await call('POST', `/automation/${project.id}/goals`, {
      title: 'Audited goal',
      outcome: 'No request body is copied to the audit log.'
    })
    const goalId = (await json<{ value: { id: string } }>(goal)).value.id
    await call('PATCH', `/automation/${project.id}/goals/${goalId}`, { status: 'achieved' })

    const auditPath = path.join(root, 'runtime', 'logs', 'automation-audit.log')
    const entries = fs
      .readFileSync(auditPath, 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as { route: string; summary: string })
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ route: '/goals', summary: 'POST planning goals' }),
        expect.objectContaining({ route: `/goals/${goalId}`, summary: 'PATCH planning goals' })
      ])
    )
    expect(fs.readFileSync(auditPath, 'utf8')).not.toContain('No request body is copied')
    expect(fs.readFileSync(auditPath, 'utf8')).not.toContain(project.automationToken!)
  })

  it('keeps authenticated planning routes separate from help and rejects wrong tokens', async () => {
    const missing = await call('GET', `/automation/${project.id}/goals`, undefined, '')
    expect(missing.status).toBe(401)

    const wrong = await call('GET', `/automation/${project.id}/goals`, undefined, 'harness-token')
    expect(wrong.status).toBe(401)

    const help = await call('GET', `/automation/${project.id}/help`, undefined, '')
    expect(help.status).toBe(200)

    const missingProjectsToken = await call('GET', '/automation/projects', undefined, '')
    expect(missingProjectsToken.status).toBe(401)
  })

  it('rejects mutations for a disabled project but still allows reads', async () => {
    project.enabled = false

    const create = await call('POST', `/automation/${project.id}/work-items`, {
      title: 'Should not be created'
    })
    expect(create.status).toBe(403)
    const createBody = await json<{ ok: boolean; error: string }>(create)
    expect(createBody.ok).toBe(false)
    expect(createBody.error).toMatch(/disabled/i)

    const read = await call('GET', `/automation/${project.id}/work-items`)
    expect(read.status).toBe(200)

    expect(planning.listWorkItems(project.id)).toHaveLength(0)
  })

  it('reports, lists, and resolves blockers, restoring dispatch eligibility', async () => {
    const item = planning.createWorkItem(
      project.id,
      { title: 'Blockable work', status: 'ready' },
      { kind: 'human' }
    )
    expect(planning.isWorkItemEligibleForDispatch(project.id, item.id)).toBe(true)

    const reportResponse = await call('POST', `/automation/${project.id}/blockers`, {
      workItemId: item.id,
      description: 'Waiting on a design decision.',
      resolutionOptions: ['Proceed with option A', 'Cancel']
    })
    expect(reportResponse.status).toBe(200)
    const reportBody = await json<{
      ok: boolean
      value: { id: string; workItemId: string; reportedBy: string; status: string }
    }>(reportResponse)
    expect(reportBody.value).toMatchObject({
      workItemId: item.id,
      reportedBy: 'agent',
      status: 'open'
    })
    expect(planning.isWorkItemEligibleForDispatch(project.id, item.id)).toBe(false)

    const listResponse = await call('GET', `/automation/${project.id}/blockers`)
    const listBody = await json<{
      ok: boolean
      value: Array<{ id: string; workItemTitle: string }>
    }>(listResponse)
    expect(listBody.value).toEqual([
      expect.objectContaining({ id: reportBody.value.id, workItemTitle: 'Blockable work' })
    ])

    const resolveResponse = await call(
      'POST',
      `/automation/${project.id}/blockers/${reportBody.value.id}/resolve`,
      { choice: 'Proceed with option A', note: 'Confirmed with the team.' }
    )
    expect(resolveResponse.status).toBe(200)
    const resolveBody = await json<{
      ok: boolean
      value: { status: string; resolutionChoice: string; resolvedBy: string }
    }>(resolveResponse)
    expect(resolveBody.value).toMatchObject({
      status: 'resolved',
      resolutionChoice: 'Proceed with option A',
      resolvedBy: 'automation-api'
    })

    expect(planning.isWorkItemEligibleForDispatch(project.id, item.id)).toBe(true)
    const emptyList = await json<{ ok: boolean; value: unknown[] }>(
      await call('GET', `/automation/${project.id}/blockers`)
    )
    expect(emptyList.value).toEqual([])
  })

  it('reads, adds, moves and removes My day entries for its own project only (N1.4)', async () => {
    const human = { kind: 'human' as const }
    const a = planning.createWorkItem(project.id, { title: 'A' }, human)
    const b = planning.createWorkItem(project.id, { title: 'B', someday: true }, human)
    const other = planning.createWorkItem('other-project', { title: 'Theirs' }, human)
    planning.database
      .prepare(
        "INSERT INTO my_day_entries (day, work_item_id, project_id, order_key, added_at) VALUES ('2026-10-16', ?, 'other-project', 'A', 1)"
      )
      .run(other.id)
    const base = `/automation/${project.id}/my-day`
    const titles = async () =>
      (
        await json<{ value: { title: string }[] }>(await call('GET', `${base}?date=2026-10-16`))
      ).value.map((task) => task.title)

    const added = await json<{ value: { broughtBack: string | null; already: boolean } }>(
      await call('POST', base, { workItemId: a.id, date: '2026-10-16' })
    )
    expect(added.value).toMatchObject({ broughtBack: null, already: false })
    const back = await json<{ value: { broughtBack: string | null } }>(
      await call('POST', base, { workItemId: b.id, date: '2026-10-16', beforeId: a.id })
    )
    expect(back.value.broughtBack).toBe('someday')
    expect(planning.getWorkItem(b.id).someday).toBe(false)
    expect(await titles()).toEqual(['B', 'A'])

    await call('POST', base, { workItemId: b.id, date: '2026-10-16', afterId: a.id, move: true })
    expect(await titles()).toEqual(['A', 'B'])

    // Another project's task and entries are out of reach.
    expect(
      (await call('POST', base, { workItemId: other.id, date: '2026-10-16' })).status
    ).toBeGreaterThanOrEqual(400)
    expect(
      (
        await json<{ value: { removed: boolean } }>(
          await call('DELETE', `${base}/${other.id}?date=2026-10-16`)
        )
      ).value.removed
    ).toBe(false)

    const removed = await json<{ value: { removed: boolean } }>(
      await call('DELETE', `${base}/${a.id}?date=2026-10-16`)
    )
    expect(removed.value.removed).toBe(true)
    expect(await titles()).toEqual(['B'])
    expect(planning.database.prepare('SELECT COUNT(*) AS n FROM my_day_entries').get()).toEqual({
      n: 2
    })
  })

  it('rejects a blocker report for a work item that belongs to another project', async () => {
    const other = planning.createWorkItem(
      'other-project',
      { title: 'Other project work' },
      { kind: 'human' }
    )
    const response = await call('POST', `/automation/${project.id}/blockers`, {
      workItemId: other.id,
      description: 'Should be rejected'
    })
    expect(response.status).toBe(400)
    const body = await json<{ ok: boolean; error: string }>(response)
    expect(body.error).toContain('another project')
  })

  describe('task and milestone fields, and plan batches (R1.1)', () => {
    it('creates a task with every field the New task form sets in one call', async () => {
      const milestone = planning.createMilestone(project.id, { name: 'Launch' })
      const parent = planning.createWorkItem(
        project.id,
        { title: 'Build the page' },
        { kind: 'human' }
      )
      // A subtask may only wait on its siblings in the same phase.
      const dependency = planning.createWorkItem(
        project.id,
        {
          title: 'Write the brief',
          parentWorkItemId: parent.id,
          subtaskPhaseNumber: 2,
          subtaskPhaseName: 'Review'
        },
        { kind: 'human' }
      )
      const response = await call('POST', `/automation/${project.id}/work-items`, {
        title: 'Review the page',
        description: 'Before the launch',
        status: 'ready',
        priority: 'high',
        milestoneId: milestone.id,
        labels: ['review'],
        acceptanceCriteria: ['Copy is approved'],
        dependencyIds: [dependency.id],
        startDate: '2026-10-01',
        targetDate: '2026-10-05',
        assigneeId: null,
        estimate: 2.5,
        parentWorkItemId: parent.id,
        subtaskPhaseNumber: 2,
        subtaskPhaseName: 'Review'
      })
      expect(response.status).toBe(200)
      const body = await json<{ ok: boolean; value: Record<string, unknown> }>(response)
      expect(body.value).toMatchObject({
        title: 'Review the page',
        milestoneId: milestone.id,
        priority: 'high',
        labels: ['review'],
        acceptanceCriteria: ['Copy is approved'],
        dependencyIds: [dependency.id],
        startDate: '2026-10-01',
        targetDate: '2026-10-05',
        estimate: 2.5,
        parentWorkItemId: parent.id,
        subtaskPhaseNumber: 2,
        subtaskPhaseName: 'Review'
      })
    })

    it('refuses a start date after the due date on the create route with the app wording', async () => {
      const response = await call('POST', `/automation/${project.id}/work-items`, {
        title: 'Backwards',
        startDate: '2026-10-09',
        targetDate: '2026-10-01'
      })
      expect(response.status).toBe(400)
      const body = await json<{ ok: boolean; error: string }>(response)
      expect(body.error).toBe('The start date is after the due date')
      expect(planning.listWorkItems(project.id).map((item) => item.title)).not.toContain(
        'Backwards'
      )
    })

    it('creates a milestone with its success criteria', async () => {
      const response = await call('POST', `/automation/${project.id}/milestones`, {
        name: 'Sea trials',
        targetDate: '2026-09-30',
        successCriteria: ['The first trial completes without critical findings']
      })
      expect(response.status).toBe(200)
      const body = await json<{ ok: boolean; value: { successCriteria: string[] } }>(response)
      expect(body.value.successCriteria).toEqual([
        'The first trial completes without critical findings'
      ])
      expect(planning.listMilestones(project.id)[0].successCriteria).toEqual([
        'The first trial completes without critical findings'
      ])
    })

    it('creates a whole plan in one call, with subtasks, dependencies and a milestone', async () => {
      const milestone = planning.createMilestone(project.id, { name: 'Launch' })
      const response = await call('POST', `/automation/${project.id}/work-items/batch`, {
        items: [
          { ref: 'design', title: 'Design', milestoneId: milestone.id },
          { ref: 'build', title: 'Build', dependencyRefs: ['design'] },
          { ref: 'tests', title: 'Tests', parentRef: 'build' }
        ]
      })
      expect(response.status).toBe(200)
      const body = await json<{ ok: boolean; value: Array<{ id: string; title: string }> }>(
        response
      )
      expect(body.value.map((item) => item.title)).toEqual(['Design', 'Build', 'Tests'])
      const [design, build, tests] = body.value
      expect(planning.getWorkItem(build.id).dependencyIds).toEqual([design.id])
      expect(planning.getWorkItem(tests.id)).toMatchObject({
        parentWorkItemId: build.id,
        milestoneId: null
      })
      expect(planning.listWorkItems(project.id)).toHaveLength(3)
    })

    it('refuses a batch with one bad row and creates nothing, naming the row', async () => {
      const response = await call('POST', `/automation/${project.id}/work-items/batch`, {
        items: [
          { title: 'Fine' },
          { title: 'Backwards', startDate: '2026-10-09', targetDate: '2026-10-01' }
        ]
      })
      expect(response.status).toBe(400)
      expect(planning.listWorkItems(project.id)).toHaveLength(0)
    })

    it('checks a plan with ?dryRun=1 and writes nothing', async () => {
      const response = await call('POST', `/automation/${project.id}/work-items/batch?dryRun=1`, {
        items: [
          { ref: 'a', title: 'A', dependencyRefs: ['b'] },
          { ref: 'b', title: 'B', dependencyRefs: ['a'] }
        ]
      })
      expect(response.status).toBe(200)
      const body = await json<{
        ok: boolean
        value: { valid: boolean; errors: Array<{ index: number; message: string }> }
      }>(response)
      expect(body.value.valid).toBe(false)
      expect(body.value.errors.length).toBeGreaterThan(0)
      expect(planning.listWorkItems(project.id)).toHaveLength(0)
    })

    it('lists the plan route in /help with the batch rules', async () => {
      const response = await call('GET', `/automation/${project.id}/help`)
      const body = await json<{ value: { routes: Array<{ path: string; description: string }> } }>(
        response
      )
      const route = body.value.routes.find((entry) => entry.path === '/work-items/batch')
      expect(route?.description).toContain('one transaction')
    })
  })
})
