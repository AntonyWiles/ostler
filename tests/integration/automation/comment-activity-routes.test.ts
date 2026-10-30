import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../../electron/services/automation-http-server'
import { PlanningService } from '../../../electron/services/planning-service'
import { BriefingService } from '../../../electron/services/briefing-service'
import type { WatchedProject } from '../../../src/shared/ostler-api'
import { useAutomationServer } from '../../helpers/automation-fixture'
import { createMigratedDatabase } from '../../helpers/database'
import { makeWatchedProject } from '../../helpers/projects'
import { useTempDir } from '../../helpers/temp-dir'

describe('automation-http-server.ts comment and activity routes (P5.2)', () => {
  const temp = useTempDir('ostler-automation-activity-')
  const http = useAutomationServer()
  let root: string
  let project: WatchedProject
  let planning: PlanningService
  let server: AutomationHttpServer

  beforeEach(async () => {
    root = temp()
    project = makeWatchedProject({
      id: 'activity-project',
      name: 'Activity',
      addedAt: Date.now(),
      automationToken: 'automation-token',
      estimateUnit: 'points'
    })
    const databasePath = await createMigratedDatabase(root)
    planning = new PlanningService(databasePath, () => [project.id, 'other-project'])
    server = new AutomationHttpServer(
      () => [project],
      path.join(root, 'runtime'),
      undefined,
      planning
    )
    await http.start(server, planning)
  })

  function call<T = unknown>(method: string, route: string, body?: unknown) {
    return http.route<T>(project.id, project.automationToken, method, route, body)
  }

  it('lists the comment and activity routes in /help', async () => {
    const help = await call<{ routes: Array<{ method: string; path: string }> }>('GET', '/help')
    for (const [method, route] of [
      ['GET', '/work-items/:workItemId/comments'],
      ['POST', '/work-items/:workItemId/comments'],
      ['PATCH', '/comments/:commentId'],
      ['DELETE', '/comments/:commentId'],
      ['POST', '/comments/:commentId/restore'],
      ['GET', '/work-items/:workItemId/activity'],
      ['GET', '/activity']
    ]) {
      expect(
        help.value.routes.some(
          (candidate) => candidate.method === method && candidate.path === route
        )
      ).toBe(true)
    }
  })

  it('writes, edits, deletes and restores comments as the automation API', async () => {
    const item = await call<{ id: string }>('POST', '/work-items', { title: 'Discuss' })
    const added = await call<{ id: string; authorKind: string; body: string }>(
      'POST',
      `/work-items/${item.value.id}/comments`,
      { body: 'First **note**' }
    )
    expect(added).toMatchObject({
      status: 200,
      value: { authorKind: 'automation', body: 'First **note**' }
    })

    const edited = await call('PATCH', `/comments/${added.value.id}`, { body: 'Edited note' })
    expect(edited.value).toMatchObject({ body: 'Edited note' })
    expect(await call('PATCH', `/comments/${added.value.id}`, { body: '  ' })).toMatchObject({
      status: 400,
      error: 'Write something first'
    })

    expect((await call('DELETE', `/comments/${added.value.id}`)).value).toMatchObject({
      deletedAt: expect.any(Number)
    })
    expect((await call<unknown[]>('GET', `/work-items/${item.value.id}/comments`)).value).toEqual(
      []
    )
    await call('POST', `/comments/${added.value.id}/restore`)
    expect(
      (await call<Array<{ body: string }>>('GET', `/work-items/${item.value.id}/comments`)).value
    ).toMatchObject([{ body: 'Edited note' }])

    expect(await call('PATCH', '/comments/missing', { body: 'x' })).toMatchObject({
      status: 400,
      error: 'Comment not found'
    })
  })

  it('returns task and project activity, with automation as the actor, paged', async () => {
    const item = await call<{ id: string }>('POST', '/work-items', { title: 'Track' })
    await call('PATCH', `/work-items/${item.value.id}`, { priority: 'high' })
    await call('POST', `/work-items/${item.value.id}/comments`, { body: 'Noted' })

    const activity = await call<{
      entries: Array<{ kind: string; actor: { kind: string; name: string }; summary: string }>
      nextBefore: string | null
    }>('GET', `/work-items/${item.value.id}/activity`)
    expect(activity.value.entries.map((entry) => entry.summary)).toEqual([
      'Automation API commented',
      'Automation API changed the priority from Medium to High',
      'Automation API created the task'
    ])
    expect(activity.value.entries.every((entry) => entry.actor.kind === 'automation')).toBe(true)

    const first = await call<{ entries: unknown[]; nextBefore: string }>(
      'GET',
      `/work-items/${item.value.id}/activity?limit=2`
    )
    expect(first.value.entries).toHaveLength(2)
    const rest = await call<{ entries: Array<{ summary: string }>; nextBefore: null }>(
      'GET',
      `/work-items/${item.value.id}/activity?limit=2&before=${encodeURIComponent(first.value.nextBefore)}`
    )
    expect(rest.value.entries.map((entry) => entry.summary)).toEqual([
      'Automation API created the task'
    ])

    const changesOnly = await call<{ entries: Array<{ kind: string }> }>(
      'GET',
      `/work-items/${item.value.id}/activity?filter=changes`
    )
    expect(changesOnly.value.entries.map((entry) => entry.kind)).toEqual(['change', 'change'])

    const projectFeed = await call<{ entries: Array<{ workItemTitle: string }> }>(
      'GET',
      '/activity'
    )
    expect(projectFeed.value.entries).toHaveLength(3)
    expect(projectFeed.value.entries[0].workItemTitle).toBe('Track')

    expect(await call('GET', '/activity?before=nope')).toMatchObject({
      status: 400,
      error: 'before is not a valid cursor'
    })
  })

  it('refuses a task from another project', async () => {
    const other = planning.createWorkItem(
      'other-project',
      { title: 'Not yours' },
      { kind: 'human' }
    )
    expect(await call('GET', `/work-items/${other.id}/activity`)).toMatchObject({
      status: 400,
      error: 'Planning work item belongs to another project'
    })
    expect(await call('POST', `/work-items/${other.id}/comments`, { body: 'x' })).toMatchObject({
      status: 400
    })
  })

  it('GET /briefing returns this project’s part of Since you were last here (N1.6)', async () => {
    const briefing = new BriefingService({
      db: planning.database,
      getProjects: () => [project, { ...project, id: 'other-project', name: 'Other' }],
      agentsOn: () => false,
      agentAttention: () => null
    })
    server.getBriefing = (target, since, until) =>
      briefing.build({ since, until, projectIds: [target.id] }).projects[0] ?? null
    const since = Date.now() - 1000
    const mine = planning.createWorkItem(project.id, { title: 'Mine' }, { kind: 'human' })
    planning.createWorkItem('other-project', { title: 'Not yours' }, { kind: 'agent' })

    const help = await call<{ routes: Array<{ method: string; path: string }> }>('GET', '/help')
    expect(help.value.routes).toContainEqual(
      expect.objectContaining({ method: 'GET', path: '/briefing' })
    )
    const read = await call<{
      since: number
      until: number
      project: {
        projectName: string
        added: Array<{ actor: string; count: number; tasks: unknown[] }>
      }
    }>('GET', `/briefing?since=${since}`)
    expect(read.status).toBe(200)
    expect(read.value.since).toBe(since)
    expect(read.value.project.projectName).toBe('Activity')
    expect(read.value.project.added).toEqual([
      { actor: 'person', name: null, count: 1, tasks: [{ id: mine.id, title: 'Mine' }] }
    ])
    expect((await call('GET', `/briefing?since=${Date.now() + 60_000}`)).value).toMatchObject({
      project: null
    })
    expect(await call('GET', '/briefing')).toMatchObject({ status: 400 })
    expect(await call('GET', '/briefing?since=yesterday')).toMatchObject({ status: 400 })
    expect(await call('POST', '/briefing?since=1')).toMatchObject({ status: 405 })
  })
})
