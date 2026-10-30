import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { isIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import { MAX_MINOR_UNITS, type Cost } from '@shared/money'
import { orderKeyBetween, isOrderKey } from '@shared/planning/order-key'
import { Refusal } from '@shared/refusal'
import {
  parseShoppingFields,
  type ShoppingBuyInput,
  type ShoppingInput,
  type ShoppingItem
} from '@shared/shopping'
import type { CostService } from './cost-service'

interface ShoppingRow {
  id: string
  project_id: string
  name: string
  quantity: number
  unit: string
  estimate: number | null
  contact_id: string | null
  supplier_name: string | null
  work_item_id: string | null
  order_key: string
  cost_id: string | null
  bought_on: string | null
  price_paid: number | null
  cost_state: string | null
  created_at: number
  updated_at: number
}

/** An item as the project file and a template carry it: links by id, for the caller to map. */
export interface StoredShoppingItem {
  name: string
  quantity: number
  unit: string
  estimate: number | null
  contactId: string | null
  workItemId: string | null
  costId: string | null
}

/**
 * The list and its suppliers' names and what each bought item cost, in one
 * query. Bought is read from the cost: an item is bought while the cost it
 * points at is paid, so a cost switched back to planned un-buys it.
 */
const SELECT_ITEMS = `
  SELECT s.*, c.name AS supplier_name, k.date AS bought_on, k.amount AS price_paid,
    k.state AS cost_state
  FROM shopping_items s
  LEFT JOIN contacts c ON c.id = s.contact_id
  LEFT JOIN costs k ON k.id = s.cost_id`

/**
 * The shopping list (N6.3b, N46). The desktop app and the automation API
 * both write through here, on the planning connection. Buying an item makes
 * a paid cost through `CostService` in the same transaction, so the Budget
 * card and the Costs view count the purchase once, as a cost; unticking it
 * deletes that cost, and deleting the cost unticks the item (the foreign
 * key clears `cost_id`). The cost is the one record of the purchase: the
 * item is bought while that cost is paid, so switching it back to planned on
 * the Costs view un-buys the item, and ticking the item again pays that same
 * cost rather than making a second one.
 */
export class ShoppingService {
  constructor(
    private readonly db: Database.Database,
    private readonly costs: CostService,
    private readonly getProjectIds: () => string[],
    private readonly changed: (projectId: string) => void = () => {},
    private readonly now: () => number = Date.now
  ) {}

  /** The project's list in order, bought and not. */
  list(projectId: string): ShoppingItem[] {
    this.requireProject(projectId)
    const rows = this.db
      .prepare(`${SELECT_ITEMS} WHERE s.project_id = ? ORDER BY s.order_key, s.created_at, s.rowid`)
      .all(projectId) as ShoppingRow[]
    return rows.map(toItem)
  }

  get(projectId: string, itemId: unknown): ShoppingItem {
    this.requireProject(projectId)
    if (typeof itemId !== 'string') throw new Refusal('Shopping item not found')
    const row = this.db
      .prepare(`${SELECT_ITEMS} WHERE s.id = ? AND s.project_id = ?`)
      .get(itemId, projectId) as ShoppingRow | undefined
    if (!row) throw new Refusal('Shopping item not found')
    return toItem(row)
  }

  /** Adds an item, at the end unless `afterId` or `beforeId` places it. */
  create(projectId: string, input: unknown): ShoppingItem {
    this.requireProject(projectId)
    const fields = this.parse(input, false)
    this.checkLinks(projectId, fields)
    const id = uuidv4()
    const at = this.now()
    const key = this.placeKey(projectId, id, fields)
    this.db
      .prepare(
        `INSERT INTO shopping_items (id, project_id, name, quantity, unit, estimate, contact_id,
           work_item_id, order_key, cost_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        id,
        projectId,
        fields.name,
        fields.quantity ?? 1,
        fields.unit ?? '',
        fields.estimate ?? null,
        fields.contactId ?? null,
        fields.workItemId ?? null,
        key,
        at,
        at
      )
    this.changed(projectId)
    return this.get(projectId, id)
  }

  /** Changes the fields given, and moves it when `afterId` or `beforeId` is given; the item as it was and is. */
  update(
    projectId: string,
    itemId: unknown,
    input: unknown
  ): { before: ShoppingItem; after: ShoppingItem } {
    const before = this.get(projectId, itemId)
    const fields = this.parse(input, true)
    this.checkLinks(projectId, fields)
    const moving = fields.afterId !== undefined || fields.beforeId !== undefined
    const key = moving ? this.placeKey(projectId, before.id, fields) : before.orderKey
    this.db
      .prepare(
        `UPDATE shopping_items SET name = ?, quantity = ?, unit = ?, estimate = ?, contact_id = ?,
           work_item_id = ?, order_key = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        fields.name ?? before.name,
        fields.quantity ?? before.quantity,
        fields.unit ?? before.unit,
        fields.estimate !== undefined ? fields.estimate : before.estimate,
        fields.contactId !== undefined ? fields.contactId : before.contactId,
        fields.workItemId !== undefined ? fields.workItemId : before.workItemId,
        key,
        this.now(),
        before.id
      )
    this.changed(projectId)
    return { before, after: this.get(projectId, before.id) }
  }

  /**
   * Ticks an item as bought: in one transaction, a paid cost with the price
   * and date, the item's name, the category "Shopping" and its task, and the
   * item pointing at it.
   */
  buy(projectId: string, itemId: unknown, input: unknown): { item: ShoppingItem; cost: Cost } {
    const item = this.get(projectId, itemId)
    if (item.costId !== null) throw new Refusal('This item is already bought')
    const { pricePaid, date } = parseBuy(input)
    const planned = this.plannedCostOf(item.id)
    const cost = this.db.transaction(() => {
      // Its cost was switched back to planned: paying it is buying the item.
      if (planned)
        return this.costs.update(projectId, planned, { state: 'paid', amount: pricePaid, date })
          .after
      const made = this.costs.create(projectId, {
        date,
        amount: pricePaid,
        description: item.name,
        category: t('projects:shopping.costCategory'),
        workItemId: item.workItemId,
        state: 'paid'
      })
      this.db
        .prepare('UPDATE shopping_items SET cost_id = ?, updated_at = ? WHERE id = ?')
        .run(made.id, this.now(), item.id)
      return made
    })()
    this.changed(projectId)
    return { item: this.get(projectId, item.id), cost }
  }

  /**
   * Unticks an item: deletes the paid cost it made. `rebuy` with what it
   * returns puts the same cost back (Undo).
   */
  unbuy(projectId: string, itemId: unknown): { item: ShoppingItem; cost: Cost } {
    const item = this.get(projectId, itemId)
    if (item.costId === null) throw new Refusal('This item is not bought')
    const cost = this.db.transaction(() => this.costs.delete(projectId, item.costId))()
    this.changed(projectId)
    return { item: this.get(projectId, item.id), cost }
  }

  /** The planned cost an item still points at (bought, then switched back to planned), or null. */
  private plannedCostOf(itemId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT s.cost_id AS id FROM shopping_items s JOIN costs k ON k.id = s.cost_id
         WHERE s.id = ? AND k.state <> 'paid'`
      )
      .get(itemId) as { id: string } | undefined
    return row?.id ?? null
  }

  /** Undo of unticking: the same cost back, and the item ticked again. */
  rebuy(projectId: string, itemId: unknown, cost: unknown): ShoppingItem {
    const item = this.get(projectId, itemId)
    if (item.costId !== null) throw new Refusal('This item is already bought')
    this.db.transaction(() => {
      const restored = this.costs.restore(projectId, cost)
      this.db
        .prepare('UPDATE shopping_items SET cost_id = ?, updated_at = ? WHERE id = ?')
        .run(restored.id, this.now(), item.id)
    })()
    this.changed(projectId)
    return this.get(projectId, item.id)
  }

  /** Deletes an item; its paid cost, if bought, stays as the record. `restore` puts the item back. */
  delete(projectId: string, itemId: unknown): ShoppingItem {
    const item = this.get(projectId, itemId)
    this.db.prepare('DELETE FROM shopping_items WHERE id = ?').run(item.id)
    this.changed(projectId)
    return item
  }

  /** Puts a deleted item back with its id, place and times; a link gone since is cleared. */
  restore(projectId: string, value: unknown): ShoppingItem {
    this.requireProject(projectId)
    const item = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id) throw new Refusal('Shopping item not found')
    const fields = this.parse(
      {
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        estimate: item.estimate ?? null
      },
      false
    )
    const contactId =
      typeof item.contactId === 'string' && this.contactExists(item.contactId)
        ? item.contactId
        : null
    const workItemId =
      typeof item.workItemId === 'string' && this.taskBelongs(projectId, item.workItemId)
        ? item.workItemId
        : null
    const costId =
      typeof item.costId === 'string' &&
      this.db
        .prepare(
          `SELECT 1 FROM costs WHERE id = ? AND project_id = ?
           AND NOT EXISTS (SELECT 1 FROM shopping_items WHERE cost_id = costs.id)`
        )
        .get(item.costId, projectId) !== undefined
        ? item.costId
        : null
    const key = isOrderKey(item.orderKey) ? item.orderKey : this.placeKey(projectId, item.id, {})
    const at = this.now()
    const time = (raw: unknown) => (typeof raw === 'number' && Number.isFinite(raw) ? raw : at)
    this.db
      .prepare(
        `INSERT OR IGNORE INTO shopping_items (id, project_id, name, quantity, unit, estimate,
           contact_id, work_item_id, order_key, cost_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        projectId,
        fields.name,
        fields.quantity ?? 1,
        fields.unit ?? '',
        fields.estimate ?? null,
        contactId,
        workItemId,
        key,
        costId,
        time(item.createdAt),
        time(item.updatedAt)
      )
    this.changed(projectId)
    return this.get(projectId, item.id)
  }

  /** Writes items from a project file or template into a new project, in order. Links are already mapped. */
  importItems(projectId: string, items: StoredShoppingItem[]): void {
    const insert = this.db.prepare(
      `INSERT INTO shopping_items (id, project_id, name, quantity, unit, estimate, contact_id,
         work_item_id, order_key, cost_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const at = this.now()
    this.db.transaction(() => {
      let key: string | null = null
      items.forEach((item, index) => {
        key = orderKeyBetween(key, null)
        insert.run(
          uuidv4(),
          projectId,
          item.name,
          item.quantity,
          item.unit,
          item.estimate,
          item.contactId,
          item.workItemId,
          key,
          item.costId,
          at + index,
          at + index
        )
      })
    })()
  }

  private parse(input: unknown, partial: boolean): ShoppingInput {
    try {
      return parseShoppingFields(input, partial)
    } catch (error) {
      throw new Refusal(error instanceof Error ? error.message : String(error))
    }
  }

  /** The key for an item placed after or before another, or at the end. */
  private placeKey(projectId: string, itemId: string, fields: ShoppingInput): string {
    const keys = this.db
      .prepare(
        'SELECT id, order_key AS key FROM shopping_items WHERE project_id = ? AND id <> ? ORDER BY order_key, created_at, rowid'
      )
      .all(projectId, itemId) as { id: string; key: string }[]
    let index = keys.length
    if (fields.afterId === null) index = 0
    else if (typeof fields.afterId === 'string') {
      const found = keys.findIndex((entry) => entry.id === fields.afterId)
      if (found < 0) throw new Refusal('afterId is not an item on this list')
      index = found + 1
    } else if (typeof fields.beforeId === 'string') {
      index = keys.findIndex((entry) => entry.id === fields.beforeId)
      if (index < 0) throw new Refusal('beforeId is not an item on this list')
    }
    try {
      return orderKeyBetween(keys[index - 1]?.key ?? null, keys[index]?.key ?? null)
    } catch {
      // Two items share a key: put this one at the end rather than refuse.
      return orderKeyBetween(keys[keys.length - 1]?.key ?? null, null)
    }
  }

  /** A task named must be this project's; a supplier must be a contact. */
  private checkLinks(projectId: string, fields: ShoppingInput): void {
    if (fields.workItemId && !this.taskBelongs(projectId, fields.workItemId))
      throw new Refusal('Task not found in this project')
    if (fields.contactId && !this.contactExists(fields.contactId))
      throw new Refusal('Contact not found')
  }

  private taskBelongs(projectId: string, id: string): boolean {
    return (
      this.db
        .prepare('SELECT 1 FROM planning_work_items WHERE id = ? AND project_id = ?')
        .get(id, projectId) !== undefined
    )
  }

  private contactExists(id: string): boolean {
    return this.db.prepare('SELECT 1 FROM contacts WHERE id = ?').get(id) !== undefined
  }

  private requireProject(projectId: unknown): string {
    if (typeof projectId !== 'string' || !this.getProjectIds().includes(projectId)) {
      throw new Refusal('Project not found')
    }
    return projectId
  }
}

function parseBuy(input: unknown): ShoppingBuyInput {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  for (const key of Object.keys(value)) {
    if (key !== 'pricePaid' && key !== 'date') throw new Refusal(`Buying has no field ${key}`)
  }
  const price = value.pricePaid
  if (
    typeof price !== 'number' ||
    !Number.isSafeInteger(price) ||
    price < 0 ||
    price > MAX_MINOR_UNITS
  )
    throw new Refusal('pricePaid must be a whole number of minor units (pence, cents), 0 or more')
  if (!isIsoDate(value.date)) throw new Refusal('date must be a date, YYYY-MM-DD')
  return { pricePaid: price, date: value.date }
}

function toItem(row: ShoppingRow): ShoppingItem {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit,
    estimate: row.estimate,
    contactId: row.contact_id,
    supplierName: row.supplier_name,
    workItemId: row.work_item_id,
    orderKey: row.order_key,
    // Bought only while its cost is paid (see SELECT_ITEMS).
    costId: row.cost_state === 'paid' ? row.cost_id : null,
    boughtOn: row.cost_state === 'paid' ? row.bought_on : null,
    pricePaid: row.cost_state === 'paid' ? row.price_paid : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
