import Database from 'better-sqlite3'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../../electron/config-store'
import { PlanningService } from '../../electron/services/planning-service'
import { PeopleService } from '../../electron/services/people-service'
import { ProjectScaffoldService } from '../../electron/services/project-scaffold-service'
import { ProjectPackageService } from '../../electron/services/project-package-service'
import { deleteProjectRows } from '../../electron/services/project-removal-service'
import { buildTimeReportCsv } from '../../electron/services/export-service'
import { billableAmount, buildTimeReport, thisMonth } from '../../src/shared/time/billing'
import { validateProjectPackage, type ProjectPackage } from '../../src/shared/project-package'
import { parseTimeReportHash, timeReportHashPath } from '../../src/shared/print-route'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

const TODAY = '2026-10-12'
const MINUTE = 60
const HOUR = 3600

const tempDir = useTempDir('ostler-billing-')
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

const STUDIO = packageOf({
  project: { name: 'Studio' },
  people: [],
  labels: [],
  goals: [],
  milestones: [],
  tasks: [
    { ref: 't1', title: 'Design' },
    { ref: 't2', title: 'Build' }
  ],
  decisions: [],
  library: []
})

/** A local moment: October 2026 unless said otherwise. */
const at = (day: number, hour: number, minute = 0, month = 9) =>
  new Date(2026, month, day, hour, minute).getTime()

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

async function studio() {
  const { project } = await service.createProjectFromPackage(STUDIO, {}, TODAY)
  const tasks = planning.listWorkItems(project.id)
  const design = tasks.find((task) => task.title === 'Design')!
  const build = tasks.find((task) => task.title === 'Build')!
  planning.costs.setBudget(project.id, { currency: 'GBP' })
  return { project, design, build }
}

function log(projectId: string, workItemId: string, startedAt: number, seconds: number) {
  return planning.time.create(projectId, { workItemId, startedAt, durationSeconds: seconds })
}

describe('the billable time migration (N6.4)', () => {
  it('adds billable and billing to entries, a rate and default to budgets, and billings', () => {
    const db = new Database(databasePath, { readonly: true })
    const columns = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    expect(columns('planning_time_entries')).toEqual(
      expect.arrayContaining(['billable', 'billing_id'])
    )
    expect(columns('project_budgets')).toEqual(
      expect.arrayContaining(['hourly_rate', 'new_time_billable'])
    )
    expect(columns('billings')).toEqual([
      'id',
      'project_id',
      'from_date',
      'to_date',
      'marked_at',
      'entry_count',
      'billable_seconds',
      'hourly_rate',
      'amount',
      'currency'
    ])
    db.close()
  })
})

describe('billable entries and the rate (N6.4)', () => {
  it("starts new entries with the project's default, by hand and from the timer", async () => {
    const { project, design } = await studio()
    expect(planning.billing.getSettings(project.id)).toEqual({
      projectId: project.id,
      hourlyRate: null,
      newTimeBillable: false,
      currency: 'GBP'
    })
    const before = log(project.id, design.id, at(1, 9), HOUR)
    expect(before.billable).toBe(false)

    planning.billing.setSettings(project.id, { newTimeBillable: true, hourlyRate: 6000 })
    expect(log(project.id, design.id, at(2, 9), HOUR).billable).toBe(true)
    expect(planning.time.startTimer(project.id, design.id).started.billable).toBe(true)
    planning.time.stopTimer()
    // A choice made on the entry wins over the default.
    expect(
      planning.time.create(project.id, {
        workItemId: design.id,
        startedAt: at(3, 9),
        durationSeconds: HOUR,
        billable: false
      }).billable
    ).toBe(false)
    // Changing the default never changes existing entries.
    expect(planning.time.get(before.id).billable).toBe(false)
    planning.billing.setSettings(project.id, { newTimeBillable: false })
    expect(planning.time.get(before.id).billable).toBe(false)
    // The budget row keeps its amount and currency beside the rate.
    expect(planning.costs.getBudget(project.id)).toMatchObject({ amount: null, currency: 'GBP' })
    expect(() => planning.billing.setSettings(project.id, { hourlyRate: 1.5 })).toThrow(
      /hourly rate/
    )
    expect(() => planning.billing.setSettings(project.id, { rate: 1 })).toThrow(/Billing settings/)
  })

  it('rounds the amount once, at the end of each total, not per entry', async () => {
    const { project, design, build } = await studio()
    planning.billing.setSettings(project.id, { hourlyRate: 100, newTimeBillable: true })
    for (const day of [5, 6, 7]) log(project.id, design.id, at(day, 9), MINUTE)
    log(project.id, build.id, at(8, 9), MINUTE)
    // Each minute is 1.67p; per entry that would round to 2p each, 8p in all.
    expect(billableAmount(MINUTE, 100)).toBe(2)
    const report = planning.billing.report(project.id, '2026-10-01', '2026-10-31')
    expect(report.totals).toEqual({ seconds: 4 * MINUTE, billableSeconds: 4 * MINUTE, amount: 7 })
    const byTask = Object.fromEntries(report.unbilled.tasks.map((task) => [task.title, task]))
    expect(byTask.Design.amount).toBe(5)
    expect(byTask.Build.amount).toBe(2)
    expect(byTask.Design.entries).toHaveLength(3)
  })

  it('has no amount without a rate, and counts only billable time', async () => {
    const { project, design } = await studio()
    log(project.id, design.id, at(5, 9), HOUR)
    planning.time.create(project.id, {
      workItemId: design.id,
      startedAt: at(6, 9),
      durationSeconds: HOUR,
      billable: true
    })
    const report = planning.billing.report(project.id, '2026-10-01', '2026-10-31')
    expect(report.totals).toEqual({ seconds: 2 * HOUR, billableSeconds: HOUR, amount: null })
  })

  it('puts an entry on the day it started, even across midnight', async () => {
    const { project, design } = await studio()
    planning.billing.setSettings(project.id, { newTimeBillable: true, hourlyRate: 1000 })
    log(project.id, design.id, at(30, 23, 30, 8), HOUR) // 30 September, into 1 October
    log(project.id, design.id, at(31, 23, 30), HOUR) // 31 October, into 1 November
    log(project.id, design.id, at(1, 0, 15, 10), HOUR) // 1 November
    const october = planning.billing.report(project.id, '2026-10-01', '2026-10-31')
    expect(october.totals.seconds).toBe(HOUR)
    expect(october.unbilled.tasks[0].entries.map((entry) => entry.startedAt)).toEqual([
      at(31, 23, 30)
    ])
    expect(() => planning.billing.report(project.id, '2026-10-31', '2026-10-01')).toThrow(
      /date range/
    )
  })

  it('shows a running timer as running, and leaves it out of totals and billing', async () => {
    const { project, design } = await studio()
    planning.billing.setSettings(project.id, { newTimeBillable: true, hourlyRate: 1000 })
    const started = Date.now() - 10 * MINUTE * 1000
    const month = thisMonth(new Date(started))
    planning.time.startTimer(project.id, design.id, started)
    const report = planning.billing.report(project.id, month.from, month.to)
    expect(report.running).toHaveLength(1)
    expect(report.totals.seconds).toBe(0)
    expect(() => planning.billing.markBilled(project.id, month)).toThrow(/no unbilled/)
    planning.time.stopTimer()
  })

  it('works out this month for the default range', () => {
    expect(thisMonth(new Date(2026, 1, 14))).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(thisMonth(new Date(2024, 1, 3))).toEqual({ from: '2024-02-01', to: '2024-02-29' })
  })
})

describe('marking time as billed (N6.4)', () => {
  it('bills a range, locks its entries, and keeps its totals when the rate changes', async () => {
    const { project, design, build } = await studio()
    planning.billing.setSettings(project.id, { newTimeBillable: true, hourlyRate: 5000 })
    const first = log(project.id, design.id, at(2, 9), 2 * HOUR)
    const second = log(project.id, build.id, at(20, 9), 30 * MINUTE)
    const unbillable = planning.time.create(project.id, {
      workItemId: build.id,
      startedAt: at(21, 9),
      durationSeconds: HOUR,
      billable: false
    })
    const later = log(project.id, design.id, at(3, 9, 0, 10), HOUR) // November

    const billing = planning.billing.markBilled(project.id, {
      from: '2026-10-01',
      to: '2026-10-31'
    })
    expect(billing).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
      entryCount: 2,
      billableSeconds: 2.5 * HOUR,
      hourlyRate: 5000,
      amount: 12_500,
      currency: 'GBP'
    })
    expect(planning.time.get(first.id).billingId).toBe(billing.id)
    expect(planning.time.get(second.id).billingId).toBe(billing.id)
    expect(planning.time.get(unbillable.id).billingId).toBeNull()
    expect(planning.time.get(later.id).billingId).toBeNull()

    // Locked: the editor and the API refuse to change or delete it.
    expect(() => planning.time.update(project.id, first.id, { note: 'changed' })).toThrow(
      /This time was billed on .+; unmark the billing to change it/
    )
    expect(() => planning.time.update(project.id, first.id, { billable: false })).toThrow(
      /billed on/
    )
    expect(() => planning.time.delete(project.id, first.id)).toThrow(/billed on/)
    // Nothing left to bill in the range.
    expect(() =>
      planning.billing.markBilled(project.id, { from: '2026-10-01', to: '2026-10-31' })
    ).toThrow(/no unbilled billable time/)

    // A new rate changes unbilled amounts only.
    planning.billing.setSettings(project.id, { hourlyRate: 10_000 })
    const report = planning.billing.report(project.id, '2026-10-01', '2026-11-30')
    expect(report.billed).toMatchObject({ billableSeconds: 2.5 * HOUR, amount: 12_500 })
    expect(report.unbilled).toMatchObject({
      seconds: 2 * HOUR,
      billableSeconds: HOUR,
      amount: 10_000
    })
    expect(report.totals.amount).toBe(22_500)
    expect(planning.billing.listBillings(project.id)[0].amount).toBe(12_500)
  })

  it('unmarks a billing, releasing its entries, and undoes the unmark', async () => {
    const { project, design } = await studio()
    planning.billing.setSettings(project.id, { newTimeBillable: true, hourlyRate: 5000 })
    const entry = log(project.id, design.id, at(2, 9), HOUR)
    const billing = planning.billing.markBilled(project.id, {
      from: '2026-10-01',
      to: '2026-10-31'
    })

    const unmarked = planning.billing.unmark(project.id, billing.id)
    expect(unmarked).toEqual({ billing, entryIds: [entry.id] })
    expect(planning.billing.listBillings(project.id)).toEqual([])
    expect(planning.time.get(entry.id).billingId).toBeNull()
    expect(planning.time.update(project.id, entry.id, { note: 'now free' }).note).toBe('now free')

    const restored = planning.billing.restore(project.id, JSON.parse(JSON.stringify(unmarked)))
    expect(restored).toEqual(billing)
    expect(planning.time.get(entry.id).billingId).toBe(billing.id)
    expect(() => planning.time.delete(project.id, entry.id)).toThrow(/billed on/)
    expect(() => planning.billing.unmark(project.id, 'missing')).toThrow(/no longer exists/)
  })

  it('removes billings with their project', async () => {
    const { project, design } = await studio()
    planning.billing.setSettings(project.id, { newTimeBillable: true })
    log(project.id, design.id, at(2, 9), HOUR)
    planning.billing.markBilled(project.id, { from: '2026-10-01', to: '2026-10-31' })
    const deleted = deleteProjectRows(planning.database, project.id)
    expect(deleted.map((entry) => entry.table)).toEqual(expect.arrayContaining(['billings']))
  })
})

describe('the Time report CSV (N6.4)', () => {
  it('writes date, task, person, note, hours, billable, amount and billed', async () => {
    const { project, design, build } = await studio()
    planning.billing.setSettings(project.id, { newTimeBillable: true, hourlyRate: 4500 })
    const billed = log(project.id, design.id, at(2, 9), 90 * MINUTE)
    planning.time.update(project.id, billed.id, { note: 'Sketches, round 2' })
    const billing = planning.billing.markBilled(project.id, {
      from: '2026-10-01',
      to: '2026-10-02'
    })
    planning.time.create(project.id, {
      workItemId: build.id,
      startedAt: at(5, 14),
      durationSeconds: 15 * MINUTE,
      billable: false,
      personId: null
    })
    const { text } = buildTimeReportCsv(planning, project.id, '2026-10-01', '2026-10-31')
    expect(text.charCodeAt(0)).toBe(0xfeff)
    const billedDay = new Date(billing.markedAt)
    const pad = (value: number) => String(value).padStart(2, '0')
    const markedOn = `${billedDay.getFullYear()}-${pad(billedDay.getMonth() + 1)}-${pad(billedDay.getDate())}`
    expect(text.slice(1).split('\r\n')).toEqual([
      'Date,Task,Person,Note,Hours,Billable,Amount,Billed',
      `2026-10-02,Design,Alex,"Sketches, round 2",1.5,yes,67.50,${markedOn}`,
      '2026-10-05,Build,,,0.25,no,,',
      ''
    ])
  })
})

describe('billable time in the project file (N6.4)', () => {
  it('carries the rate, the default, billable flags and billings', async () => {
    const { project, design } = await studio()
    planning.billing.setSettings(project.id, { newTimeBillable: true, hourlyRate: 7000 })
    const kept = log(project.id, design.id, at(2, 9), HOUR)
    planning.billing.markBilled(project.id, { from: '2026-10-01', to: '2026-10-02' })
    planning.billing.setSettings(project.id, { hourlyRate: 9000 })
    planning.time.create(project.id, {
      workItemId: design.id,
      startedAt: at(9, 9),
      durationSeconds: HOUR,
      billable: false
    })
    const file = service.exportProjectAsPackage(project.id, {
      kind: 'export',
      relativeDates: false
    })
    expect(file.billingSettings).toEqual({ hourlyRate: 9000, newTimeBillable: true })
    expect(file.billings).toHaveLength(1)
    expect(file.billings![0]).toMatchObject({ ref: 'b1', hourlyRate: 7000, amount: 7000 })
    expect(file.timeEntries!.map((entry) => [entry.billable, entry.billingRef])).toEqual([
      [true, 'b1'],
      [undefined, undefined]
    ])
    expect(validateProjectPackage(JSON.parse(JSON.stringify(file))).ok).toBe(true)

    const { project: copy } = await service.createProjectFromPackage(file, {}, TODAY)
    expect(planning.billing.getSettings(copy.id)).toMatchObject({
      hourlyRate: 9000,
      newTimeBillable: true
    })
    const [billing] = planning.billing.listBillings(copy.id)
    expect(billing).toMatchObject({ hourlyRate: 7000, amount: 7000, entryCount: 1 })
    const entries = planning.time.listForProject(copy.id)
    expect(entries.map((entry) => [entry.billable, entry.billingId])).toEqual([
      [true, billing.id],
      [false, null]
    ])
    expect(kept.id).not.toBe(entries[0].id)
    const report = planning.billing.report(copy.id, '2026-10-01', '2026-10-31')
    expect(report.billed.amount).toBe(7000)
  })

  it('gives a template the rate and default only', async () => {
    const { project, design } = await studio()
    planning.billing.setSettings(project.id, { newTimeBillable: true, hourlyRate: 7000 })
    log(project.id, design.id, at(2, 9), HOUR)
    planning.billing.markBilled(project.id, { from: '2026-10-01', to: '2026-10-02' })
    const template = service.exportProjectAsPackage(
      project.id,
      { kind: 'template', relativeDates: true },
      TODAY
    )
    expect(template.billingSettings).toEqual({ hourlyRate: 7000, newTimeBillable: true })
    expect(template.billings).toBeUndefined()
    expect(template.timeEntries).toBeUndefined()
    const { project: used } = await service.createProjectFromPackage(template, {}, TODAY)
    expect(planning.billing.getSettings(used.id)).toMatchObject({
      hourlyRate: 7000,
      newTimeBillable: true
    })
    expect(planning.billing.listBillings(used.id)).toEqual([])
  })

  it('refuses a time entry naming a billing the file does not have', () => {
    const result = validateProjectPackage({
      format: 'ostler-project-package',
      version: 1,
      project: { name: 'Bad' },
      people: [],
      labels: [],
      goals: [],
      milestones: [],
      tasks: [{ ref: 't1', title: 'One' }],
      decisions: [],
      library: [],
      timeEntries: [
        {
          taskRef: 't1',
          startedAt: '2026-10-02T09:00:00.000Z',
          durationSeconds: 60,
          billable: true,
          billingRef: 'b9'
        }
      ]
    })
    expect(result.ok).toBe(false)
  })
})

describe('the report on its own (N6.4)', () => {
  it('builds unbilled and billed parts from entries and billings', () => {
    const entry = (id: string, billingId: string | null, seconds: number) => ({
      id,
      projectId: 'p',
      workItemId: 'w',
      workItemTitle: 'Work',
      personId: null,
      startedAt: 1,
      durationSeconds: seconds,
      note: '',
      source: 'manual' as const,
      billable: true,
      billingId,
      createdAt: 1,
      updatedAt: 1
    })
    const report = buildTimeReport({
      projectId: 'p',
      from: '2026-10-01',
      to: '2026-10-31',
      entries: [entry('a', null, HOUR), entry('b', 'bill', HOUR)],
      settings: { projectId: 'p', hourlyRate: 3000, newTimeBillable: true, currency: 'GBP' },
      billings: [
        {
          id: 'bill',
          projectId: 'p',
          from: '2026-10-01',
          to: '2026-10-15',
          markedAt: 5,
          entryCount: 1,
          billableSeconds: HOUR,
          hourlyRate: 2000,
          amount: 2000,
          currency: 'GBP'
        }
      ]
    })
    expect(report.unbilled.amount).toBe(3000)
    expect(report.billed.amount).toBe(2000)
    expect(report.totals.amount).toBe(5000)
  })
})

describe('the Time report print route (N6.4)', () => {
  it('builds and reads the same route', () => {
    const route = { projectId: 'a b', from: '2026-10-01', to: '2026-10-31' }
    const hash = timeReportHashPath(route)
    expect(hash).toBe('/print/time-report/a%20b?from=2026-10-01&to=2026-10-31')
    expect(parseTimeReportHash(hash)).toEqual(route)
    expect(parseTimeReportHash('/print/time-report/p?from=2026-13-01&to=2026-10-31')).toBeNull()
    expect(() => timeReportHashPath({ ...route, from: 'soon' })).toThrow()
  })
})
