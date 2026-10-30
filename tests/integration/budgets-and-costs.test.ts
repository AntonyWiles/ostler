import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type { WatchedProject } from '../../src/shared/ostler-api'
import type { Cost, MoneySummary, ProjectBudget } from '../../src/shared/money'
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
    name: id === PROJECT ? 'Wedding' : 'Garden',
    automationToken: token
  })
}

describe('budgets and costs over the automation API (N6.3a)', () => {
  const root = useTempDir('ostler-costs-http-')
  let planning: PlanningService
  let server: AutomationHttpServer
  let project: WatchedProject
  let other: WatchedProject

  beforeEach(async () => {
    project = watched(PROJECT, 'token-one')
    other = watched(OTHER, 'token-two')
    const dbPath = await createMigratedDatabase(root())
    planning = new PlanningService(dbPath, () => [project.id, other.id])
    server = new AutomationHttpServer(
      () => [project, other],
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

  it('describes the routes in help', async () => {
    const help = await value<{ routes: { method: string; path: string }[] }>(
      await call('GET', '/help')
    )
    const routes = help.routes.map((route) => `${route.method} ${route.path}`)
    for (const route of [
      'GET /budget',
      'PUT /budget',
      'GET /costs',
      'POST /costs',
      'PATCH /costs/:costId',
      'DELETE /costs/:costId'
    ])
      expect(routes).toContain(route)
  })

  it('reads and sets the budget, with the summary, and refuses a bad one', async () => {
    const empty = await value<ProjectBudget & { summary: MoneySummary }>(
      await call('GET', '/budget')
    )
    expect(empty.amount).toBeNull()
    expect(empty.currency).toMatch(/^[A-Z]{3}$/)
    const set = await value<ProjectBudget & { summary: MoneySummary }>(
      await call('PUT', '/budget', { amount: 500_000, currency: 'GBP' })
    )
    expect(set).toMatchObject({ amount: 500_000, currency: 'GBP', summary: { left: 500_000 } })
    expect((await call('PUT', '/budget', { amount: 'lots' })).status).toBe(400)
    expect((await call('PUT', '/budget', { currency: 'XYZW' })).status).toBe(400)
    // Another project's budget is its own.
    expect(
      (await value<ProjectBudget>(await call('GET', '/budget', undefined, 'token-two'))).amount
    ).toBeNull()
  })

  it('adds, filters, marks paid and deletes costs', async () => {
    await call('PUT', '/budget', { amount: 100_000, currency: 'GBP' })
    const deposit = await value<Cost>(
      await call('POST', '/costs', {
        date: '2026-11-01',
        amount: 60_000,
        description: 'Hall deposit',
        category: 'Venue'
      })
    )
    expect(deposit).toMatchObject({ state: 'planned', category: 'Venue' })
    await call('POST', '/costs', {
      date: '2026-10-20',
      amount: 55_000,
      description: 'Catering',
      category: 'Food',
      state: 'paid'
    })
    expect((await call('POST', '/costs', { date: '2026-10-20', amount: 1 })).status).toBe(400)

    const all = await value<Cost[]>(await call('GET', '/costs'))
    expect(all.map((cost) => cost.description)).toEqual(['Catering', 'Hall deposit'])
    expect(await value<Cost[]>(await call('GET', '/costs?state=paid'))).toHaveLength(1)
    expect(await value<Cost[]>(await call('GET', '/costs?category=Venue'))).toHaveLength(1)
    expect((await call('GET', '/costs?state=owed')).status).toBe(400)

    const paid = await value<Cost>(
      await call('PATCH', `/costs/${deposit.id}`, { state: 'paid', amount: 58_000 })
    )
    expect(paid).toMatchObject({ state: 'paid', amount: 58_000 })
    const budget = await value<{ summary: MoneySummary }>(await call('GET', '/budget'))
    expect(budget.summary).toMatchObject({ paid: 113_000, planned: 0, over: 13_000 })

    // Another project cannot reach this one's cost.
    expect((await call('DELETE', `/costs/${deposit.id}`, undefined, 'token-two')).status).toBe(400)
    await value<Cost>(await call('DELETE', `/costs/${deposit.id}`))
    expect(await value<Cost[]>(await call('GET', '/costs'))).toHaveLength(1)
  })

  it('returns the CSV the app writes', async () => {
    await call('PUT', '/budget', { currency: 'JPY' })
    await call('POST', '/costs', {
      date: '2026-11-01',
      amount: 15_000,
      description: 'Hall, deposit',
      category: 'Venue'
    })
    const response = await call('GET', '/costs?format=csv')
    expect(response.headers.get('content-type')).toMatch(/text\/csv/)
    const bytes = Buffer.from(await response.arrayBuffer())
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(bytes.subarray(3).toString('utf8').split('\r\n')).toEqual([
      'Date,Description,Category,Task,Milestone,State,Amount,Currency',
      '2026-11-01,"Hall, deposit",Venue,,,Planned,15000,JPY',
      ''
    ])
  })
})
