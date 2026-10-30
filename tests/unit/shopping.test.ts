import Database from 'better-sqlite3'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import { validateProjectPackage, type ProjectPackage } from '../../src/shared/project-package'
import {
  groupBySupplier,
  lineUnits,
  parseShoppingFields,
  readShoppingLine,
  stillToBuy
} from '../../src/shared/shopping'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const TODAY = '2026-10-18'

const tempDir = useTempDir('ostler-shopping-')
let databasePath: string
let store: ConfigStore
let planning: PlanningService
let people: PeopleService
let service: ProjectPackageService

function packageOf(json: Record<string, unknown>): ProjectPackage {
  const result = validateProjectPackage({ format: 'ostler-project-package', version: 1, ...json })
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const KITCHEN = packageOf({
  project: { name: 'Kitchen' },
  people: [],
  labels: [],
  goals: [],
  milestones: [],
  tasks: [
    { ref: 't1', title: 'Put up shelves' },
    { ref: 't2', title: 'Paint the walls' }
  ],
  decisions: [],
  library: []
})

beforeEach(async () => {
  databasePath = await createMigratedDatabase(tempDir())
  store = new ConfigStore(path.join(tempDir(), 'config.json'))
  planning = new PlanningService(databasePath, () => store.getProjects().map((p) => p.id))
  people = new PeopleService(databasePath)
  people.ensureMe('Alex')
  const scaffold = new ProjectScaffoldService(store, () => tempDir())
  service = new ProjectPackageService({
    planning,
    registerProject: async (request, fixed) => scaffold.createProject(request, fixed),
    getProject: (projectId) => {
      const project = store.getProjects().find((entry) => entry.id === projectId)
      if (!project) throw new Error('Project not found')
      return project
    },
    dataDir: tempDir(),
    appVersion: 'test'
  })
})

afterEach(() => {
  planning.close()
  people.close()
})

async function kitchen() {
  const { project } = await service.createProjectFromPackage(KITCHEN, {}, TODAY)
  const tasks = planning.listWorkItems(project.id)
  const shelves = tasks.find((task) => task.title === 'Put up shelves')!
  const paint = tasks.find((task) => task.title === 'Paint the walls')!
  planning.costs.setBudget(project.id, { amount: 100_000, currency: 'GBP' })
  return { project, shelves, paint }
}

const supplier = (name = 'Jones Hardware') =>
  planning.contacts.create({ name, emails: [`${name.split(' ')[0].toLowerCase()}@shop.example`] })

describe('the shopping list migration (N6.3b)', () => {
  it('adds shopping_items, with links to a contact, a task and a cost that clear', () => {
    const db = new Database(databasePath, { readonly: true })
    try {
      const columns = (
        db.prepare('PRAGMA table_info(shopping_items)').all() as { name: string }[]
      ).map((column) => column.name)
      expect(columns).toEqual([
        'id',
        'project_id',
        'name',
        'quantity',
        'unit',
        'estimate',
        'contact_id',
        'work_item_id',
        'order_key',
        'cost_id',
        'created_at',
        'updated_at'
      ])
      const keys = db.prepare('PRAGMA foreign_key_list(shopping_items)').all() as {
        table: string
        on_delete: string
      }[]
      expect(keys.map((key) => [key.table, key.on_delete]).sort()).toEqual([
        ['contacts', 'SET NULL'],
        ['costs', 'SET NULL'],
        ['planning_work_items', 'SET NULL']
      ])
      expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(51)
    } finally {
      db.close()
    }
  })
})

describe('reading a single line (N6.3b)', () => {
  const units = lineUnits()

  it('reads quantity, unit, name and price in a British format', () => {
    expect(readShoppingLine('3 packs wall plugs £4.50', 'GBP', 'en-GB', units)).toEqual({
      name: 'wall plugs',
      quantity: 3,
      unit: 'packs',
      estimate: 450
    })
    expect(readShoppingLine('2.5m cable £12', 'GBP', 'en-GB', units)).toEqual({
      name: 'cable',
      quantity: 2.5,
      unit: 'm',
      estimate: 1200
    })
    expect(readShoppingLine('Paint roller', 'GBP', 'en-GB', units)).toEqual({
      name: 'Paint roller',
      quantity: 1,
      unit: '',
      estimate: null
    })
  })

  it('reads a German format, with a comma for decimals and the euro after', () => {
    expect(readShoppingLine('2,5 m Kabel 12,50 €', 'EUR', 'de-DE', units)).toEqual({
      name: 'Kabel',
      quantity: 2.5,
      unit: 'm',
      estimate: 1250
    })
    expect(readShoppingLine('1.234,50 € Küche', 'EUR', 'de-DE', units).estimate).toBeNull()
  })

  it('keeps the whole line as the name when it is unsure', () => {
    const whole = (line: string, currency = 'GBP', locale = 'en-GB') =>
      expect(readShoppingLine(line, currency, locale, units)).toEqual({
        name: line,
        quantity: 1,
        unit: '',
        estimate: null
      })
    whole('3M tape') // a brand, not three metres
    whole('Screws $5') // another currency
    whole('Hooks £4.505') // too many decimals
    whole('2,5 m cable') // a comma in a British quantity
    whole('2.5 m Kabel', 'EUR', 'de-DE') // a dot in a German one
    whole('12') // a number alone
    // A price without a currency mark is part of the name.
    expect(readShoppingLine('Hinges 40', 'GBP', 'en-GB', units).name).toBe('Hinges 40')
  })
})

describe('ShoppingService (N6.3b)', () => {
  it('adds, edits, reorders, deletes and restores items, grouped by supplier', async () => {
    const { project, shelves } = await kitchen()
    const jones = supplier()
    const plugs = planning.shopping.create(project.id, {
      name: 'Wall plugs',
      quantity: 3,
      unit: 'packs',
      estimate: 450,
      contactId: jones.id
    })
    const paint = planning.shopping.create(project.id, { name: 'Paint', estimate: 3000 })
    const brackets = planning.shopping.create(project.id, {
      name: 'Brackets',
      contactId: jones.id,
      workItemId: shelves.id
    })
    expect(planning.shopping.list(project.id).map((item) => item.name)).toEqual([
      'Wall plugs',
      'Paint',
      'Brackets'
    ])
    expect(plugs).toMatchObject({ supplierName: 'Jones Hardware', costId: null, boughtOn: null })
    planning.shopping.update(project.id, brackets.id, { beforeId: plugs.id })
    planning.shopping.update(project.id, paint.id, { afterId: null })
    const list = planning.shopping.list(project.id)
    expect(list.map((item) => item.name)).toEqual(['Paint', 'Brackets', 'Wall plugs'])
    expect(
      groupBySupplier(list).map((group) => [group.name, group.items.map((item) => item.name)])
    ).toEqual([
      ['Jones Hardware', ['Brackets', 'Wall plugs']],
      [null, ['Paint']]
    ])
    const { after } = planning.shopping.update(project.id, plugs.id, { quantity: 4, unit: null })
    expect(after).toMatchObject({ quantity: 4, unit: '' })
    const deleted = planning.shopping.delete(project.id, brackets.id)
    expect(planning.shopping.list(project.id)).toHaveLength(2)
    planning.shopping.restore(project.id, deleted)
    expect(planning.shopping.list(project.id).map((item) => item.name)).toEqual([
      'Paint',
      'Brackets',
      'Wall plugs'
    ])
    expect(() => planning.shopping.create(project.id, { name: ' ' })).toThrow(/name/)
    expect(() => planning.shopping.create(project.id, { name: 'x', quantity: 0 })).toThrow(
      /quantity/
    )
    expect(() => parseShoppingFields({ name: 'x', colour: 'red' }, false)).toThrow(/colour/)
  })

  it('buying makes exactly one paid cost, which the summary counts, not the item', async () => {
    const { project, shelves } = await kitchen()
    const item = planning.shopping.create(project.id, {
      name: 'Shelf brackets',
      estimate: 1200,
      workItemId: shelves.id
    })
    const { item: bought, cost } = planning.shopping.buy(project.id, item.id, {
      pricePaid: 1100,
      date: '2026-10-17'
    })
    expect(cost).toMatchObject({
      amount: 1100,
      date: '2026-10-17',
      description: 'Shelf brackets',
      category: 'Shopping',
      workItemId: shelves.id,
      state: 'paid'
    })
    expect(bought).toMatchObject({ costId: cost.id, boughtOn: '2026-10-17', pricePaid: 1100 })
    expect(planning.costs.list(project.id)).toHaveLength(1)
    expect(planning.costs.summary(project.id)).toMatchObject({
      paid: 1100,
      planned: 0,
      total: 1100,
      stillToBuy: 0
    })
    expect(() =>
      planning.shopping.buy(project.id, item.id, { pricePaid: 1, date: '2026-10-17' })
    ).toThrow(/already bought/)
    expect(planning.costs.list(project.id)).toHaveLength(1)
    // An edit on the cost is the item's price paid: one record.
    planning.costs.update(project.id, cost.id, { amount: 1050 })
    expect(planning.shopping.get(project.id, item.id).pricePaid).toBe(1050)
  })

  it('refuses a bad price or date and makes no cost', async () => {
    const { project } = await kitchen()
    const item = planning.shopping.create(project.id, { name: 'Sandpaper' })
    expect(() =>
      planning.shopping.buy(project.id, item.id, { pricePaid: 1.5, date: '2026-10-17' })
    ).toThrow(/pricePaid/)
    expect(() =>
      planning.shopping.buy(project.id, item.id, { pricePaid: 100, date: 'today' })
    ).toThrow(/date/)
    expect(planning.costs.list(project.id)).toHaveLength(0)
    expect(planning.shopping.get(project.id, item.id).costId).toBeNull()
  })

  it('unticking removes the cost, and Undo brings the same cost back', async () => {
    const { project } = await kitchen()
    const item = planning.shopping.create(project.id, { name: 'Filler', estimate: 600 })
    const { cost } = planning.shopping.buy(project.id, item.id, {
      pricePaid: 650,
      date: '2026-10-17'
    })
    const unbought = planning.shopping.unbuy(project.id, item.id)
    expect(unbought.item.costId).toBeNull()
    expect(unbought.cost.id).toBe(cost.id)
    expect(planning.costs.list(project.id)).toHaveLength(0)
    expect(planning.costs.summary(project.id).stillToBuy).toBe(600)
    const again = planning.shopping.rebuy(project.id, item.id, unbought.cost)
    expect(again).toMatchObject({ costId: cost.id, pricePaid: 650 })
    expect(planning.costs.list(project.id).map((entry) => entry.id)).toEqual([cost.id])
  })

  it('deleting the cost from the Costs view unticks the item, and its Undo ticks it again', async () => {
    const { project } = await kitchen()
    const item = planning.shopping.create(project.id, { name: 'Tiles', estimate: 9000 })
    const { cost } = planning.shopping.buy(project.id, item.id, {
      pricePaid: 8800,
      date: '2026-10-17'
    })
    const deleted = planning.costs.delete(project.id, cost.id)
    expect(deleted.shoppingItemId).toBe(item.id)
    expect(planning.shopping.get(project.id, item.id)).toMatchObject({
      costId: null,
      boughtOn: null,
      pricePaid: null
    })
    planning.costs.restore(project.id, deleted)
    expect(planning.shopping.get(project.id, item.id).costId).toBe(cost.id)
  })

  it('switching its paid cost back to planned un-buys the item, and paying it buys it again', async () => {
    const { project } = await kitchen()
    const item = planning.shopping.create(project.id, { name: 'Grout', estimate: 700 })
    const { cost } = planning.shopping.buy(project.id, item.id, {
      pricePaid: 650,
      date: '2026-10-17'
    })
    // The Costs view's state switch: the cost is the one record.
    planning.costs.update(project.id, cost.id, { state: 'planned' })
    expect(planning.shopping.get(project.id, item.id)).toMatchObject({
      costId: null,
      boughtOn: null,
      pricePaid: null
    })
    // The Shopping list and the Budget card read the same answer.
    expect(stillToBuy(planning.shopping.list(project.id))).toBe(700)
    expect(planning.costs.summary(project.id)).toMatchObject({
      paid: 0,
      planned: 650,
      stillToBuy: 700
    })
    // Ticking it again pays that same cost; no second cost is made.
    const again = planning.shopping.buy(project.id, item.id, {
      pricePaid: 640,
      date: '2026-10-18'
    })
    expect(again.cost).toMatchObject({ id: cost.id, state: 'paid', amount: 640 })
    expect(planning.costs.list(project.id)).toHaveLength(1)
    // Marking it paid on the Costs view ticks it too.
    planning.costs.update(project.id, cost.id, { state: 'planned' })
    planning.costs.markPaid(project.id, cost.id)
    expect(planning.shopping.get(project.id, item.id)).toMatchObject({
      costId: cost.id,
      pricePaid: 640
    })
  })

  it('keeps still to buy apart from planned costs, so nothing is counted twice', async () => {
    const { project } = await kitchen()
    planning.costs.create(project.id, { date: '2026-11-01', amount: 20_000, description: 'Fitter' })
    planning.shopping.create(project.id, { name: 'Worktop', estimate: 15_000 })
    planning.shopping.create(project.id, { name: 'Taps', estimate: 8000 })
    planning.shopping.create(project.id, { name: 'Sealant' })
    const bought = planning.shopping.create(project.id, { name: 'Sink', estimate: 12_000 })
    planning.shopping.buy(project.id, bought.id, { pricePaid: 11_000, date: '2026-10-17' })
    const summary = planning.costs.summary(project.id)
    expect(summary).toMatchObject({
      planned: 20_000,
      paid: 11_000,
      total: 31_000,
      left: 69_000,
      stillToBuy: 23_000
    })
    expect(stillToBuy(planning.shopping.list(project.id))).toBe(23_000)
  })

  it('keeps an item when its task or supplier is deleted, and goes with the project', async () => {
    const { project, shelves } = await kitchen()
    const jones = supplier()
    const item = planning.shopping.create(project.id, {
      name: 'Screws',
      contactId: jones.id,
      workItemId: shelves.id
    })
    planning.deleteWorkItem(shelves.id, planning.humanActor())
    planning.contacts.delete(jones.id)
    expect(planning.shopping.get(project.id, item.id)).toMatchObject({
      workItemId: null,
      contactId: null,
      supplierName: null
    })
    const removed = deleteProjectRows(planning.database, project.id)
    expect(removed.map((entry) => entry.table)).toContain('shopping_items')
    expect(planning.database.prepare('SELECT COUNT(*) AS n FROM shopping_items').get()).toEqual({
      n: 0
    })
  })

  it('refuses a task of another project and an unknown contact', async () => {
    const { project } = await kitchen()
    const { project: other } = await service.createProjectFromPackage(
      packageOf({ ...KITCHEN, project: { name: 'Garden' } }),
      {},
      TODAY
    )
    const otherTask = planning.listWorkItems(other.id)[0]
    expect(() =>
      planning.shopping.create(project.id, { name: 'x', workItemId: otherTask.id })
    ).toThrow(/Task not found/)
    expect(() => planning.shopping.create(project.id, { name: 'x', contactId: 'nobody' })).toThrow(
      /Contact not found/
    )
    const item = planning.shopping.create(project.id, { name: 'x' })
    expect(() => planning.shopping.get(other.id, item.id)).toThrow(/not found/)
  })
})

describe('the shopping list in the project file (N6.3b)', () => {
  it('carries every item, its supplier, task and the paid cost a bought one made', async () => {
    const { project, shelves } = await kitchen()
    const jones = supplier()
    planning.shopping.create(project.id, {
      name: 'Wall plugs',
      quantity: 3,
      unit: 'packs',
      estimate: 450,
      contactId: jones.id,
      workItemId: shelves.id
    })
    const bracket = planning.shopping.create(project.id, { name: 'Brackets', estimate: 1200 })
    planning.shopping.buy(project.id, bracket.id, { pricePaid: 1100, date: '2026-10-17' })
    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.shopping).toHaveLength(2)
    expect(file.contacts?.map((contact) => contact.name)).toEqual(['Jones Hardware'])
    expect(validateProjectPackage(JSON.parse(JSON.stringify(file))).ok).toBe(true)

    const { project: copy } = await service.createProjectFromPackage(file, {}, TODAY)
    const items = planning.shopping.list(copy.id)
    const copiedShelves = planning
      .listWorkItems(copy.id)
      .find((task) => task.title === 'Put up shelves')!
    expect(items.map((item) => [item.name, item.quantity, item.unit, item.estimate])).toEqual([
      ['Wall plugs', 3, 'packs', 450],
      ['Brackets', 1, '', 1200]
    ])
    expect(items[0]).toMatchObject({
      contactId: jones.id,
      supplierName: 'Jones Hardware',
      workItemId: copiedShelves.id,
      costId: null
    })
    expect(items[1]).toMatchObject({ pricePaid: 1100, boughtOn: '2026-10-17' })
    // One record of the purchase: the copy has one paid cost, the bought item's.
    expect(planning.costs.list(copy.id).map((cost) => cost.id)).toEqual([items[1].costId])
  })

  it('gives a template the unbought items only, without suppliers or prices paid', async () => {
    const { project } = await kitchen()
    const jones = supplier()
    planning.shopping.create(project.id, { name: 'Primer', estimate: 2000, contactId: jones.id })
    const done = planning.shopping.create(project.id, { name: 'Dust sheets', estimate: 800 })
    planning.shopping.buy(project.id, done.id, { pricePaid: 750, date: '2026-10-17' })
    const template = service.exportProjectAsPackage(
      project.id,
      { kind: 'template', relativeDates: true },
      TODAY
    )
    expect(template.shopping).toEqual([{ name: 'Primer', quantity: 1, estimate: 2000 }])
    expect(template.contacts).toBeUndefined()
    const { project: used } = await service.createProjectFromPackage(template, {}, '2027-01-01')
    expect(planning.shopping.list(used.id)).toMatchObject([
      { name: 'Primer', estimate: 2000, contactId: null, costId: null }
    ])
    expect(planning.costs.list(used.id)).toEqual([])
  })

  it('refuses an item whose cost is not a paid cost of the file', () => {
    const bad = validateProjectPackage({
      ...KITCHEN,
      format: 'ostler-project-package',
      version: 1,
      costs: [{ date: '2026-10-01', amount: 100, description: 'Plan', state: 'planned' }],
      shopping: [{ name: 'Glue', costIndex: 0 }]
    })
    expect(bad.ok).toBe(false)
    const quantity = validateProjectPackage({
      ...KITCHEN,
      format: 'ostler-project-package',
      version: 1,
      shopping: [{ name: 'Glue', quantity: -1 }]
    })
    expect(quantity.ok).toBe(false)
  })
})
