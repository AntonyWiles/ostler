/**
 * A project's shopping list on the phone: the desktop's own `ShoppingService` (with its
 * `CostService`) over the phone's database. Ticking an item bought makes a paid cost in the same
 * transaction, as on the PC, so the project's budget counts the purchase once.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type Database from 'better-sqlite3'
import type { Cost, CurrencyCode } from '@shared/money'
import { readShoppingLine, stillToBuy, type ShoppingItem } from '@shared/shopping'
import { CostService } from '../../../electron/services/cost-service'
import { ShoppingService } from '../../../electron/services/shopping-service'
import { guarded, type EditDb } from './edits'
import { projects, today, type QueryDb } from './queries'

type Db = EditDb & QueryDb

function services(db: Db): { shopping: ShoppingService; costs: CostService } {
  const raw = db as unknown as Database.Database
  // A project with only a shopping list (no task yet) still counts as one the phone holds.
  const ids = () => {
    const listed = projects(db).map((project) => project.id)
    const shopping = (
      db.prepare('SELECT DISTINCT project_id FROM shopping_items').all() as { project_id: string }[]
    ).map((row) => row.project_id)
    return [...new Set([...listed, ...shopping])]
  }
  const costs = new CostService(raw, ids)
  return { shopping: new ShoppingService(raw, costs, ids), costs }
}

export interface ShoppingList {
  items: ShoppingItem[]
  currency: CurrencyCode
  /** The estimates of the items still to buy, in minor units. */
  stillToBuy: number
}

/** The project's list in order, bought and not, with its currency. */
export function shoppingList(db: Db, projectId: string): ShoppingList {
  const { shopping, costs } = services(db)
  try {
    const items = shopping.list(projectId)
    return { items, currency: costs.getBudget(projectId).currency, stillToBuy: stillToBuy(items) }
  } catch {
    return { items: [], currency: costs.getBudget(projectId).currency, stillToBuy: 0 }
  }
}

/** Adds an item from one line, as the PC's Add item reads it ("3 packs wall plugs £4.50"). */
export function addShoppingLine(db: Db, projectId: string, line: string): ShoppingItem {
  const { shopping, costs } = services(db)
  const read = readShoppingLine(line, costs.getBudget(projectId).currency)
  return guarded(() => shopping.create(projectId, read))
}

/** Ticks an item bought: a paid cost of `pricePaid` (its estimate when left out) dated today. */
export function buyShoppingItem(
  db: Db,
  projectId: string,
  itemId: string,
  pricePaid?: number
): ShoppingItem {
  const { shopping } = services(db)
  return guarded(() => {
    const item = shopping.get(projectId, itemId)
    return shopping.buy(projectId, itemId, {
      pricePaid: pricePaid ?? item.estimate ?? 0,
      date: today()
    }).item
  })
}

/** Unticks an item; its cost is deleted. `rebuyShoppingItem` with the result undoes it. */
export function unbuyShoppingItem(db: Db, projectId: string, itemId: string): Cost {
  return guarded(() => services(db).shopping.unbuy(projectId, itemId).cost)
}

export function rebuyShoppingItem(db: Db, projectId: string, itemId: string, cost: Cost): void {
  guarded(() => void services(db).shopping.rebuy(projectId, itemId, cost))
}

/** Deletes an item; `restoreShoppingItem` with the result undoes it. */
export function deleteShoppingItem(db: Db, projectId: string, itemId: string): ShoppingItem {
  return guarded(() => services(db).shopping.delete(projectId, itemId))
}

export function restoreShoppingItem(db: Db, projectId: string, item: ShoppingItem): void {
  guarded(() => void services(db).shopping.restore(projectId, item))
}
