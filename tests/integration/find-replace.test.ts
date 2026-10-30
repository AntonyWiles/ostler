import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type { WatchedProject } from '../../src/shared/ostler-api'
import type { FindReplacePreview, FindReplaceResult } from '../../src/shared/planning/find-replace'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
const human = { kind: 'human' as const }

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({ id, name: id, addedAt: Date.now(), automationToken: token })
}

describe('automation-http-server.ts find and replace routes (N2.5)', () => {
  const root = useTempDir('ostler-automation-find-replace-')
  let projects: WatchedProject[]
  let planning: PlanningService
  let server: AutomationHttpServer

  beforeEach(async () => {
    projects = [watched('home-project', 'token-one'), watched('other-project', 'token-two')]
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
    route: string,
    body?: unknown,
    { method = 'POST', project = projects[0] } = {}
  ): Promise<{ status: number; ok: boolean; value: T; error?: string }> {
    const response = await fetch(`http://127.0.0.1:${PORT}/automation/${project.id}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${project.automationToken}`
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const json = (await response.json()) as { ok: boolean; value: T; error?: string }
    return { status: response.status, ...json }
  }

  it('previews and applies by match id, in this project only, keeping ticks', async () => {
    const item = planning.createWorkItem(
      'home-project',
      { title: 'Pay Acme', acceptanceCriteria: ['Acme invoice'] },
      human
    )
    planning.setChecklistItemChecked(item.id, 'Acme invoice', true, human)
    planning.createWorkItem('home-project', { title: 'Acmeville trip' }, human)
    const other = planning.createWorkItem('other-project', { title: 'Acme elsewhere' }, human)
    const body = { find: 'acme', replace: 'Apex', wholeWords: true }

    const preview = await call<FindReplacePreview>('/find-replace/preview', body)
    expect(preview.status).toBe(200)
    expect(preview.value.matches.map((m) => [m.field, m.taskTitle])).toEqual([
      ['title', 'Pay Acme'],
      ['checklist', 'Pay Acme']
    ])
    // Nothing changed yet.
    expect(planning.getWorkItem(item.id).title).toBe('Pay Acme')

    const applied = await call<FindReplaceResult>('/find-replace/apply', {
      ...body,
      matchIds: preview.value.matches.map((m) => m.id)
    })
    expect(applied.status).toBe(200)
    expect(applied.value.changed).toHaveLength(1)
    expect(planning.getWorkItem(item.id)).toMatchObject({
      title: 'Pay Apex',
      acceptanceCriteria: ['Apex invoice'],
      checkedCriteria: ['Apex invoice']
    })
    expect(planning.getWorkItem(other.id).title).toBe('Acme elsewhere')

    // Applying the same ids again finds nothing to change: they are reported.
    const again = await call<FindReplaceResult>('/find-replace/apply', {
      ...body,
      matchIds: preview.value.matches.map((m) => m.id)
    })
    expect(again.value.changed).toEqual([])
    expect(again.value.skipped).toHaveLength(2)
  })

  it('refuses a bad body, and is listed in the help', async () => {
    expect((await call('/find-replace/preview', { replace: 'x' })).status).toBe(400)
    expect((await call('/find-replace/apply', { find: 'a', replace: 'b' })).status).toBe(400)
    expect((await call('/find-replace/preview', undefined, { method: 'GET' })).status).toBe(404)
    const help = await call<{ routes: { path: string }[] }>('/help', undefined, { method: 'GET' })
    const paths = JSON.stringify(help.value)
    expect(paths).toContain('/find-replace/preview')
    expect(paths).toContain('/find-replace/apply')
  })
})
