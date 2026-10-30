import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import { MIGRATIONS } from '../../electron/services/database/migrations'
import {
  currentRoundStart,
  defaultRoundLength,
  followingRoundStart,
  groupRounds,
  latestDueRoundStart,
  normalizeMilestoneRepeat,
  roundEnd,
  roundLabel,
  roundName,
  shiftRoundDate
} from '../../src/shared/milestone-rounds'
import type { RecurrenceRule } from '../../src/shared/recurrence'
import { createMigratedDatabase } from '../helpers/database'

const human = { kind: 'human' as const }
const MONTHLY: RecurrenceRule = { every: 'month', interval: 1, monthDay: 1 }

describe('the rounds migration (N5.7a)', () => {
  let tempDir: string
  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }))

  it('is version 37 and adds the schedule, series and source columns', async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-rounds-migration-'))
    const databasePath = await createMigratedDatabase(tempDir)
    expect(MIGRATIONS.find((migration) => migration.name === 'milestone-rounds')?.version).toBe(37)
    const db = new Database(databasePath, { readonly: true })
    try {
      const columns = (table: string) =>
        (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
          (column) => column.name
        )
      expect(columns('planning_milestones')).toEqual(
        expect.arrayContaining([
          'repeat_rule',
          'repeat_length_days',
          'repeat_next_start',
          'repeat_on',
          'round_start',
          'previous_round_id',
          'round_started_by_schedule_at'
        ])
      )
      expect(columns('planning_work_items')).toContain('round_source_id')
    } finally {
      db.close()
    }
  })
})

describe('round rules (N5.7a)', () => {
  it('names a round for each kind of rule', () => {
    expect(roundLabel(MONTHLY, '2027-05-01')).toBe('May 2027')
    expect(roundLabel({ every: 'month', interval: 3, monthDay: 1 }, '2027-04-01')).toBe('Q2 2027')
    expect(roundLabel({ every: 'year', interval: 1 }, '2027-04-06')).toBe('2027')
    expect(roundLabel({ every: 'week', interval: 1, weekdays: [1] }, '2027-05-03')).toBe(
      '3 May 2027'
    )
    expect(roundName('Accounts', MONTHLY, '2027-05-01')).toBe('Accounts · May 2027')
    expect(roundName('x'.repeat(200), MONTHLY, '2027-05-01').length).toBeLessThanOrEqual(160)
  })

  it('moves dates by whole months for monthly rounds, the 31st to a shorter month’s end', () => {
    expect(shiftRoundDate('2027-03-31', '2027-03-01', '2027-04-01', MONTHLY)).toBe('2027-04-30')
    expect(shiftRoundDate('2027-03-10', '2027-03-01', '2027-04-01', MONTHLY)).toBe('2027-04-10')
    expect(shiftRoundDate('2027-12-15', '2027-12-01', '2028-01-01', MONTHLY)).toBe('2028-01-15')
    const weekly: RecurrenceRule = { every: 'week', interval: 1, weekdays: [1] }
    expect(shiftRoundDate('2027-05-05', '2027-05-03', '2027-05-10', weekly)).toBe('2027-05-12')
  })

  it('finds the following start and only the latest one that is due', () => {
    expect(followingRoundStart(MONTHLY, '2027-04-01')).toBe('2027-05-01')
    expect(latestDueRoundStart(MONTHLY, '2027-05-01', '2027-04-30')).toBeNull()
    expect(latestDueRoundStart(MONTHLY, '2027-05-01', '2027-05-01')).toBe('2027-05-01')
    expect(latestDueRoundStart(MONTHLY, '2027-05-01', '2027-07-15')).toBe('2027-07-01')
    expect(roundEnd('2027-05-01', 10)).toBe('2027-05-10')
    expect(defaultRoundLength('2027-04-01', '2027-04-10')).toBe(10)
    expect(defaultRoundLength(null, '2027-04-10')).toBe(7)
  })

  it('works out when a round started: its own day, its tasks, its target date or today', () => {
    const today = '2027-01-01'
    expect(currentRoundStart({ roundStart: '2027-03-02', targetDate: null }, [], today)).toBe(
      '2027-03-02'
    )
    expect(
      currentRoundStart({ targetDate: '2027-03-10' }, ['2027-03-04', null, '2027-03-01'], today)
    ).toBe('2027-03-01')
    expect(currentRoundStart({ targetDate: '2027-03-10' }, ['2027-04-01'], today)).toBe(
      '2027-03-04'
    )
    expect(currentRoundStart({ targetDate: null }, [], today)).toBe(today)
  })

  it('checks a schedule', () => {
    expect(
      normalizeMilestoneRepeat({ rule: MONTHLY, lengthDays: 10, nextStart: '2027-05-01' })
    ).toEqual({ rule: MONTHLY, lengthDays: 10, nextStart: '2027-05-01' })
    expect(() =>
      normalizeMilestoneRepeat({ rule: MONTHLY, lengthDays: 0, nextStart: '2027-05-01' })
    ).toThrow()
    expect(() =>
      normalizeMilestoneRepeat({ rule: MONTHLY, lengthDays: 5, nextStart: 'May' })
    ).toThrow()
  })

  it('groups a series, latest first, where its latest round stands', () => {
    const m = (id: string, name: string, previousRoundId: string | null = null) => ({
      id,
      name,
      previousRoundId,
      createdAt: 0
    })
    const series = groupRounds([
      m('a', 'Accounts'),
      m('x', 'Launch'),
      m('c', 'Accounts · Jun', 'b'),
      m('b', 'Accounts · May', 'a')
    ])
    expect(
      series.map((entry) => [entry.name, entry.latest.id, entry.earlier.map((e) => e.id)])
    ).toEqual([
      ['Launch', 'x', []],
      ['Accounts', 'c', ['b', 'a']]
    ])
  })
})

describe('repeating rounds (N5.7a)', () => {
  let tempDir: string
  let planning: PlanningService

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2027, 2, 20, 10, 0))
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ostler-rounds-'))
    planning = new PlanningService(await createMigratedDatabase(tempDir), () => ['p1'])
  })

  afterEach(() => {
    planning.close()
    vi.useRealTimers()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  /** Accounts: 1 to 10 March 2027, with a goal, a subtask, a waits-on link and more. */
  function accounts() {
    const goal = planning.createGoal('p1', { title: 'Keep the books' })
    const milestone = planning.createMilestone('p1', {
      name: 'Accounts',
      outcome: 'Books closed',
      goalId: goal.id,
      targetDate: '2027-03-10',
      successCriteria: ['Bank reconciled']
    })
    const task = (title: string, extra: Record<string, unknown> = {}) =>
      planning.createWorkItem('p1', { title, milestoneId: milestone.id, ...extra }, human)
    const gather = task('Gather receipts', {
      startDate: '2027-03-01',
      targetDate: '2027-03-03',
      acceptanceCriteria: ['Shoebox', 'Email'],
      labels: ['money'],
      priority: 'high',
      estimate: 2
    })
    planning.setChecklistItemChecked(gather.id, 'Shoebox', true, human)
    const scan = task('Scan them', { parentWorkItemId: gather.id })
    const report = task('Send report', {
      targetDate: '2027-03-31',
      dependencyIds: [gather.id],
      status: 'done'
    })
    const binned = task('Old idea')
    planning.moveWorkItemToBin(binned.id, human)
    const weekly = task('Weekly check', { targetDate: '2027-03-05' })
    planning.setRecurrence(weekly.id, { rule: { every: 'week', interval: 1 } }, human)
    planning.addComment(gather.id, 'Note', human)
    return { goal, milestone, gather, scan, report, binned, weekly }
  }

  const repeatMonthly = (milestoneId: string, nextStart = '2027-04-01') =>
    planning.rounds.setRepeat(milestoneId, { rule: MONTHLY, lengthDays: 10, nextStart })

  const tasksOf = (milestoneId: string) =>
    planning.listWorkItems('p1').filter((item) => item.milestoneId === milestoneId)

  it('sets a schedule and previews the next round, leaving repeating tasks out', () => {
    const { milestone } = accounts()
    const repeating = repeatMonthly(milestone.id)
    expect(repeating.repeat).toEqual({
      rule: MONTHLY,
      lengthDays: 10,
      nextStart: '2027-04-01',
      on: true
    })
    expect(repeating.roundStart).toBe('2027-03-01')
    expect(
      planning.rounds.preview(milestone.id, {
        rule: MONTHLY,
        lengthDays: 10,
        nextStart: '2027-04-01'
      })
    ).toEqual({
      name: 'Accounts · April 2027',
      start: '2027-04-01',
      end: '2027-04-10',
      taskCount: 3,
      repeatingCount: 1
    })
    expect(() => repeatMonthly(milestone.id, '2027-02-01')).toThrow(/after this round/)
  })

  it('makes the next round now: the milestone, fresh copies and the schedule moved on', () => {
    const { goal, milestone, gather, scan, report } = accounts()
    repeatMonthly(milestone.id)
    const round = planning.rounds.startNextRound(milestone.id, human)

    expect(round).toMatchObject({
      name: 'Accounts · April 2027',
      outcome: 'Books closed',
      goalId: goal.id,
      targetDate: '2027-04-10',
      successCriteria: ['Bank reconciled'],
      status: 'planned',
      previousRoundId: milestone.id,
      roundStart: '2027-04-01',
      repeat: { rule: MONTHLY, lengthDays: 10, nextStart: '2027-05-01', on: true }
    })
    const earlier = planning.listMilestones('p1').find((entry) => entry.id === milestone.id)!
    expect(earlier.repeat).toBeUndefined()
    expect(earlier.roundStart).toBe('2027-03-01')
    // The earlier round keeps its tasks.
    expect(
      tasksOf(milestone.id)
        .map((item) => item.title)
        .sort()
    ).toEqual(['Gather receipts', 'Scan them', 'Send report', 'Weekly check'].sort())

    const copies = tasksOf(round.id)
    expect(copies.map((item) => item.title)).toEqual([
      'Gather receipts',
      'Scan them',
      'Send report'
    ])
    const [gatherCopy, scanCopy, reportCopy] = copies
    expect(gatherCopy).toMatchObject({
      status: 'backlog',
      startDate: '2027-04-01',
      targetDate: '2027-04-03',
      acceptanceCriteria: ['Shoebox', 'Email'],
      checkedCriteria: [],
      labels: ['money'],
      priority: 'high',
      estimate: 2,
      roundSourceId: gather.id
    })
    // The 31st lands on the last day of a shorter month.
    expect(reportCopy).toMatchObject({
      status: 'backlog',
      targetDate: '2027-04-30',
      dependencyIds: [gatherCopy.id],
      roundSourceId: report.id
    })
    expect(scanCopy).toMatchObject({ parentWorkItemId: gatherCopy.id, roundSourceId: scan.id })
    // No "(copy)" and no "copied from" link; comments stay behind.
    expect(planning.listWorkItemLinks(gatherCopy.id)).toEqual([])
    expect(planning.listComments(gatherCopy.id)).toEqual([])
    // Activity records the new round.
    expect(
      planning
        .listActivity('p1', gatherCopy.id)
        .entries.filter((entry) => entry.field === 'round')
        .map((entry) => entry.summary)
    ).toEqual([expect.stringContaining('Accounts · April 2027')])
  })

  it('refuses to start a round of a milestone that does not repeat or is not the latest', () => {
    const { milestone } = accounts()
    expect(() => planning.rounds.startNextRound(milestone.id, human)).toThrow(/doesn’t repeat/)
    repeatMonthly(milestone.id)
    planning.rounds.startNextRound(milestone.id, human)
    expect(() => repeatMonthly(milestone.id, '2027-07-01')).toThrow(/latest round/)
  })

  it('stops repeating and keeps the history', () => {
    const { milestone } = accounts()
    repeatMonthly(milestone.id)
    const round = planning.rounds.startNextRound(milestone.id, human)
    const stopped = planning.rounds.stopRepeating(round.id)
    expect(stopped.repeat?.on).toBe(false)
    expect(planning.rounds.startDueRounds(['p1'], '2027-09-01')).toEqual([])
    expect(planning.listMilestones('p1')).toHaveLength(2)
    expect(() => planning.rounds.startNextRound(round.id, human)).toThrow(/doesn’t repeat/)
  })

  it('makes a round on its start date, and only the latest one that is due', () => {
    const { milestone } = accounts()
    repeatMonthly(milestone.id)
    expect(planning.rounds.startDueRounds(['p1'], '2027-03-31')).toEqual([])
    const made = planning.rounds.startDueRounds(['p1'], '2027-07-15')
    expect(made.map((round) => round.name)).toEqual(['Accounts · July 2027'])
    expect(made[0].repeat?.nextStart).toBe('2027-08-01')
    // Dates move from March to July.
    expect(tasksOf(made[0].id).find((item) => item.title === 'Gather receipts')?.targetDate).toBe(
      '2027-07-03'
    )
    // Nothing more is due until August.
    expect(planning.rounds.startDueRounds(['p1'], '2027-07-31')).toEqual([])
    expect(planning.listMilestones('p1')).toHaveLength(2)
    // Projects not asked about are left alone.
    expect(planning.rounds.startDueRounds([], '2027-09-01')).toEqual([])
  })

  it('repeats a milestone with no tasks yet, and copies the tasks it has by then', () => {
    const empty = planning.createMilestone('p1', { name: 'Newsletter', targetDate: '2027-03-10' })
    const repeating = repeatMonthly(empty.id)
    expect(repeating.repeat?.on).toBe(true)
    expect(
      planning.rounds.preview(empty.id, { rule: MONTHLY, lengthDays: 10, nextStart: '2027-04-01' })
    ).toMatchObject({ taskCount: 0, repeatingCount: 0 })
    planning.createWorkItem('p1', { title: 'Write it', milestoneId: empty.id }, human)
    const round = planning.rounds.startNextRound(empty.id, human)
    expect(tasksOf(round.id).map((item) => item.title)).toEqual(['Write it'])
  })

  it('shares Copy task’s copying code: Copy task still marks the copy and links it', () => {
    const { gather, milestone } = accounts()
    const { workItem, link } = planning.copyWorkItem(gather.id, human)
    expect(workItem.title).toBe('Gather receipts (copy)')
    // Copy task keeps the milestone; a round's copies go to the new round instead.
    expect(workItem.milestoneId).toBe(milestone.id)
    expect(workItem.roundSourceId).toBeUndefined()
    expect(link.kind).toBe('copied-from')
  })

  it('lets a later round start its own series when its earlier round is deleted', () => {
    const milestone = planning.createMilestone('p1', { name: 'Fete', targetDate: '2027-03-10' })
    repeatMonthly(milestone.id)
    const round = planning.rounds.startNextRound(milestone.id, human)
    planning.deleteMilestone(milestone.id)
    expect(
      planning.listMilestones('p1').find((entry) => entry.id === round.id)?.previousRoundId
    ).toBeUndefined()
  })
})
