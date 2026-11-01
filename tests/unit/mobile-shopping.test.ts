import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditDb } from '../../mobile/src/data/edits'
import type { QueryDb } from '../../mobile/src/data/queries'
import { useTempDir } from '../helpers/temp-dir'

const { PlanningService } = await import('../../electron/services/planning-service')
const { createMigratedDatabase } = await import('../helpers/database')
const shopping = await import('../../mobile/src/data/shopping')

// The phone's shopping list runs the desktop's own ShoppingService and CostService.

const PROJECT = 'p1'

describe('the shopping list on the phone', () => {
  const tempDir = useTempDir('ostler-mobile-shopping-')
  let db: Database.Database

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 16, 10, 0))
    const path = await createMigratedDatabase(tempDir())
    const planning = new PlanningService(path, () => [PROJECT])
    planning.createWorkItem(PROJECT, { title: 'Fit shelves' }, { kind: 'human' })
    planning.close()
    db = new Database(path)
    db.prepare(
      "INSERT INTO project_budgets (project_id, amount, currency, updated_at) VALUES (?, NULL, 'GBP', 1)"
    ).run(PROJECT)
  })

  afterEach(() => {
    db.close()
    vi.useRealTimers()
  })

  const phone = () => db as unknown as EditDb & QueryDb

  it('reads a line, buys at the estimate as a paid cost, and unbuys with Undo', () => {
    const item = shopping.addShoppingLine(phone(), PROJECT, '3 packs wall plugs £4.50')
    expect(item).toMatchObject({ name: 'wall plugs', quantity: 3, unit: 'packs', estimate: 450 })
    expect(shopping.shoppingList(phone(), PROJECT)).toMatchObject({
      currency: 'GBP',
      stillToBuy: 450
    })

    const bought = shopping.buyShoppingItem(phone(), PROJECT, item.id)
    expect(bought).toMatchObject({ pricePaid: 450, boughtOn: '2026-10-16' })
    const costs = db.prepare('SELECT amount, state FROM costs WHERE project_id = ?').all(PROJECT)
    expect(costs).toEqual([{ amount: 450, state: 'paid' }])

    const cost = shopping.unbuyShoppingItem(phone(), PROJECT, item.id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM costs').get()).toEqual({ n: 0 })
    shopping.rebuyShoppingItem(phone(), PROJECT, item.id, cost)
    expect(shopping.shoppingList(phone(), PROJECT).items[0].costId).toBe(cost.id)
  })

  it('deletes an item and brings it back', () => {
    const item = shopping.addShoppingLine(phone(), PROJECT, 'Screws')
    const gone = shopping.deleteShoppingItem(phone(), PROJECT, item.id)
    expect(shopping.shoppingList(phone(), PROJECT).items).toEqual([])
    shopping.restoreShoppingItem(phone(), PROJECT, gone)
    expect(shopping.shoppingList(phone(), PROJECT).items.map((i) => i.name)).toEqual(['Screws'])
  })
})
