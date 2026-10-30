import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { queueWorkItemForHarness } from '../../electron/services/task-intake'
import type { HarnessService } from '../../electron/services/harness-service'
import { createMigratedDatabase } from '../helpers/database'
import Database from 'better-sqlite3'
import { availableNowSql } from '../../electron/services/home-task-row'
import {
  hiddenQueueRefusal,
  hiddenReason,
  isHiddenNow,
  isNewToday
} from '../../src/shared/planning/show-from'
import {
  describeCondition,
  matchesFilter,
  parseTaskFilter,
  type FilterableTask,
  type TaskFilterCondition
} from '../../src/shared/task-filter'
import { allTaskCsvColumns, tasksToCsv } from '../../src/shared/export/task-csv'
import { analyzeCsv, decodeCsv } from '../../src/shared/import/csv-import'
import type { PlanningWorkItem, WatchedProject } from '../../src/shared/ostler-api'
import { useTempDir } from '../helpers/temp-dir'

const TODAY = '2026-10-07'
const human = { kind: 'human' as const }

describe('isHiddenNow (N1.1a)', () => {
  it('hides a task until its show-from day, and shows it from that day on', () => {
    expect(isHiddenNow({ showFrom: '2026-10-08' }, TODAY)).toBe(true)
    expect(isHiddenNow({ showFrom: TODAY }, TODAY)).toBe(false)
    expect(isHiddenNow({ showFrom: '2026-10-06' }, TODAY)).toBe(false)
    expect(isHiddenNow({ showFrom: null }, TODAY)).toBe(false)
    expect(isHiddenNow({}, TODAY)).toBe(false)
  })

  it('hides a Someday task whatever its show-from date', () => {
    expect(isHiddenNow({ someday: true }, TODAY)).toBe(true)
    expect(isHiddenNow({ someday: true, showFrom: '2026-01-01' }, TODAY)).toBe(true)
    expect(hiddenReason({ someday: true, showFrom: '2026-12-01' }, TODAY)).toEqual({
      kind: 'someday'
    })
    expect(hiddenReason({ showFrom: '2026-12-01' }, TODAY)).toEqual({
      kind: 'later',
      showFrom: '2026-12-01'
    })
  })

  it('marks a task new on its show-from day only, and never in Someday', () => {
    expect(isNewToday({ showFrom: TODAY }, TODAY)).toBe(true)
    expect(isNewToday({ showFrom: '2026-10-06' }, TODAY)).toBe(false)
    expect(isNewToday({ showFrom: TODAY, someday: true }, TODAY)).toBe(false)
  })

  it('says why an agent may not take a hidden task', () => {
    expect(hiddenQueueRefusal({ someday: true }, TODAY)).toBe('Bring it back from Someday first')
    expect(hiddenQueueRefusal({ showFrom: '2027-03-01' }, TODAY)).toBe('It is hidden until 1 March')
    expect(hiddenQueueRefusal({ showFrom: TODAY }, TODAY)).toBeNull()
  })
})

describe("Home's SQL reads the same rule", () => {
  it('keeps exactly the tasks hiddenReason calls available', () => {
    const db = new Database(':memory:')
    try {
      db.exec('CREATE TABLE probe (id INTEGER, in_triage INTEGER, someday INTEGER, show_from TEXT)')
      const cases = []
      let id = 0
      for (const inTriage of [false, true])
        for (const someday of [false, true])
          for (const showFrom of [null, '2026-10-06', TODAY, '2026-10-08'])
            cases.push({ id: ++id, inTriage, someday, showFrom })
      const insert = db.prepare('INSERT INTO probe VALUES (?, ?, ?, ?)')
      for (const c of cases) insert.run(c.id, c.inTriage ? 1 : 0, c.someday ? 1 : 0, c.showFrom)
      const kept = (
        db
          .prepare(`SELECT id FROM probe p WHERE ${availableNowSql('p')} ORDER BY id`)
          .all(TODAY) as {
          id: number
        }[]
      ).map((row) => row.id)
      expect(kept).toEqual(cases.filter((c) => hiddenReason(c, TODAY) === null).map((c) => c.id))
      expect(kept.length).toBe(3)
    } finally {
      db.close()
    }
  })
})

describe('the Show from and Someday filters (N1.1a)', () => {
  const base: FilterableTask = {
    id: 't',
    title: 'Task',
    description: '',
    status: 'backlog',
    priority: 'medium',
    labels: [],
    acceptanceCriteria: [],
    checkedCriteria: [],
    milestoneId: null,
    targetDate: null,
    startDate: null,
    assigneeId: null,
    estimate: null,
    createdAt: 0,
    updatedAt: 0
  }
  const ctx = { today: TODAY, meId: null }
  const matches = (task: Partial<FilterableTask>, condition: TaskFilterCondition) =>
    matchesFilter({ ...base, ...task }, { match: 'all', conditions: [condition] }, ctx)
  const showFrom = (value: string, op: 'is' | 'before' | 'after' = 'is') =>
    ({ field: 'showFrom', op, value }) as TaskFilterCondition

  it('matches hidden and shown through isHiddenNow', () => {
    expect(matches({ showFrom: '2026-10-08' }, showFrom('hidden'))).toBe(true)
    expect(matches({ someday: true }, showFrom('hidden'))).toBe(true)
    expect(matches({ showFrom: TODAY }, showFrom('hidden'))).toBe(false)
    expect(matches({ showFrom: TODAY }, showFrom('shown'))).toBe(true)
    expect(matches({}, showFrom('shown'))).toBe(true)
    expect(matches({ someday: true }, showFrom('shown'))).toBe(false)
  })

  it('matches the date itself: today, none, any, before and after', () => {
    expect(matches({ showFrom: TODAY }, showFrom('today'))).toBe(true)
    expect(matches({ showFrom: '2026-10-08' }, showFrom('today'))).toBe(false)
    expect(matches({}, showFrom('none'))).toBe(true)
    expect(matches({ showFrom: TODAY }, showFrom('any'))).toBe(true)
    expect(matches({ showFrom: '2026-10-01' }, showFrom('2026-10-05', 'before'))).toBe(true)
    expect(matches({ showFrom: '2026-10-09' }, showFrom('2026-10-05', 'after'))).toBe(true)
    expect(matches({}, showFrom('2026-10-05', 'after'))).toBe(false)
  })

  it('matches Someday true or false', () => {
    const someday = (value: boolean) =>
      ({ field: 'someday', op: 'is', value }) as TaskFilterCondition
    expect(matches({ someday: true }, someday(true))).toBe(true)
    expect(matches({}, someday(true))).toBe(false)
    expect(matches({}, someday(false))).toBe(true)
  })

  it('validates both fields and describes them in words', () => {
    expect(
      parseTaskFilter({ conditions: [{ field: 'showFrom', op: 'is', value: 'hidden' }] })
    ).toEqual({ match: 'all', conditions: [{ field: 'showFrom', op: 'is', value: 'hidden' }] })
    expect(() =>
      parseTaskFilter({ conditions: [{ field: 'showFrom', op: 'is', value: 'overdue' }] })
    ).toThrow(/one of: hidden, shown, today, none, any/)
    expect(() =>
      parseTaskFilter({ conditions: [{ field: 'someday', op: 'is', value: 'yes' }] })
    ).toThrow(/true or false/)
    expect(() =>
      parseTaskFilter({ conditions: [{ field: 'showFrom', op: 'before', value: 'soon' }] })
    ).toThrow(/YYYY-MM-DD/)
    expect(describeCondition({ field: 'showFrom', op: 'is', value: 'hidden' })).toBe(
      'Show from is hidden'
    )
    expect(describeCondition({ field: 'someday', op: 'is', value: true })).toBe('Someday is yes')
  })
})

describe('show-from dates and Someday on tasks (N1.1a)', () => {
  const tempDir = useTempDir('ostler-show-from-')
  let planning: PlanningService

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 7, 10, 0))
    planning = new PlanningService(await createMigratedDatabase(tempDir()), () => ['p1'])
  })

  afterEach(() => {
    planning.close()
    vi.useRealTimers()
  })

  it('creates and updates both fields, refusing what is not a date or a flag', () => {
    const task = planning.createWorkItem('p1', { title: 'Renew', showFrom: '2027-03-01' }, human)
    expect(task).toMatchObject({ showFrom: '2027-03-01', someday: false })
    expect(planning.getWorkItem(task.id)).toMatchObject({ showFrom: '2027-03-01', someday: false })

    const parked = planning.updateWorkItem(task.id, { someday: true, showFrom: null }, human)
    expect(parked).toMatchObject({ showFrom: null, someday: true })
    expect(planning.getWorkItem(task.id)).toMatchObject({ showFrom: null, someday: true })

    expect(() =>
      planning.updateWorkItem(task.id, { someday: 'yes' as unknown as boolean }, human)
    ).toThrow(/Someday must be true or false/)
    expect(() => planning.updateWorkItem(task.id, { showFrom: 'March' }, human)).toThrow()
    // An update that leaves them out keeps them.
    expect(planning.updateWorkItem(task.id, { title: 'Renew it' }, human).someday).toBe(true)
  })

  it('records both in the activity', () => {
    const task = planning.createWorkItem('p1', { title: 'Renew' }, human)
    planning.updateWorkItem(task.id, { showFrom: '2027-03-01' }, human)
    planning.updateWorkItem(task.id, { someday: true }, human)
    planning.updateWorkItem(task.id, { someday: false }, human)
    const fields = planning.listActivity('p1', task.id).entries.map((entry) => entry.field)
    expect(fields.filter((field) => field === 'showFrom')).toHaveLength(1)
    expect(fields.filter((field) => field === 'someday')).toHaveLength(2)
  })

  it('refuses to queue a hidden task for an agent, with the reason', () => {
    const project = { id: 'p1', name: 'One', path: tempDir() } as unknown as WatchedProject
    const harness = {} as HarnessService
    const someday = planning.createWorkItem(
      'p1',
      { title: 'Idea', status: 'ready', someday: true },
      human
    )
    const later = planning.createWorkItem(
      'p1',
      { title: 'Renew', status: 'ready', showFrom: '2027-03-01' },
      human
    )
    expect(() => queueWorkItemForHarness(planning, harness, project, someday.id)).toThrow(
      'Bring it back from Someday first'
    )
    expect(() => queueWorkItemForHarness(planning, harness, project, later.id)).toThrow(
      'It is hidden until 1 March'
    )
    // Nothing was reserved.
    expect(planning.getWorkItem(later.id).linkedHarnessTaskId).toBeNull()
  })
})

describe('Show from and Someday in CSV (N1.1a)', () => {
  it('writes both columns and reads them back through the import', () => {
    const item = {
      id: 't1',
      title: 'Renew the insurance',
      description: '',
      status: 'backlog',
      priority: 'medium',
      labels: [],
      acceptanceCriteria: [],
      checkedCriteria: [],
      dependencyIds: [],
      milestoneId: null,
      targetDate: null,
      startDate: null,
      assigneeId: null,
      estimate: null,
      createdAt: 0,
      updatedAt: 0
    } as unknown as PlanningWorkItem
    const context = {
      personName: () => null,
      milestoneName: () => null,
      commentCount: () => 0,
      estimateUnit: 'points' as const
    }
    const text = tasksToCsv(
      [
        { ...item, showFrom: '2027-03-01' },
        { ...item, id: 't2', title: 'Learn the cello', someday: true }
      ],
      allTaskCsvColumns([]),
      context
    )
    const [header, first, second] = text.slice(1).split('\r\n')
    expect(header.endsWith(',Show from,Someday')).toBe(true)
    expect(first.endsWith(',2027-03-01,')).toBe(true)
    expect(second.endsWith(',,Yes')).toBe(true)

    const { plan } = analyzeCsv(
      decodeCsv(new TextEncoder().encode(text)),
      {},
      { milestones: [], people: [] },
      'en-GB'
    )
    expect(plan.tasks[0]).toMatchObject({ title: 'Renew the insurance', showFrom: '2027-03-01' })
    expect(plan.tasks[0].someday).toBeUndefined()
    expect(plan.tasks[1]).toMatchObject({ title: 'Learn the cello', someday: true })
  })
})
