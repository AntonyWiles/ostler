import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type { PlanningWorkItem, WatchedProject } from '../../src/shared/ostler-api'
import type { Contact, DeletedContact, TaskContact } from '../../src/shared/contacts'
import { createMigratedDatabase } from '../helpers/database'
import { startOnFreePort } from '../helpers/http-port'
import { makeWatchedProject } from '../helpers/projects'
import { useTempDir } from '../helpers/temp-dir'

let PORT = 0
const PROJECT = '7a1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d'
const OTHER = '3a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d'

function watched(id: string, token: string): WatchedProject {
  return makeWatchedProject({
    id,
    name: id === PROJECT ? 'Wedding' : 'Garden',
    automationToken: token
  })
}

describe('contacts over the automation API (N6.5)', () => {
  const root = useTempDir('ostler-contacts-http-')
  let planning: PlanningService
  let server: AutomationHttpServer
  let project: WatchedProject
  let other: WatchedProject
  let taskId: string
  let otherTaskId: string
  let changes: number

  beforeEach(async () => {
    project = watched(PROJECT, 'token-one')
    other = watched(OTHER, 'token-two')
    const dbPath = await createMigratedDatabase(root())
    planning = new PlanningService(dbPath, () => [project.id, other.id])
    taskId = planning.createWorkItem(PROJECT, { title: 'Book the flowers' }, { kind: 'human' }).id
    otherTaskId = planning.createWorkItem(OTHER, { title: 'Dig' }, { kind: 'human' }).id
    server = new AutomationHttpServer(
      () => [project, other],
      path.join(root(), 'runtime'),
      undefined,
      planning
    )
    changes = 0
    server.contactsChanged = () => {
      changes += 1
    }
    PORT = await startOnFreePort((port) => server.start(port))
  })

  afterEach(() => {
    server?.stop()
    planning?.close()
  })

  function call(method: string, urlPath: string, body?: unknown, token = 'token-one') {
    const id = token === 'token-one' ? project.id : other.id
    return fetch(`http://127.0.0.1:${PORT}/automation/${id}${urlPath}`, {
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

  async function error(response: Response): Promise<string> {
    const body = (await response.json()) as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    return body.error
  }

  it('describes the routes in help', async () => {
    const help = await value<{ routes: { method: string; path: string }[] }>(
      await call('GET', '/help')
    )
    const routes = help.routes.map((route) => `${route.method} ${route.path}`)
    for (const route of [
      'GET /contacts',
      'POST /contacts',
      'PATCH /contacts/:contactId',
      'DELETE /contacts/:contactId',
      'GET /work-items/:workItemId/contacts',
      'POST /work-items/:workItemId/contacts',
      'DELETE /work-items/:workItemId/contacts/:linkId'
    ])
      expect(routes).toContain(route)
  })

  it('adds, finds, changes and deletes contacts, shared by every project’s token', async () => {
    const rosa = await value<Contact>(
      await call('POST', '/contacts', {
        name: 'Rosa Bloom',
        organisation: 'Bloom & Co',
        phones: [{ label: 'Mobile', number: '+44 7700 900123' }],
        emails: ['rosa@bloom.example']
      })
    )
    expect(rosa.name).toBe('Rosa Bloom')
    expect(changes).toBe(1)
    await call('POST', '/contacts', { name: 'Adam Plumb' }, 'token-two')

    const all = await value<Contact[]>(await call('GET', '/contacts', undefined, 'token-two'))
    expect(all.map((contact) => contact.name)).toEqual(['Adam Plumb', 'Rosa Bloom'])
    const found = await value<Contact[]>(await call('GET', '/contacts?q=bloom'))
    expect(found.map((contact) => contact.id)).toEqual([rosa.id])

    const changed = await value<Contact>(
      await call('PATCH', `/contacts/${rosa.id}`, { role: 'Florist' })
    )
    expect(changed).toMatchObject({ role: 'Florist', organisation: 'Bloom & Co' })
    expect(await error(await call('POST', '/contacts', { name: '' }))).toMatch(/needs a name/)
    expect(await error(await call('PATCH', '/contacts/missing', { name: 'X' }))).toMatch(
      /not found/
    )

    const deleted = await value<DeletedContact>(await call('DELETE', `/contacts/${rosa.id}`))
    expect(deleted.contact.id).toBe(rosa.id)
    expect((await value<Contact[]>(await call('GET', '/contacts'))).map((c) => c.name)).toEqual([
      'Adam Plumb'
    ])
  })

  it("names contacts on the token's project's tasks, filters by them, and removes them", async () => {
    const rosa = await value<Contact>(await call('POST', '/contacts', { name: 'Rosa Bloom' }))
    const link = await value<TaskContact>(
      await call('POST', `/work-items/${taskId}/contacts`, { contactId: rosa.id, role: 'supplier' })
    )
    expect(link).toMatchObject({
      contactId: rosa.id,
      role: 'supplier',
      contact: { name: 'Rosa Bloom' }
    })
    expect(
      await error(
        await call('POST', `/work-items/${taskId}/contacts`, {
          contactId: rosa.id,
          role: 'supplier'
        })
      )
    ).toMatch(/already names/)
    expect(
      await error(
        await call('POST', `/work-items/${taskId}/contacts`, { contactId: rosa.id, role: 'boss' })
      )
    ).toMatch(/asked-for-it/)
    // Another project's task is out of this token's reach.
    expect(
      await error(
        await call('POST', `/work-items/${otherTaskId}/contacts`, {
          contactId: rosa.id,
          role: 'other'
        })
      )
    ).toMatch(/another project/)

    const listed = await value<TaskContact[]>(await call('GET', `/work-items/${taskId}/contacts`))
    expect(listed.map((entry) => entry.id)).toEqual([link.id])

    const filter = encodeURIComponent(
      JSON.stringify({
        conditions: [{ field: 'contact', op: 'hasAny', value: [`${rosa.id}:supplier`] }]
      })
    )
    const filtered = await value<PlanningWorkItem[]>(
      await call('GET', `/work-items?filter=${filter}`)
    )
    expect(filtered.map((item) => item.id)).toEqual([taskId])

    await value(await call('DELETE', `/work-items/${taskId}/contacts/${link.id}`))
    expect(await value<TaskContact[]>(await call('GET', `/work-items/${taskId}/contacts`))).toEqual(
      []
    )
    expect(await error(await call('DELETE', `/work-items/${taskId}/contacts/${link.id}`))).toMatch(
      /no longer on this task/
    )
  })

  it('never returns contacts from the project-scoped search', async () => {
    await call('POST', '/contacts', { name: 'Rosa Bloom' })
    const results = await value<unknown[]>(await call('GET', '/search?q=Rosa'))
    expect(results).toEqual([])
  })
})
