import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import { LibraryService } from '../../electron/services/library-service'
import type { LinkedFromEntry, WatchedProject } from '../../src/shared/ostler-api'
import { BRAND } from '../../src/shared/brand'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
const PROJECT = '0f8fad5b-d9cb-469f-a165-70867728950e'
const OTHER = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed'

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id === PROJECT ? 'Website' : 'Garden',
    automationToken: token,
    estimateUnit: 'hours'
  })
}

describe('backlinks over the automation API (N4.4a)', () => {
  const root = useTempDir('ostler-item-links-http-')
  let planning: PlanningService
  let library: LibraryService
  let server: AutomationHttpServer
  const project = watched(PROJECT, 'token-one')
  const other = watched(OTHER, 'token-two')
  const human = { kind: 'human' as const }
  const link = (kind: string, id: string, projectId = PROJECT) =>
    `[x](${BRAND.urlScheme}://${kind}/${projectId}/${id})`

  beforeEach(async () => {
    const dbPath = await createMigratedDatabase(root())
    planning = new PlanningService(dbPath, () => [project.id, other.id])
    library = new LibraryService(dbPath, root())
    server = new AutomationHttpServer(
      () => [project, other],
      path.join(root(), 'runtime'),
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
      { service: library, notify: () => {} }
    )
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
    planning?.close()
    library?.close()
  })

  function call(method: string, urlPath: string, body?: unknown, token = 'token-one') {
    return fetch(`http://127.0.0.1:${PORT}/automation/${project.id}${urlPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }

  async function value<T>(response: Response): Promise<T> {
    const body = (await response.json()) as { ok: boolean; value: T; error?: string }
    if (!body.ok) throw new Error(body.error)
    return body.value
  }

  it('describes GET /links in help', async () => {
    const help = await value<{ routes: { method: string; path: string; description: string }[] }>(
      await call('GET', '/help?full=1')
    )
    expect(help.routes.map((route) => `${route.method} ${route.path}`)).toContain('GET /links')
    for (const path of ['/work-items', '/milestones', '/library', '/library/:itemId']) {
      const route = help.routes.find((entry) => entry.method === 'GET' && entry.path === path)
      expect(route?.description, path).toContain('?include=linkedFrom')
    }
  })

  it('lists what links to an item, from text written through the API', async () => {
    const target = planning.createWorkItem(project.id, { title: 'Fix the header' }, human)
    const milestone = planning.createMilestone(project.id, { name: 'Launch' })
    const decision = planning.createDecision(project.id, { title: 'Supplier', decision: 'Yes' })

    // Writing a link is writing text, as ever.
    const created = await value<{ id: string }>(
      await call('POST', '/work-items', {
        title: 'Plan',
        description: `${link('task', target.id)} ${link('milestone', milestone.id)}`
      })
    )
    await value(
      await call('POST', `/work-items/${target.id}/comments`, {
        body: `See ${link('decision', decision.id)}`
      })
    )
    const note = await value<{ id: string }>(
      await call('POST', '/library', {
        kind: 'note',
        title: 'Meeting',
        body: link('task', target.id)
      })
    )

    const toTask = await value<LinkedFromEntry[]>(await call('GET', `/links?to=task:${target.id}`))
    expect(toTask.map((entry) => [entry.sourceKind, entry.sourceId, entry.title])).toEqual([
      ['library', note.id, 'Meeting'],
      ['task', created.id, 'Plan']
    ])
    const toDecision = await value<LinkedFromEntry[]>(
      await call('GET', `/links?to=decision:${decision.id}`)
    )
    expect(toDecision).toMatchObject([
      { sourceKind: 'comment', title: 'Fix the header', workItemId: target.id }
    ])

    const items = await value<{ id: string; linkedFrom?: LinkedFromEntry[] }[]>(
      await call('GET', '/work-items?include=linkedFrom')
    )
    expect(items.find((item) => item.id === target.id)?.linkedFrom).toHaveLength(2)
    expect(items.find((item) => item.id === created.id)?.linkedFrom).toEqual([])
    const plain = await value<{ id: string; linkedFrom?: unknown }[]>(
      await call('GET', '/work-items')
    )
    expect(plain[0].linkedFrom).toBeUndefined()

    const milestones = await value<{ id: string; linkedFrom: LinkedFromEntry[] }[]>(
      await call('GET', '/milestones?include=linkedFrom')
    )
    expect(milestones[0].linkedFrom.map((entry) => entry.sourceId)).toEqual([created.id])

    const libraryItem = await value<{ linkedFrom: LinkedFromEntry[] }>(
      await call('GET', `/library/${note.id}?include=linkedFrom`)
    )
    expect(libraryItem.linkedFrom).toEqual([])
    const libraryList = await value<{ linkedFrom: LinkedFromEntry[] }[]>(
      await call('GET', '/library?include=linkedFrom')
    )
    expect(libraryList).toHaveLength(1)
    expect(libraryList[0].linkedFrom).toEqual([])
  })

  it("refuses another project's item and a malformed target", async () => {
    const theirs = planning.createWorkItem(other.id, { title: 'Theirs' }, human)
    expect((await call('GET', `/links?to=task:${theirs.id}`)).status).toBe(400)
    expect((await call('GET', '/links?to=goal:abc')).status).toBe(400)
    expect((await call('GET', '/links')).status).toBe(400)
  })
})
