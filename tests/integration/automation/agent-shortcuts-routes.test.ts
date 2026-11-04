import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../../electron/services/automation-http-server'
import { LibraryService } from '../../../electron/services/library-service'
import { PlanningService } from '../../../electron/services/planning-service'
import type { PlanningWorkItem, WatchedProject } from '../../../src/shared/ostler-api'
import { useAutomationServer } from '../../helpers/automation-fixture'
import { createMigratedDatabase } from '../../helpers/database'
import { makeWatchedProject } from '../../helpers/projects'
import { useTempDir } from '../../helpers/temp-dir'

describe('automation-http-server.ts short help, task IDs, batch changes, Blocked reasons, attachments', () => {
  const temp = useTempDir('ostler-automation-shortcuts-')
  const http = useAutomationServer()
  let planning: PlanningService
  let library: LibraryService
  const project: WatchedProject = makeWatchedProject({
    id: '6f1c2b0e-5a43-4c1e-9d3a-2b7e8f0a1c55',
    name: 'Bakery',
    automationToken: 'shortcuts-token',
    taskPrefix: 'BAK'
  })

  beforeEach(async () => {
    const root = temp()
    const dbPath = await createMigratedDatabase(root)
    planning = new PlanningService(
      dbPath,
      () => [project.id],
      undefined,
      () => 'BAK'
    )
    library = new LibraryService(dbPath, root)
    const server = new AutomationHttpServer(
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

  async function task(title: string, extra: Record<string, unknown> = {}) {
    const made = await call<PlanningWorkItem>('POST', '/work-items', { title, ...extra })
    expect(made.status).toBe(200)
    return made.value
  }

  it('answers GET /help in one line per route, and in full for one route or all', async () => {
    const short = await call<{
      conventions: string[]
      routes: Array<{ method: string; path: string; summary: string; description?: string }>
    }>('GET', '/help')
    expect(short.ok).toBe(true)
    expect(short.value.conventions.length).toBeGreaterThan(0)
    expect(short.value.routes.every((route) => route.description === undefined)).toBe(true)
    expect(short.value.routes.every((route) => route.summary.length <= 140)).toBe(true)
    const full = await call<{ routes: unknown[] }>('GET', '/help?full=1')
    expect(JSON.stringify(short.value).length).toBeLessThan(JSON.stringify(full.value).length / 3)

    const one = await call<{ routes: Array<{ method: string; request?: string }> }>(
      'GET',
      '/help?route=/work-items/BAK-1&method=PATCH'
    )
    expect(one.value.routes).toHaveLength(1)
    expect(one.value.routes[0]!.request).toContain('moveDependents')

    const found = await call<{ routes: Array<{ path: string }> }>('GET', '/help?q=attachments')
    expect(found.value.routes.map((route) => route.path)).toContain(
      '/work-items/:workItemId/attachments'
    )
  })

  it('takes task IDs where routes and bodies take ids, and trims lists', async () => {
    const first = await task('Order flour')
    const second = await task('Bake bread', { dependencyIds: [first.key] })
    expect(second.dependencyIds).toEqual([first.id])

    const read = await call<PlanningWorkItem>('GET', `/work-items/${second.key!.toLowerCase()}`)
    expect(read.value.id).toBe(second.id)
    expect((await call<PlanningWorkItem>('GET', `/work-items/${second.id}`)).value.key).toBe(
      second.key
    )
    const patched = await call<PlanningWorkItem>('PATCH', `/work-items/${first.key}`, {
      status: 'done'
    })
    expect(patched.value.status).toBe('done')
    expect((await call('PATCH', '/work-items/BAK-999', { status: 'done' })).status).toBe(404)

    const listed = await call<Array<Record<string, unknown>>>(
      'GET',
      '/work-items?status=done&fields=key,title'
    )
    expect(listed.value).toEqual([{ id: first.id, key: first.key, title: 'Order flour' }])
    expect((await call('GET', '/work-items?status=finished')).status).toBe(400)
  })

  it('changes many tasks in one transaction, or none', async () => {
    const a = await task('Proof dough')
    const b = await task('Shape loaves')
    const done = await call<PlanningWorkItem[]>('PATCH', '/work-items/batch', {
      items: [
        { id: a.key, status: 'done' },
        { id: b.id, priority: 'high' }
      ]
    })
    expect(done.status).toBe(200)
    expect(done.value.map((item) => [item.status, item.priority])).toEqual([
      ['done', 'medium'],
      ['backlog', 'high']
    ])

    const refused = await call('PATCH', '/work-items/batch', {
      items: [
        { id: b.key, title: 'Shape the loaves' },
        { id: a.key, priority: 'urgent' }
      ]
    })
    expect(refused.status).toBe(400)
    expect(refused.error).toContain('items[1]')
    expect(planning.getWorkItem(b.id).title).toBe('Shape loaves')
  })

  it('keeps a blocked reason while the task is blocked, and says when nothing is left to wait on', async () => {
    const supplier = await task('Hear back from the supplier')
    const blocked = await task('Price the menu', {
      status: 'blocked',
      blockedReason: 'Waiting on BAK-1',
      dependencyIds: [supplier.key]
    })
    expect(blocked.blockedReason).toBe('Waiting on BAK-1')
    expect((await task('Not blocked', { blockedReason: 'Ignored' })).blockedReason).toBe('')

    let list = await call<Array<{ key: string; clear: boolean; blockedReason: string }>>(
      'GET',
      '/blocked'
    )
    expect(list.value).toEqual([
      expect.objectContaining({ key: blocked.key, clear: false, blockedReason: 'Waiting on BAK-1' })
    ])
    await call('PATCH', `/work-items/${supplier.key}`, { status: 'done' })
    list = await call('GET', '/blocked')
    expect(list.value[0]!.clear).toBe(true)

    const moved = await call<PlanningWorkItem>('PATCH', `/work-items/${blocked.key}`, {
      status: 'ready'
    })
    expect(moved.value.blockedReason).toBe('')
  })

  it('keeps links to this computer as text in descriptions and comments', async () => {
    const item = await task('Check the shop page', {
      description: 'See [Risk & spend](http://localhost:8513/risk) and http://127.0.0.1:3000/x.'
    })
    expect(item.description).toBe(
      'See Risk & spend (`http://localhost:8513/risk`) and `http://127.0.0.1:3000/x`.'
    )
    const comment = await call<{ body: string }>('POST', `/work-items/${item.key}/comments`, {
      body: '<http://localhost:5173/>'
    })
    expect(comment.value.body).toBe('`http://localhost:5173/`')
  })

  it('uploads a file and attaches it to a task in one call', async () => {
    const item = await task('Write the recipe card')
    const attached = await call<
      Array<{ item: { id: string; title: string; kind: string }; attachedBy: string }>
    >('POST', `/work-items/${item.key}/attachments`, {
      fileName: 'recipe.md',
      mimeType: 'text/markdown',
      base64: Buffer.from('# Sourdough\n').toString('base64')
    })
    expect(attached.status).toBe(200)
    expect(attached.value).toHaveLength(1)
    expect(attached.value[0]!.attachedBy).toBe('automation')
    expect(attached.value[0]!.item.kind).toBe('document')
    const listed = await call<Array<{ item: { id: string } }>>(
      'GET',
      `/work-items/${item.key}/attachments`
    )
    expect(listed.value.map((entry) => entry.item.id)).toEqual([attached.value[0]!.item.id])
    expect(
      (await call('POST', `/work-items/${item.key}/attachments`, { fileName: 'x.md' })).status
    ).toBe(400)
  })
})
