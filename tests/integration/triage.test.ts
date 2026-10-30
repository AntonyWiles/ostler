import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type {
  PlanningWorkItem,
  TriageMoveResult,
  WatchedProject
} from '../../src/shared/ostler-api'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

function watched(id: string, token: string, triageCaptures: boolean): WatchedProject {
  return {
    id,
    name: id,
    path: null,
    color: '#3b82f6',
    enabled: true,
    customIgnorePatterns: [],
    notes: '',
    tags: [],
    addedAt: Date.now(),
    lastActivity: null,
    automationToken: token,
    triageCaptures
  }
}

describe('automation-http-server.ts triage (N4.3a)', () => {
  const root = useTempDir('ostler-automation-triage-')
  let projects: WatchedProject[]
  let planning: PlanningService
  let server: AutomationHttpServer

  beforeEach(async () => {
    projects = [watched('home', 'token-home', true), watched('garden', 'token-garden', false)]
    const databasePath = await createMigratedDatabase(root())
    planning = new PlanningService(databasePath, () => projects.map((project) => project.id))
    planning.setTriageSetting(
      (projectId) => projects.find((project) => project.id === projectId)?.triageCaptures === true
    )
    server = new AutomationHttpServer(
      () => projects,
      path.join(root(), 'runtime'),
      undefined,
      planning
    )
    // The same save as Project settings, on this test's projects.
    server.triageSetting = {
      update: (projectId, enabled) => {
        projects = projects.map((project) =>
          project.id === projectId ? { ...project, triageCaptures: enabled } : project
        )
        return enabled
      }
    }
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
    projectIndex = 0
  ): Promise<{ status: number; ok: boolean; value: T; error?: string }> {
    const project = projects[projectIndex]
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

  const filtered = (inTriage: boolean) =>
    `/work-items?filter=${encodeURIComponent(
      JSON.stringify({ conditions: [{ field: 'inTriage', op: 'is', value: inTriage }] })
    )}`

  it('describes the triage routes in HELP_ROUTES', () => {
    const help = (method: string, route: string) =>
      HELP_ROUTES.filter((entry) => entry.method === method && entry.path === route)
        .map((entry) => `${entry.description} ${entry.request ?? ''}`)
        .join(' ')
    expect(help('POST', '/work-items')).toMatch(/triage: true/)
    expect(help('GET', '/work-items')).toMatch(/inTriage is true\|false|someday, inTriage/)
    expect(help('POST', '/work-items/:workItemId/accept')).toMatch(/To triage/)
    expect(help('POST', '/work-items/:workItemId/move')).toMatch(/projectId/)
    expect(help('GET', '/triage')).toMatch(/Triage new captures/)
    expect(help('PUT', '/triage')).toMatch(/acceptWaiting/)
  })

  it('creates into triage with triage: true when the project has it on, and filters', async () => {
    const waiting = await call<PlanningWorkItem>('POST', '/work-items', {
      title: 'Captured',
      triage: true
    })
    expect(waiting.status).toBe(200)
    expect(waiting.value).toMatchObject({ inTriage: true, capturedBy: 'api' })
    const plain = await call<PlanningWorkItem>('POST', '/work-items', { title: 'Plain' })
    expect(plain.value.inTriage).toBe(false)
    // capture is not the caller's to name: only triage: true asks.
    const named = await call<PlanningWorkItem>('POST', '/work-items', {
      title: 'Named',
      capture: 'snip'
    })
    expect(named.value.inTriage).toBe(false)

    const inTriage = await call<PlanningWorkItem[]>('GET', filtered(true))
    expect(inTriage.value.map((item) => item.title)).toEqual(['Captured'])
    const scoped = await call<PlanningWorkItem[]>('GET', '/work-items?scope=triage')
    expect(scoped.value.map((item) => item.title)).toEqual(['Captured'])
    const notInTriage = await call<PlanningWorkItem[]>('GET', filtered(false))
    expect(notInTriage.value.map((item) => item.title).sort()).toEqual(['Named', 'Plain'])

    const elsewhere = await call<PlanningWorkItem>(
      'POST',
      '/work-items',
      { title: 'Off', triage: true },
      1
    )
    expect(elsewhere.value.inTriage).toBe(false)
    const refused = await call('POST', '/work-items', { title: 'Bad', triage: 'yes' })
    expect(refused.status).toBe(400)
  })

  it('accepts with fields, and refuses a task not in triage', async () => {
    const waiting = await call<PlanningWorkItem>('POST', '/work-items', {
      title: 'Captured',
      triage: true
    })
    const accepted = await call<PlanningWorkItem>(
      'POST',
      `/work-items/${waiting.value.id}/accept`,
      { status: 'ready', priority: 'high' }
    )
    expect(accepted.status).toBe(200)
    expect(accepted.value).toMatchObject({ inTriage: false, status: 'ready', priority: 'high' })
    const again = await call('POST', `/work-items/${waiting.value.id}/accept`, {})
    expect(again.status).toBe(400)
    expect(again.error).toBe('This task is not in To triage')
    const other = await call<PlanningWorkItem>('POST', '/work-items', {
      title: 'Captured',
      triage: true
    })
    const bad = await call('POST', `/work-items/${other.value.id}/accept`, { title: 'No' })
    expect(bad.status).toBe(400)
  })

  it('moves a task in triage to another project, and still reorders with a placement', async () => {
    // Garden does not triage new captures: the task lands there as an ordinary task.
    const waiting = await call<PlanningWorkItem>('POST', '/work-items', {
      title: 'Wrong project',
      triage: true
    })
    const moved = await call<TriageMoveResult>('POST', `/work-items/${waiting.value.id}/move`, {
      projectId: 'garden'
    })
    expect(moved.status).toBe(200)
    expect(moved.value.workItem).toMatchObject({
      projectId: 'garden',
      title: 'Wrong project',
      status: 'backlog',
      inTriage: false
    })
    expect(moved.value.movedFromId).toBe(waiting.value.id)
    expect(planning.getWorkItem(waiting.value.id).deletedAt).not.toBeNull()
    const gardenTriage = await call<PlanningWorkItem[]>(
      'GET',
      '/work-items?scope=triage',
      undefined,
      1
    )
    expect(gardenTriage.value).toEqual([])

    // With triage on in Garden, the next one waits in its To triage.
    const turnedOn = await call('PUT', '/triage', { enabled: true }, 1)
    expect(turnedOn.status).toBe(200)
    const next = await call<PlanningWorkItem>('POST', '/work-items', {
      title: 'Also wrong',
      triage: true
    })
    const movedAgain = await call<TriageMoveResult>('POST', `/work-items/${next.value.id}/move`, {
      projectId: 'garden'
    })
    expect(movedAgain.value.workItem).toMatchObject({ projectId: 'garden', inTriage: true })
    const garden = await call<PlanningWorkItem[]>('GET', '/work-items?scope=triage', undefined, 1)
    expect(garden.value.map((item) => item.title)).toEqual(['Also wrong'])

    const plain = await call<PlanningWorkItem>('POST', '/work-items', { title: 'Plain' })
    const refused = await call('POST', `/work-items/${plain.value.id}/move`, {
      projectId: 'garden'
    })
    expect(refused.status).toBe(400)
    const reordered = await call('POST', `/work-items/${plain.value.id}/move`, {
      position: 'start'
    })
    expect(reordered.status).toBe(200)
  })

  it('clears the mark through Someday and Won’t do', async () => {
    const parked = await call<PlanningWorkItem>('POST', '/work-items', { title: 'A', triage: true })
    const closed = await call<PlanningWorkItem>('POST', '/work-items', { title: 'B', triage: true })
    const someday = await call<PlanningWorkItem>('PATCH', `/work-items/${parked.value.id}`, {
      someday: true
    })
    expect(someday.value).toMatchObject({ inTriage: false, someday: true })
    const wontDo = await call<{ workItem: PlanningWorkItem }>(
      'POST',
      `/work-items/${closed.value.id}/wont-do`,
      { reason: 'No' }
    )
    expect(wontDo.value.workItem).toMatchObject({ inTriage: false, resolution: 'wont-do' })
  })

  it('reads and sets the setting, asking before turning it off with tasks waiting', async () => {
    expect((await call('GET', '/triage')).value).toEqual({ enabled: true, waiting: 0 })
    await call('POST', '/work-items', { title: 'Waiting', triage: true })
    const refused = await call('PUT', '/triage', { enabled: false })
    expect(refused.status).toBe(400)
    expect(refused.error).toMatch(/acceptWaiting/)
    const off = await call('PUT', '/triage', { enabled: false, acceptWaiting: true })
    expect(off.value).toEqual({ enabled: false, waiting: 0, accepted: 1 })
    expect((await call('GET', '/triage')).value).toEqual({ enabled: false, waiting: 0 })
    expect((await call('PUT', '/triage', { enabled: 'on' })).status).toBe(400)
  })
})
