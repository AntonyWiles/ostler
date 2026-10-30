import Database from 'better-sqlite3'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import { buildCostsCsv } from '../../electron/services/export-service'
import { validateProjectPackage, type ProjectPackage } from '../../src/shared/project-package'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const TODAY = '2026-10-12'

const tempDir = useTempDir('ostler-costs-')
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

const WEDDING = packageOf({
  project: { name: 'Wedding' },
  people: [],
  labels: [],
  goals: [],
  milestones: [{ ref: 'm1', name: 'The day', targetDate: '2027-06-01' }],
  tasks: [
    { ref: 't1', title: 'Book the hall', milestoneRef: 'm1' },
    { ref: 't2', title: 'Order flowers' }
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

async function wedding() {
  const { project } = await service.createProjectFromPackage(WEDDING, {}, TODAY)
  const tasks = planning.listWorkItems(project.id)
  const hall = tasks.find((task) => task.title === 'Book the hall')!
  const flowers = tasks.find((task) => task.title === 'Order flowers')!
  const milestone = planning.listMilestones(project.id)[0]
  return { project, hall, flowers, milestone }
}

describe('the budgets and costs migration (N6.3a)', () => {
  it('adds project_budgets and costs, with links that clear', () => {
    const db = new Database(databasePath, { readonly: true })
    try {
      const columns = (table: string) =>
        (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
      expect(columns('project_budgets')).toEqual([
        'project_id',
        'amount',
        'currency',
        'updated_at',
        'hourly_rate',
        'new_time_billable'
      ])
      expect(columns('costs')).toEqual([
        'id',
        'project_id',
        'date',
        'amount',
        'description',
        'category',
        'work_item_id',
        'milestone_id',
        'state',
        'created_at',
        'updated_at'
      ])
      const keys = db.prepare('PRAGMA foreign_key_list(costs)').all() as {
        table: string
        on_delete: string
      }[]
      expect(keys.map((key) => [key.table, key.on_delete]).sort()).toEqual([
        ['planning_milestones', 'SET NULL'],
        ['planning_work_items', 'SET NULL']
      ])
      expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(38)
    } finally {
      db.close()
    }
  })
})

describe('CostService (N6.3a)', () => {
  it('keeps a budget and currency, and refuses bad ones', async () => {
    const { project } = await wedding()
    expect(planning.costs.getBudget(project.id).amount).toBeNull()
    expect(planning.costs.setBudget(project.id, { amount: 500_000, currency: 'GBP' })).toEqual({
      projectId: project.id,
      amount: 500_000,
      currency: 'GBP'
    })
    expect(planning.costs.setBudget(project.id, { currency: 'JPY' }).amount).toBe(500_000)
    expect(planning.costs.setBudget(project.id, { amount: null }).amount).toBeNull()
    expect(() => planning.costs.setBudget(project.id, { amount: 1.5 })).toThrow(/whole number/)
    expect(() => planning.costs.setBudget(project.id, { currency: 'POUNDS' })).toThrow(/ISO 4217/)
  })

  it('adds, edits, marks paid, deletes and restores costs, and sums them in one summary', async () => {
    const { project, hall, milestone } = await wedding()
    planning.costs.setBudget(project.id, { amount: 100_000, currency: 'GBP' })
    const deposit = planning.costs.create(project.id, {
      date: '2026-11-01',
      amount: 60_000,
      description: 'Hall deposit',
      category: 'Venue',
      workItemId: hall.id,
      milestoneId: milestone.id
    })
    planning.costs.create(project.id, {
      date: '2026-10-20',
      amount: 55_000,
      description: 'Catering',
      category: 'Food'
    })
    expect(planning.costs.list(project.id).map((cost) => cost.description)).toEqual([
      'Catering',
      'Hall deposit'
    ])
    const paid = planning.costs.markPaid(project.id, deposit.id, {
      date: '2026-11-03',
      amount: 58_000
    })
    expect(paid).toMatchObject({ state: 'paid', date: '2026-11-03', amount: 58_000 })
    const summary = planning.costs.summary(project.id)
    expect(summary).toMatchObject({
      currency: 'GBP',
      budget: 100_000,
      paid: 58_000,
      planned: 55_000,
      total: 113_000,
      left: -13_000,
      over: 13_000,
      count: 2
    })
    expect(summary.byMilestone[milestone.id]).toEqual({ paid: 58_000, planned: 0, total: 58_000 })
    expect(planning.costs.categories(project.id).sort()).toEqual(['Food', 'Venue'])
    expect(planning.costs.list(project.id, { state: 'paid' })).toHaveLength(1)
    expect(planning.costs.list(project.id, { category: 'Food' })).toHaveLength(1)
    expect(planning.costs.list(project.id, { workItemId: hall.id })).toHaveLength(1)

    const gone = planning.costs.delete(project.id, deposit.id)
    expect(planning.costs.list(project.id)).toHaveLength(1)
    planning.costs.restore(project.id, gone)
    expect(planning.costs.get(project.id, deposit.id)).toEqual(gone)
  })

  it('refuses a task or milestone of another project, and a cost of another project', async () => {
    const one = await wedding()
    const { project: other } = await service.createProjectFromPackage(
      { ...WEDDING, project: { ...WEDDING.project, name: 'Other' } },
      {},
      TODAY
    )
    expect(() =>
      planning.costs.create(other.id, {
        date: '2026-11-01',
        amount: 1,
        description: 'x',
        workItemId: one.hall.id
      })
    ).toThrow(/Task not found/)
    const cost = planning.costs.create(one.project.id, {
      date: '2026-11-01',
      amount: 1,
      description: 'x'
    })
    expect(() => planning.costs.update(other.id, cost.id, { amount: 2 })).toThrow(/Cost not found/)
  })

  it('keeps the costs of a deleted task or milestone and clears the link', async () => {
    const { project, hall, milestone } = await wedding()
    const cost = planning.costs.create(project.id, {
      date: '2026-11-01',
      amount: 60_000,
      description: 'Hall deposit',
      workItemId: hall.id,
      milestoneId: milestone.id
    })
    planning.deleteWorkItem(hall.id, planning.humanActor())
    expect(planning.costs.get(project.id, cost.id)).toMatchObject({
      workItemId: null,
      milestoneId: milestone.id,
      amount: 60_000
    })
    planning.deleteMilestone(milestone.id)
    expect(planning.costs.get(project.id, cost.id).milestoneId).toBeNull()
  })

  it('goes with the project when it is removed', async () => {
    const { project } = await wedding()
    planning.costs.setBudget(project.id, { amount: 1 })
    planning.costs.create(project.id, { date: '2026-11-01', amount: 1, description: 'x' })
    const deleted = deleteProjectRows(planning.database, project.id)
    expect(deleted.map((entry) => entry.table)).toEqual(
      expect.arrayContaining(['costs', 'project_budgets'])
    )
  })

  it('exports the CSV with task and milestone names', async () => {
    const { project, hall, milestone } = await wedding()
    planning.costs.setBudget(project.id, { currency: 'KWD' })
    planning.costs.create(project.id, {
      date: '2026-11-01',
      amount: 1250,
      description: 'Hall',
      workItemId: hall.id,
      milestoneId: milestone.id
    })
    const { text, costCount } = buildCostsCsv(planning, project.id)
    expect(costCount).toBe(1)
    expect(text.slice(1).split('\r\n')[1]).toBe(
      '2026-11-01,Hall,,Book the hall,The day,Planned,1.250,KWD'
    )
  })
})

describe('budgets and costs in the project file (N6.3a)', () => {
  it('carries the budget and every cost, with their task and milestone', async () => {
    const { project, hall, milestone } = await wedding()
    planning.costs.setBudget(project.id, { amount: 1_000_000, currency: 'EUR' })
    planning.costs.create(project.id, {
      date: '2026-11-01',
      amount: 60_000,
      description: 'Hall deposit',
      category: 'Venue',
      workItemId: hall.id,
      milestoneId: milestone.id,
      state: 'paid'
    })
    planning.costs.create(project.id, {
      date: '2027-05-01',
      amount: 12_000,
      description: 'Flowers',
      category: 'Flowers'
    })
    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.budget).toEqual({ amount: 1_000_000, currency: 'EUR' })
    expect(file.costs).toHaveLength(2)
    expect(validateProjectPackage(JSON.parse(JSON.stringify(file))).ok).toBe(true)

    const { project: copy } = await service.createProjectFromPackage(file, {}, TODAY)
    expect(planning.costs.getBudget(copy.id)).toMatchObject({ amount: 1_000_000, currency: 'EUR' })
    const costs = planning.costs.list(copy.id)
    const copiedHall = planning
      .listWorkItems(copy.id)
      .find((task) => task.title === 'Book the hall')!
    expect(costs.map((cost) => [cost.date, cost.description, cost.state, cost.amount])).toEqual([
      ['2026-11-01', 'Hall deposit', 'paid', 60_000],
      ['2027-05-01', 'Flowers', 'planned', 12_000]
    ])
    expect(costs[0].workItemId).toBe(copiedHall.id)
    expect(costs[0].milestoneId).toBe(planning.listMilestones(copy.id)[0].id)
  })

  it('gives a template the budget and planned costs only, dated relative to the day it is used', async () => {
    const { project } = await wedding()
    planning.costs.setBudget(project.id, { amount: 5000, currency: 'GBP' })
    planning.costs.create(project.id, {
      date: '2026-10-12',
      amount: 100,
      description: 'Paid already',
      state: 'paid'
    })
    planning.costs.create(project.id, {
      date: '2026-10-26',
      amount: 200,
      description: 'Two weeks on'
    })
    const template = service.exportProjectAsPackage(
      project.id,
      { kind: 'template', relativeDates: true },
      TODAY
    )
    expect(template.budget).toEqual({ amount: 5000, currency: 'GBP' })
    expect(template.costs!.map((cost) => [cost.description, cost.date, cost.state])).toEqual([
      ['Two weeks on', '+14d', 'planned']
    ])
    const { project: used } = await service.createProjectFromPackage(template, {}, '2027-01-01')
    expect(planning.costs.list(used.id).map((cost) => [cost.description, cost.date])).toEqual([
      ['Two weeks on', '2027-01-15']
    ])
  })

  it('leaves paid costs out when a template file has them, and refuses a malformed cost', async () => {
    const withPaid = packageOf({
      template: { description: 'Hand made', icon: 'file' },
      project: { name: 'Fair' },
      people: [],
      labels: [],
      goals: [],
      milestones: [],
      tasks: [],
      decisions: [],
      library: [],
      costs: [
        { date: '+1d', amount: 10, description: 'Stall', state: 'planned' },
        { date: '+1d', amount: 10, description: 'Paid', state: 'paid' }
      ]
    })
    const { project } = await service.createProjectFromPackage(
      withPaid,
      { templateName: 'Fair' },
      TODAY
    )
    expect(planning.costs.list(project.id).map((cost) => cost.description)).toEqual(['Stall'])
    const json = JSON.parse(JSON.stringify(withPaid))
    expect(
      validateProjectPackage({ ...json, costs: [{ date: '+1d', amount: 1.5, description: 'x' }] })
        .ok
    ).toBe(false)
    expect(validateProjectPackage({ ...json, budget: { amount: 1, currency: 'Pounds' } }).ok).toBe(
      false
    )
    expect(
      validateProjectPackage({
        ...json,
        costs: [{ date: '+1d', amount: 1, description: 'x', taskRef: 't9' }]
      }).ok
    ).toBe(false)
  })
})
