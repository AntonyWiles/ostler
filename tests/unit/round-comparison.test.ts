import { describe, expect, it } from 'vitest'
import {
  buildRoundComparison,
  type RoundComparisonInput
} from '../../electron/services/round-comparison'
import { buildProjectReport } from '../../electron/services/report-builder'
import { roundComparisonCsv } from '../../src/shared/export/rounds-csv'
import type {
  PlanningMilestone,
  PlanningStatusTransition,
  PlanningWorkItem,
  PlanningWorkItemStatus
} from '@shared/ostler-api'

// "Today" is Thursday 8 October 2026, noon, local time.
const DAY = 86_400_000
const at = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour).getTime()
const NOW = at(10, 8)

function task(overrides: Partial<PlanningWorkItem> & { id: string }): PlanningWorkItem {
  return {
    projectId: 'p',
    milestoneId: null,
    title: overrides.id,
    description: '',
    status: 'backlog',
    priority: 'medium',
    labels: [],
    acceptanceCriteria: [],
    dependencyIds: [],
    targetDate: null,
    startDate: null,
    assigneeId: null,
    estimate: null,
    checkedCriteria: [],
    origin: 'human',
    linkedHarnessTaskId: null,
    autoQueue: false,
    parentWorkItemId: null,
    taskCode: '',
    phaseCode: '',
    phaseName: '',
    subtaskPhaseNumber: null,
    subtaskPhaseName: '',
    verificationStatus: 'unverified',
    verifiedBy: null,
    verifiedAt: null,
    verificationNotes: '',
    createdAt: at(9, 1),
    updatedAt: at(9, 1),
    ...overrides
  }
}

function moves(
  id: string,
  steps: Array<[PlanningWorkItemStatus, number]>
): PlanningStatusTransition[] {
  let from: PlanningWorkItemStatus | null = null
  return steps.map(([to, time]) => {
    const event = { workItemId: id, from, to, at: time }
    from = to
    return event
  })
}

const milestone = (overrides: Partial<PlanningMilestone> & { id: string }): PlanningMilestone => ({
  projectId: 'p',
  goalId: null,
  name: overrides.id,
  outcome: '',
  targetDate: null,
  successCriteria: [],
  status: 'active',
  createdAt: at(9, 1),
  updatedAt: at(9, 1),
  ...overrides
})

// Three rounds of Accounts. September is finished, October is under way and
// November has not started.
const milestones = [
  milestone({ id: 'ms-1', name: 'Accounts', roundStart: '2026-09-01', targetDate: '2026-09-10' }),
  milestone({
    id: 'ms-2',
    name: 'Accounts · October 2026',
    previousRoundId: 'ms-1',
    roundStart: '2026-10-01',
    targetDate: '2026-10-10',
    createdAt: at(10, 1, 0)
  }),
  milestone({
    id: 'ms-3',
    name: 'Accounts · November 2026',
    previousRoundId: 'ms-2',
    roundStart: '2026-11-01',
    targetDate: '2026-11-10',
    createdAt: at(10, 8, 0)
  }),
  milestone({ id: 'other', name: 'Website' })
]

const items = [
  task({ id: 'a1', milestoneId: 'ms-1', title: 'Gather receipts', status: 'done' }),
  task({ id: 'a2', milestoneId: 'ms-1', title: 'Reconcile', status: 'done' }),
  // Renamed in October; still the same row.
  task({
    id: 'b1',
    milestoneId: 'ms-2',
    title: 'Collect receipts',
    status: 'done',
    roundSourceId: 'a1',
    createdAt: at(10, 1, 1)
  }),
  task({
    id: 'b2',
    milestoneId: 'ms-2',
    title: 'Reconcile',
    status: 'active',
    roundSourceId: 'a2',
    createdAt: at(10, 1, 1)
  }),
  // Added in October.
  task({ id: 'b4', milestoneId: 'ms-2', title: 'File the return', createdAt: at(10, 1, 2) }),
  // Its source is gone: a row of its own rather than a failure.
  task({
    id: 'b5',
    milestoneId: 'ms-2',
    title: 'Pay the bill',
    roundSourceId: 'missing',
    createdAt: at(10, 1, 3)
  }),
  task({
    id: 'c1',
    milestoneId: 'ms-3',
    title: 'Collect receipts',
    roundSourceId: 'b1',
    createdAt: at(10, 8, 1)
  }),
  task({ id: 'x', milestoneId: 'other', status: 'done' })
]

const wontDo = [
  task({
    id: 'a3',
    milestoneId: 'ms-1',
    title: 'Old step',
    resolution: 'wont-do',
    archivedAt: at(9, 4)
  })
]

const history = [
  ...moves('a1', [
    ['backlog', at(9, 1)],
    ['active', at(9, 2)],
    ['done', at(9, 5)]
  ]),
  ...moves('a2', [
    ['backlog', at(9, 1)],
    ['active', at(9, 3)],
    ['done', at(9, 9)]
  ]),
  ...moves('b1', [
    ['backlog', at(10, 1, 1)],
    ['active', at(10, 1, 13)],
    ['done', at(10, 6, 13)]
  ]),
  ...moves('b2', [
    ['backlog', at(10, 1, 1)],
    ['active', at(10, 2)]
  ]),
  ...moves('x', [
    ['active', at(9, 1)],
    ['done', at(9, 2)]
  ])
]

function compare(overrides: Partial<RoundComparisonInput> = {}) {
  return buildRoundComparison({
    projectId: 'p',
    milestoneId: 'ms-2',
    milestones,
    items,
    wontDo,
    history,
    now: NOW,
    ...overrides
  })
}

describe('Compare rounds (N5.7b)', () => {
  it('follows the series from any of its rounds, oldest first', () => {
    for (const milestoneId of ['ms-1', 'ms-2', 'ms-3']) {
      const result = compare({ milestoneId })
      expect(result.seriesName).toBe('Accounts')
      expect(result.rounds.map((round) => round.milestoneId)).toEqual(['ms-1', 'ms-2', 'ms-3'])
    }
    expect(compare({ milestoneId: 'other' }).rounds.map((round) => round.milestoneId)).toEqual([
      'other'
    ])
    expect(() => compare({ milestoneId: 'nope' })).toThrow()
  })

  it('says how long each round took against its plan, including rounds with nothing finished', () => {
    const [september, october, november] = compare().rounds
    expect(september).toMatchObject({
      start: '2026-09-01',
      plannedDays: 10,
      firstStartedAt: at(9, 2),
      lastFinishedAt: at(9, 9),
      tookDays: 8,
      finished: true,
      done: 2,
      wontDo: 1,
      open: 0
    })
    expect(september.summary).toBe(
      'Accounts took 8 days of 10 days planned: 2 done, 1 won’t do, 0 still open.'
    )
    // Under way: counted to today, not finished.
    expect(october).toMatchObject({
      plannedDays: 10,
      tookDays: 8,
      finished: false,
      lastFinishedAt: null,
      done: 1,
      open: 3
    })
    expect(october.summary).toMatch(/has run 8 days so far/)
    expect(november).toMatchObject({ tookDays: null, finished: false, done: 0, open: 1 })
    expect(november.summary).toMatch(/has not started/)
  })

  it('follows each task through its source, renamed, added and dropped tasks included', () => {
    const result = compare()
    const rows = result.tasks.map((row) => [
      row.title,
      row.cells.map((cell) => cell?.workItemId ?? null)
    ])
    expect(rows).toEqual([
      ['Collect receipts', ['a1', 'b1', 'c1']],
      ['Reconcile', ['a2', 'b2', null]],
      ['Old step', ['a3', null, null]],
      ['File the return', [null, 'b4', null]],
      ['Pay the bill', [null, 'b5', null]]
    ])
    expect(result.tasks[2].cells[0]).toMatchObject({ outcome: 'wont-do', cycleTimeMs: null })
    expect(result.tasks[1].cells[1]).toMatchObject({ outcome: 'open', cycleTimeMs: null })
    // 3 days in September, 5 in October: October was slower.
    expect(result.tasks[0].cells[0]!.cycleTimeMs).toBe(at(9, 5) - at(9, 2))
    expect(result.tasks[0].cells[1]!.cycleTimeMs).toBe(5 * DAY)
    expect(result.tasks[0].slowestCycleRound).toBe(1)
    // One cycle time is no comparison.
    expect(result.tasks[1].slowestCycleRound).toBeNull()
  })

  it('counts cycle times and finished tasks exactly as the Overview does for the same round', () => {
    const result = compare()
    for (const [index, round] of result.rounds.entries()) {
      const report = buildProjectReport({
        projectId: 'p',
        range: `milestone:${round.milestoneId}`,
        items,
        history,
        milestones,
        people: [],
        estimateUnit: 'points',
        now: NOW
      })
      expect(report.keyNumbers.doneInRange).toBe(round.done)
      const cycles = result.tasks
        .map((row) => row.cells[index]?.cycleTimeMs ?? null)
        .filter((value): value is number => value !== null)
      expect(report.keyNumbers.cycleTimeSampleSize).toBe(cycles.length)
      if (cycles.length === 1) expect(report.keyNumbers.cycleTimeMedianMs).toBe(cycles[0])
    }
  })

  it('adds time tracked when there is any, and leaves it out without time tracking', () => {
    const without = compare()
    expect(without.hasTimeTracked).toBe(false)
    expect(without.rounds.every((round) => round.timeTrackedSeconds === 0)).toBe(true)
    expect(without.tasks.every((row) => row.slowestTimeRound === null)).toBe(true)

    const tracked = compare({
      timeEntries: [
        { workItemId: 'a1', startedAt: at(9, 3), durationSeconds: 3600 },
        { workItemId: 'b1', startedAt: at(10, 2), durationSeconds: 5400 },
        { workItemId: 'b1', startedAt: at(10, 8, 11), durationSeconds: null },
        { workItemId: 'x', startedAt: at(9, 1), durationSeconds: 9000 }
      ]
    })
    expect(tracked.hasTimeTracked).toBe(true)
    expect(tracked.rounds.map((round) => round.timeTrackedSeconds)).toEqual([3600, 9000, 0])
    expect(tracked.tasks[0].cells[1]!.timeTrackedSeconds).toBe(9000)
    expect(tracked.tasks[0].slowestTimeRound).toBe(1)

    // Time on another milestone's task alone is not this series' time.
    expect(
      compare({
        timeEntries: [{ workItemId: 'x', startedAt: at(9, 1), durationSeconds: 60 }]
      }).hasTimeTracked
    ).toBe(false)
  })

  it('writes the table as CSV, a column per round', () => {
    const lines = roundComparisonCsv(compare(), 'cycle')
      .replace(String.fromCharCode(0xfeff), '')
      .split('\r\n')
    expect(lines[0]).toBe(
      'Task,"Accounts (cycle time, days)","Accounts · October 2026 (cycle time, days)",' +
        '"Accounts · November 2026 (cycle time, days)"'
    )
    expect(lines[1]).toBe('Collect receipts,3,5,open')
    expect(lines[3]).toBe('Old step,won’t do,not in this round,not in this round')
  })
})
