import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutomationHttpServer } from '../../electron/services/automation-http-server'
import { PlanningService } from '../../electron/services/planning-service'
import type { WatchedProject } from '../../src/shared/ostler-api'
import type { Cost, MoneySummary } from '../../src/shared/money'
import type { ShoppingItem } from '../../src/shared/shopping'
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
    name: id === PROJECT ? 'Kitchen' : 'Garden',
    automationToken: token
  })
}

describe('the shopping list over the automation API (N6.3b)', () => {
  const root = useTempDir('ostler-shopping-http-')
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
      'GET /shopping',
      'POST /shopping',
      'PATCH /shopping/:itemId',
      'DELETE /shopping/:itemId',
      'POST /shopping/:itemId/bought',
      'DELETE /shopping/:itemId/bought'
    ])
      expect(routes).toContain(route)
  })

  it('adds, moves, edits and deletes items, and refuses bad ones', async () => {
    const plugs = await value<ShoppingItem>(
      await call('POST', '/shopping', { name: 'Wall plugs', quantity: 3, unit: 'packs' })
    )
    const paint = await value<ShoppingItem>(
      await call('POST', '/shopping', { name: 'Paint', estimate: 3000 })
    )
    expect(plugs).toMatchObject({ quantity: 3, unit: 'packs', estimate: null, costId: null })
    await value(await call('PATCH', `/shopping/${paint.id}`, { afterId: null, quantity: 2 }))
    const list = await value<ShoppingItem[]>(await call('GET', '/shopping'))
    expect(list.map((item) => [item.name, item.quantity])).toEqual([
      ['Paint', 2],
      ['Wall plugs', 3]
    ])
    expect((await call('POST', '/shopping', { quantity: 1 })).status).toBe(400)
    expect((await call('POST', '/shopping', { name: 'x', estimate: 1.5 })).status).toBe(400)
    expect((await call('PATCH', `/shopping/${paint.id}`, { afterId: 'nope' })).status).toBe(400)
    // Another project cannot reach this one's item.
    expect((await call('DELETE', `/shopping/${paint.id}`, undefined, 'token-two')).status).toBe(400)
    await value(await call('DELETE', `/shopping/${paint.id}`))
    expect(await value<ShoppingItem[]>(await call('GET', '/shopping'))).toHaveLength(1)
    expect((await call('GET', `/shopping/${plugs.id}/receipt`)).status).toBe(404)
  })

  it('ticks an item as bought with one paid cost, and unticks it', async () => {
    await value(await call('PUT', '/budget', { amount: 50_000, currency: 'GBP' }))
    const item = await value<ShoppingItem>(
      await call('POST', '/shopping', { name: 'Worktop', estimate: 15_000 })
    )
    await value(await call('POST', '/shopping', { name: 'Taps', estimate: 4000 }))
    let budget = await value<{ summary: MoneySummary }>(await call('GET', '/budget'))
    expect(budget.summary).toMatchObject({ paid: 0, planned: 0, stillToBuy: 19_000 })

    const bought = await value<{ item: ShoppingItem; cost: Cost }>(
      await call('POST', `/shopping/${item.id}/bought`, { pricePaid: 14_500, date: '2026-10-18' })
    )
    expect(bought.cost).toMatchObject({
      amount: 14_500,
      date: '2026-10-18',
      description: 'Worktop',
      category: 'Shopping',
      state: 'paid'
    })
    expect(bought.item).toMatchObject({ costId: bought.cost.id, pricePaid: 14_500 })
    expect(await value<Cost[]>(await call('GET', '/costs'))).toHaveLength(1)
    budget = await value<{ summary: MoneySummary }>(await call('GET', '/budget'))
    expect(budget.summary).toMatchObject({ paid: 14_500, total: 14_500, stillToBuy: 4000 })
    expect(
      (await call('POST', `/shopping/${item.id}/bought`, { pricePaid: 1, date: '2026-10-18' }))
        .status
    ).toBe(400)
    expect(
      (await call('POST', `/shopping/${item.id}/bought`, { pricePaid: 'lots', date: 'x' })).status
    ).toBe(400)

    const unbought = await value<{ item: ShoppingItem; cost: Cost }>(
      await call('DELETE', `/shopping/${item.id}/bought`)
    )
    expect(unbought.item.costId).toBeNull()
    expect(await value<Cost[]>(await call('GET', '/costs'))).toEqual([])

    // Deleting the cost unticks the item too.
    const again = await value<{ item: ShoppingItem; cost: Cost }>(
      await call('POST', `/shopping/${item.id}/bought`, { pricePaid: 14_000, date: '2026-10-18' })
    )
    await value(await call('DELETE', `/costs/${again.cost.id}`))
    const [after] = await value<ShoppingItem[]>(await call('GET', '/shopping'))
    expect(after).toMatchObject({ id: item.id, costId: null, pricePaid: null })
  })
})
