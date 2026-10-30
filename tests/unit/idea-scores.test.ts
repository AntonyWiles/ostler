import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { MIGRATIONS, migrateOstlerDatabase } from '../../electron/services/database/migrations'
import { createMigratedDatabase } from '../helpers/database'
import {
  compareBestFirst,
  isProbablyNot,
  isQuickWin,
  isScore,
  readScore,
  sortBestFirst
} from '../../src/shared/planning/idea-scores'
import {
  describeCondition,
  matchesFilter,
  parseTaskFilter,
  type FilterableTask,
  type TaskFilterCondition
} from '../../src/shared/task-filter'
import { allTaskCsvColumns, tasksToCsv } from '../../src/shared/export/task-csv'
import { analyzeCsv, decodeCsv } from '../../src/shared/import/csv-import'
import { planBatchRows, type PlanRow } from '../../src/shared/plan-grid'
import type { PlanningWorkItem } from '../../src/shared/ostler-api'

const human = { kind: 'human' as const }

describe('the idea-scores migration (N1.1b)', () => {
  let tempDir: string
  let dbPath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-idea-scores-migration-'))
    dbPath = path.join(tempDir, 'ostler.db')
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const migrate = (upTo?: number) =>
    migrateOstlerDatabase(
      dbPath,
      { backupDir: path.join(tempDir, 'backups'), appVersion: '9.9.9' },
      upTo === undefined ? undefined : MIGRATIONS.filter((migration) => migration.version <= upTo)
    )

  it('adds impact and effort to a version 43 database, leaving its tasks unscored', async () => {
    await migrate(43)
    const before = new Database(dbPath)
    before
      .prepare(
        "INSERT INTO planning_work_items (id, project_id, title, status, priority, origin, created_at, updated_at) VALUES ('t1', 'p1', 'Kept', 'backlog', 'medium', 'human', 1, 1)"
      )
      .run()
    before.close()

    const result = await migrate()

    expect(result.from).toBe(43)
    expect(result.to).toBeGreaterThanOrEqual(44)
    const db = new Database(dbPath)
    try {
      expect(db.prepare('SELECT title, impact, effort FROM planning_work_items').all()).toEqual([
        { title: 'Kept', impact: null, effort: null }
      ])
    } finally {
      db.close()
    }
  })
})

describe('scores (N1.1b)', () => {
  it('takes whole numbers from 1 to 5 only', () => {
    for (const value of [1, 2, 3, 4, 5]) expect(isScore(value)).toBe(true)
    for (const value of [0, 6, 2.5, -1, '3', null, undefined, Number.NaN]) {
      expect(isScore(value)).toBe(false)
    }
    expect(readScore(null)).toEqual({ ok: true, value: null })
    expect(readScore(4)).toEqual({ ok: true, value: 4 })
    expect(readScore('4')).toEqual({ ok: false })
  })

  it('knows the quick wins and the "Probably not" corner', () => {
    expect(isQuickWin({ impact: 5, effort: 1 })).toBe(true)
    expect(isQuickWin({ impact: 4, effort: 2 })).toBe(true)
    expect(isQuickWin({ impact: 3, effort: 1 })).toBe(false)
    expect(isQuickWin({ impact: 5, effort: null })).toBe(false)
    expect(isProbablyNot({ impact: 1, effort: 5 })).toBe(true)
    expect(isProbablyNot({ impact: 2, effort: 4 })).toBe(true)
    expect(isProbablyNot({ impact: 3, effort: 5 })).toBe(false)
  })

  it('sorts best first: impact high to low, then effort low to high, unscored last', () => {
    const ideas = [
      { id: 'a', impact: 3, effort: 3 },
      { id: 'b', impact: null, effort: 1 },
      { id: 'c', impact: 5, effort: 4 },
      { id: 'd', impact: 5, effort: 1 },
      { id: 'e', impact: 5, effort: null },
      { id: 'f', impact: null, effort: null }
    ]
    expect(sortBestFirst(ideas).map((idea) => idea.id)).toEqual(['d', 'c', 'e', 'a', 'b', 'f'])
    // Ties keep their order.
    expect(compareBestFirst({ impact: 2, effort: 2 }, { impact: 2, effort: 2 })).toBe(0)
  })
})

describe('scores on tasks (N1.1b)', () => {
  let tempDir: string
  let planning: PlanningService

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-idea-scores-'))
    planning = new PlanningService(await createMigratedDatabase(tempDir), () => ['p1'])
  })

  afterEach(() => {
    planning.close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates and updates both scores, and null clears one', () => {
    const idea = planning.createWorkItem(
      'p1',
      { title: 'Dark mode', someday: true, impact: 4, effort: 2 },
      human
    )
    expect(idea).toMatchObject({ impact: 4, effort: 2 })
    expect(planning.getWorkItem(idea.id)).toMatchObject({ impact: 4, effort: 2 })

    expect(planning.updateWorkItem(idea.id, { effort: 5 }, human)).toMatchObject({
      impact: 4,
      effort: 5
    })
    // An update that leaves them out keeps them.
    expect(planning.updateWorkItem(idea.id, { title: 'Dark theme' }, human)).toMatchObject({
      impact: 4,
      effort: 5
    })
    expect(planning.updateWorkItem(idea.id, { impact: null }, human)).toMatchObject({
      impact: null,
      effort: 5
    })
    expect(planning.getWorkItem(idea.id)).toMatchObject({ impact: null, effort: 5 })
    expect(planning.createWorkItem('p1', { title: 'Plain' }, human)).toMatchObject({
      impact: null,
      effort: null
    })
  })

  it('refuses 0, 6, 2.5 and text, on create and update', () => {
    const idea = planning.createWorkItem('p1', { title: 'Idea', impact: 3 }, human)
    for (const bad of [0, 6, 2.5, '3', 'high']) {
      expect(() =>
        planning.updateWorkItem(idea.id, { impact: bad as unknown as number }, human)
      ).toThrow('Impact must be a whole number from 1 to 5, or empty')
      expect(() =>
        planning.createWorkItem('p1', { title: 'Other', effort: bad as unknown as number }, human)
      ).toThrow('Effort must be a whole number from 1 to 5, or empty')
    }
    expect(planning.getWorkItem(idea.id).impact).toBe(3)
  })

  it('records score changes in the activity', () => {
    const idea = planning.createWorkItem('p1', { title: 'Idea' }, human)
    planning.updateWorkItem(idea.id, { impact: 2, effort: 3 }, human)
    planning.updateWorkItem(idea.id, { impact: 5 }, human)
    const fields = planning.listActivity('p1', idea.id).entries.map((entry) => entry.field)
    expect(fields.filter((field) => field === 'impact')).toHaveLength(2)
    expect(fields.filter((field) => field === 'effort')).toHaveLength(1)
  })

  it('keeps the Someday flag through Not now and Reopen, so a reopened idea is back in Someday', () => {
    const idea = planning.createWorkItem(
      'p1',
      { title: 'Idea', someday: true, impact: 1, effort: 5 },
      human
    )
    planning.closeWorkItemsAsWontDo([idea.id], 'Too much work', human)
    const closed = planning.listWorkItems('p1', 'archived').find((item) => item.id === idea.id)!
    expect(closed).toMatchObject({
      someday: true,
      resolution: 'wont-do',
      resolutionReason: 'Too much work',
      impact: 1,
      effort: 5
    })
    const reopened = planning.unarchiveWorkItem(idea.id, human)
    expect(reopened).toMatchObject({ someday: true, resolution: null, impact: 1, effort: 5 })
  })
})

describe('the Impact and Effort filters (N1.1b)', () => {
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
  const ctx = { today: '2026-10-17', meId: null }
  const matches = (task: Partial<FilterableTask>, condition: TaskFilterCondition) =>
    matchesFilter({ ...base, ...task }, { match: 'all', conditions: [condition] }, ctx)

  it('matches set or empty, equals, less than and greater than', () => {
    expect(matches({ impact: 4 }, { field: 'impact', op: 'is', value: 'set' })).toBe(true)
    expect(matches({ impact: null }, { field: 'impact', op: 'is', value: 'set' })).toBe(false)
    expect(matches({}, { field: 'effort', op: 'is', value: 'empty' })).toBe(true)
    expect(matches({ effort: 2 }, { field: 'effort', op: 'equals', value: 2 })).toBe(true)
    expect(matches({ effort: 2 }, { field: 'effort', op: 'lessThan', value: 3 })).toBe(true)
    expect(matches({ effort: 3 }, { field: 'effort', op: 'lessThan', value: 3 })).toBe(false)
    expect(matches({ impact: 5 }, { field: 'impact', op: 'greaterThan', value: 3 })).toBe(true)
    // An empty score matches no comparison.
    expect(matches({}, { field: 'impact', op: 'lessThan', value: 3 })).toBe(false)
  })

  it('parses and describes them, refusing a value of the wrong kind', () => {
    expect(
      parseTaskFilter({ conditions: [{ field: 'impact', op: 'greaterThan', value: 3 }] })
    ).toMatchObject({ conditions: [{ field: 'impact', op: 'greaterThan', value: 3 }] })
    expect(() =>
      parseTaskFilter({ conditions: [{ field: 'effort', op: 'is', value: 'yes' }] })
    ).toThrow(/"set" or "empty"/)
    expect(describeCondition({ field: 'impact', op: 'is', value: 'set' })).toMatch(/^Impact/)
  })
})

describe('scores in CSV and the plan grid (N1.1b)', () => {
  const item = {
    id: 't1',
    title: 'Dark mode',
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

  it('writes both scores and reads them back through the import', () => {
    const text = tasksToCsv(
      [
        { ...item, impact: 4, effort: 2 },
        { ...item, id: 't2', title: 'Rewrite it', estimate: 8 }
      ],
      allTaskCsvColumns([]),
      context
    )
    const [header, first, second] = text.slice(1).split('\r\n')
    expect(header).toContain(',Impact (1-5),Effort (1-5),')
    expect(first).toContain(',4,2,')
    expect(second).toContain(',,,')

    const { plan } = analyzeCsv(
      decodeCsv(new TextEncoder().encode(text)),
      {},
      { milestones: [], people: [] },
      'en-GB'
    )
    expect(plan.tasks[0]).toMatchObject({ title: 'Dark mode', impact: 4, effort: 2 })
    expect(plan.tasks[1].impact).toBeUndefined()
    expect(plan.tasks[1]).toMatchObject({ title: 'Rewrite it', estimate: 8 })
  })

  it('leaves a score that is not 1 to 5 empty, with a warning, and keeps "Effort" an estimate', () => {
    const text = 'Title,Impact (1-5),Effort\nA,7,3\nB,2.5,\n'
    const { plan, preview } = analyzeCsv(
      decodeCsv(new TextEncoder().encode(text)),
      {},
      { milestones: [], people: [] },
      'en-GB'
    )
    expect(plan.tasks[0].impact).toBeUndefined()
    expect(plan.tasks[0].estimate).toBe(3)
    expect(plan.tasks[1].impact).toBeUndefined()
    const warnings = preview.rows.flatMap((row) => row.warnings.map((warning) => warning.field))
    expect(warnings.filter((field) => field === 'impact')).toHaveLength(2)
  })

  it('sends a plan grid row’s scores with the batch', () => {
    const row: PlanRow = {
      id: 'r',
      depth: 0,
      title: 'Idea',
      assigneeId: null,
      startDate: '',
      dueDate: '',
      estimate: null,
      waitsOn: [],
      milestoneId: '',
      labels: '',
      priority: null,
      impact: 5,
      effort: null
    }
    const [batch] = planBatchRows([row])
    expect(batch.impact).toBe(5)
    expect(batch).not.toHaveProperty('effort')
  })
})
