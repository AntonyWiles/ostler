import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../../electron/services/automation-http-server'
import { PlanningService } from '../../../electron/services/planning-service'
import { LibraryService } from '../../../electron/services/library-service'
import type { WatchedProject } from '../../../src/shared/ostler-api'
import { useAutomationServer } from '../../helpers/automation-fixture'
import { createMigratedDatabase } from '../../helpers/database'
import { makeWatchedProject } from '../../helpers/projects'
import { useTempDir } from '../../helpers/temp-dir'

describe('automation-http-server.ts Library routes with whiteboards (whiteboards plan, 18b)', () => {
  const temp = useTempDir('ostler-automation-whiteboards-')
  const http = useAutomationServer()
  let root: string
  let planning: PlanningService
  let library: LibraryService
  let server: AutomationHttpServer
  const project: WatchedProject = makeWatchedProject({
    id: '0f8fad5b-d9cb-469f-a165-70867728950e',
    name: 'Garden',
    automationToken: 'whiteboard-token',
    estimateUnit: 'hours'
  })

  beforeEach(async () => {
    root = temp()
    const dbPath = await createMigratedDatabase(root)
    planning = new PlanningService(dbPath, () => [project.id])
    library = new LibraryService(dbPath, root)
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
      { service: library, notify: () => {} }
    )
    await http.start(server, planning, library)
  })

  function call<T = unknown>(method: string, route: string, body?: unknown) {
    return http.route<T>(project.id, project.automationToken, method, route, body)
  }

  function board() {
    return library.whiteboards.create(project.id, {
      title: 'Garden plan',
      objects: [
        { id: 'n1', kind: 'note', x: 0, y: 0, width: 200, height: 200, z: 0, text: 'Dig the beds' }
      ] as never
    }).item
  }

  it('lists a whiteboard and gives its outline as text', async () => {
    const item = board()
    library.createItem(project.id, { kind: 'note', title: 'Not a board' })

    const listed = await call<Array<{ id: string; kind: string; body: string }>>(
      'GET',
      '/library?kind=whiteboard'
    )
    expect(listed.ok).toBe(true)
    expect(listed.value.map((entry) => entry.id)).toEqual([item.id])
    expect(listed.value[0].kind).toBe('whiteboard')
    expect(listed.value[0].body).toBe(item.body)

    const one = await call<{ kind: string; text: string }>('GET', `/library/${item.id}`)
    expect(one.ok).toBe(true)
    expect(one.value.kind).toBe('whiteboard')
    expect(one.value.text).toBe(item.body)
    expect(one.value.text).toContain('Dig the beds')

    const file = await call('GET', `/library/${item.id}/file`)
    expect(file.status).toBe(404)
  })

  it("refuses a whiteboard's body and edits its other fields", async () => {
    const item = board()

    const body = await call('PATCH', `/library/${item.id}`, { body: 'Hand-written' })
    expect(body.ok).toBe(false)
    expect(body.status).toBeGreaterThanOrEqual(400)
    expect(library.getItem(project.id, item.id).body).toBe(item.body)

    const title = await call<{ title: string; body: string }>('PATCH', `/library/${item.id}`, {
      title: 'Vegetable garden'
    })
    expect(title.ok).toBe(true)
    expect(title.value.title).toBe('Vegetable garden')
    expect(title.value.body).toBe(item.body)
  })

  it('refuses to create a whiteboard', async () => {
    const created = await call('POST', '/library', { kind: 'whiteboard', title: 'New board' })
    expect(created.ok).toBe(false)
    expect(created.status).toBeGreaterThanOrEqual(400)
    expect(library.listItems(project.id, {})).toEqual([])
  })

  it('takes project labels on Library items, filters by them and renames them with /labels', async () => {
    const created = await call<{ id: string; tags: string[]; labels: string[] }>(
      'POST',
      '/library',
      { kind: 'note', title: 'Site notes', labels: ['site visit'] }
    )
    expect(created.value).toMatchObject({ tags: ['site visit'], labels: ['site visit'] })
    const patched = await call<{ labels: string[] }>('PATCH', `/library/${created.value.id}`, {
      labels: ['site visit', 'boiler']
    })
    expect(patched.value.labels).toEqual(['site visit', 'boiler'])

    const filtered = await call<Array<{ id: string }>>('GET', '/library?label=boiler')
    expect(filtered.value.map((entry) => entry.id)).toEqual([created.value.id])

    const labels = await call<Array<{ name: string; libraryItemCount: number }>>('GET', '/labels')
    expect(labels.value.map((label) => [label.name, label.libraryItemCount])).toEqual([
      ['boiler', 1],
      ['site visit', 1]
    ])

    await call('PATCH', '/labels/boiler', { name: 'heating' })
    expect(library.getItem(project.id, created.value.id).tags).toEqual(['site visit', 'heating'])
    await call('DELETE', `/labels/${encodeURIComponent('site visit')}`)
    expect(library.getItem(project.id, created.value.id).tags).toEqual(['heating'])
  })
})
