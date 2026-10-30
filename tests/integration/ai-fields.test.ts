import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer, HELP_ROUTES } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type {
  PlanningFieldDefinition,
  PlanningWorkItem,
  WatchedProject
} from '../../src/shared/ostler-api'
import { aiFieldSourceHash } from '../../src/shared/planning/ai-fields'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({ id, name: id, addedAt: Date.now(), automationToken: token })
}

describe('automation-http-server.ts AI fields (N8.4)', () => {
  const root = useTempDir('ostler-automation-ai-fields-')
  let projects: WatchedProject[]
  let planning: PlanningService
  let server: AutomationHttpServer

  beforeEach(async () => {
    projects = [watched('home', 'token-home')]
    const databasePath = await createMigratedDatabase(root())
    planning = new PlanningService(databasePath, () => projects.map((project) => project.id))
    server = new AutomationHttpServer(
      () => projects,
      path.join(root(), 'runtime'),
      undefined,
      planning
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
    body?: unknown
  ): Promise<{ status: number; ok: boolean; value: T; error?: string }> {
    const project = projects[0]
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

  it('says how in HELP_ROUTES, and offers no way to fill', () => {
    const text = (method: string, route: string) => {
      const entry = HELP_ROUTES.find((item) => item.method === method && item.path === route)!
      return `${entry.description} ${entry.request ?? ''}`
    }
    expect(text('GET', '/fields')).toMatch(/aiInstruction/)
    expect(text('GET', '/fields')).toMatch(/fieldFills/)
    expect(text('GET', '/fields')).toMatch(/filledBy/)
    expect(text('POST', '/fields')).toMatch(/aiInstruction/)
    expect(text('PATCH', '/fields/:fieldId')).toMatch(/aiInstruction/)
    expect(
      HELP_ROUTES.some((route) => /^\/(fields|work-items)\b.*fill|ai-field/i.test(route.path))
    ).toBe(false)
  })

  it('reads and writes the instruction on /fields, refusing it on other types', async () => {
    const room = await call<PlanningFieldDefinition>('POST', '/fields', {
      name: 'Room',
      type: 'choice',
      options: [{ name: 'Kitchen' }],
      aiInstruction: 'Which room is this for?'
    })
    expect(room.status).toBe(200)
    expect(room.value.aiInstruction).toBe('Which room is this for?')
    const listed = await call<PlanningFieldDefinition[]>('GET', '/fields')
    expect(listed.value[0].aiInstruction).toBe('Which room is this for?')
    const cleared = await call<PlanningFieldDefinition>('PATCH', `/fields/${room.value.id}`, {
      aiInstruction: null
    })
    expect(cleared.value.aiInstruction).toBeNull()
    const refused = await call('POST', '/fields', {
      name: 'Count',
      type: 'number',
      aiInstruction: 'Guess'
    })
    expect(refused.status).toBe(400)
  })

  it('says who filled each value, and a value written here is the person’s', async () => {
    const summary = planning.createField('home', {
      name: 'Summary',
      type: 'text',
      aiInstruction: 'Summarise in one line'
    })
    const item = planning.createWorkItem('home', { title: 'Paint' }, { kind: 'human' })
    planning.applyAiFieldFills('home', summary.id, [
      { workItemId: item.id, value: 'Paint job', sourceHash: aiFieldSourceHash(item) }
    ])
    const listed = await call<PlanningWorkItem[]>('GET', '/work-items')
    const read = listed.value.find((entry) => entry.id === item.id)!
    expect(read.fieldValues?.[summary.id]).toBe('Paint job')
    expect(read.fieldFills?.[summary.id]).toEqual({
      filledBy: 'ostler-ai',
      sourceHash: aiFieldSourceHash(item)
    })
    const patched = await call<PlanningWorkItem>('PATCH', `/work-items/${item.id}`, {
      fieldValues: { [summary.id]: 'My words' }
    })
    expect(patched.value.fieldFills?.[summary.id]).toEqual({ filledBy: 'person', sourceHash: null })
  })
})
