import { describe, expect, it } from 'vitest'
import {
  buildProjectReport,
  forecastFinish,
  localIsoDate,
  parseReportRange,
  type ReportInput
} from '../../electron/services/report-builder'
import { metricsForItem, percentile } from '../../electron/services/planning-metrics'
import { formatIsoDate } from '../../src/shared/dates'
import type {
  PlanningMilestone,
  PlanningStatusTransition,
  PlanningWorkItem,
  PlanningWorkItemStatus
} from '@shared/ostler-api'

// A fixed timeline in local time: "today" is Thursday 8 October 2026, noon.
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

/** A task's history as [status, time] steps, starting from its creation. */
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

function report(overrides: Partial<ReportInput>) {
  return buildProjectReport({
    projectId: 'p',
    range: '30d',
    items: [],
    history: [],
    milestones: [],
    people: [],
    estimateUnit: 'points',
    now: NOW,
    ...overrides
  })
}

describe('project reports', () => {
  it('counts the time logged on entries that started in the range, only once a project has any (R2.3)', () => {
    expect(report({ timeEntries: [] }).keyNumbers.timeLoggedSeconds).toBeUndefined()
    const result = report({
      timeEntries: [
        { startedAt: at(10, 1), durationSeconds: 3600 },
        { startedAt: at(10, 8, 11), durationSeconds: null },
        { startedAt: at(8, 1), durationSeconds: 7200 }
      ]
    })
    // Inside the last 30 days: an hour, and the running timer's hour up to now.
    expect(result.keyNumbers.timeLoggedSeconds).toBe(3600 + 3600)
  })

  it('says there is nothing to show for an empty project, without plotting zeros', () => {
    const result = report({})
    expect(result.keyNumbers).toEqual({
      open: 0,
      doneInRange: 0,
      overdueNow: 0,
      dueNext7Days: 0,
      cycleTimeMedianMs: null,
      cycleTimeP85Ms: null,
      cycleTimeSampleSize: 0,
      leadTimeMedianMs: null,
      leadTimeSampleSize: 0
    })
    expect(result.cumulativeFlow.points).toEqual([])
    expect(result.cumulativeFlow.summary).toMatch(/no tasks yet/)
    expect(result.throughput.weeks).toEqual([])
    expect(result.throughput.summary).toMatch(/Nothing has been finished yet/)
    expect(result.cycleTime.sampleSize).toBe(0)
    expect(result.cycleTime.summary).toMatch(/no cycle time to show/)
    expect(result.burnUp).toEqual([])
    expect(result.workload.rows).toEqual([])
    expect(result.atRisk.summary).toMatch(/^Nothing is at risk/)
    expect(result.from).toBe('2026-09-09')
    expect(result.to).toBe('2026-10-08')
    expect(result.rangeLabel).toBe('Last 30 days')
  })

  it('counts a reopened task as open work, and a task finished twice once, when it last landed', () => {
    const reopened = task({ id: 'r', status: 'active' })
    const twice = task({ id: 't', status: 'done' })
    const history = [
      ...moves('r', [
        ['ready', at(9, 1)],
        ['active', at(9, 20)],
        ['done', at(9, 25)],
        ['active', at(10, 2)]
      ]),
      ...moves('t', [
        ['ready', at(9, 1)],
        ['active', at(9, 20)],
        ['done', at(9, 22)],
        ['active', at(9, 24)],
        ['done', at(10, 6)]
      ])
    ]
    expect(metricsForItem(reopened, history, NOW).completedAt).toBeNull()
    expect(metricsForItem(twice, history, NOW).completedAt).toBe(at(10, 6))
    const result = report({ items: [reopened, twice], history })
    expect(result.keyNumbers.open).toBe(1)
    expect(result.keyNumbers.doneInRange).toBe(1)
    expect(result.keyNumbers.cycleTimeMedianMs).toBe(at(10, 6) - at(9, 20))
    const byDate = new Map(result.cumulativeFlow.points.map((point) => [point.date, point.counts]))
    expect(byDate.get('2026-09-26')).toMatchObject({ done: 1, active: 1 })
    expect(byDate.get('2026-10-03')).toMatchObject({ done: 0, active: 2 })
    expect(byDate.get('2026-10-08')).toMatchObject({ done: 1, active: 1 })
    expect(result.throughput.weeks.reduce((sum, week) => sum + week.count, 0)).toBe(1)
  })

  it('starts the flow on the first task, not with zeros before the project existed', () => {
    const young = task({ id: 'y', status: 'ready', createdAt: at(10, 5) })
    const result = report({ items: [young], history: moves('y', [['ready', at(10, 5)]]) })
    expect(result.cumulativeFlow.points.map((point) => point.date)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08'
    ])
    expect(result.cumulativeFlow.summary).toContain(
      `since the first task on ${formatIsoDate('2026-10-05')}`
    )
  })

  it('draws scope added mid-range rising in the burn-up, and says done is slower', () => {
    const m = milestone({ id: 'm', name: 'Launch', targetDate: '2026-11-30' })
    const early = task({ id: 'a', milestoneId: 'm', status: 'done', estimate: 3 })
    const late1 = task({
      id: 'b',
      milestoneId: 'm',
      status: 'ready',
      createdAt: at(10, 1),
      estimate: 5
    })
    const late2 = task({
      id: 'c',
      milestoneId: 'm',
      status: 'ready',
      createdAt: at(10, 1),
      estimate: 2
    })
    const history = [
      ...moves('a', [
        ['ready', at(9, 1)],
        ['active', at(9, 10)],
        ['done', at(9, 15)]
      ]),
      ...moves('b', [['ready', at(10, 1)]]),
      ...moves('c', [['ready', at(10, 1)]])
    ]
    const [burn] = report({ items: [early, late1, late2], history, milestones: [m] }).burnUp
    expect(burn.defaultMeasure).toBe('estimate')
    const first = burn.points[0]
    const last = burn.points[burn.points.length - 1]
    expect(first).toMatchObject({ date: '2026-09-09', scopeCount: 1, doneCount: 0 })
    expect(burn.points.find((point) => point.date === '2026-09-30')).toMatchObject({
      scopeCount: 1,
      doneCount: 1,
      scopeEstimate: 3,
      doneEstimate: 3
    })
    expect(last).toMatchObject({ scopeCount: 3, doneCount: 1, scopeEstimate: 10, doneEstimate: 3 })
    expect(burn.summary).toBe(
      'Done is rising slower than scope: 2 tasks added in the last 30 days, 1 finished.'
    )
    expect(burn.estimateSummary).toBe(
      'Done is rising slower than scope: 7 points added in the last 30 days, 3 finished.'
    )
  })

  it('falls back to task counts when a task has no estimate, and says so', () => {
    const m = milestone({ id: 'm' })
    const items = [
      task({ id: 'a', milestoneId: 'm', estimate: 3 }),
      task({ id: 'b', milestoneId: 'm', estimate: null })
    ]
    const [burn] = report({ items, milestones: [m] }).burnUp
    expect(burn.defaultMeasure).toBe('count')
    expect(burn.missingEstimates).toBe(1)
    expect(burn.points.every((point) => point.scopeEstimate === null)).toBe(true)
    expect(burn.estimateSummary).toBeNull()
    expect(burn.summary).toMatch(/Shown in tasks because 1 task has no estimate\.$/)
  })

  it('leaves deleted tasks out: the report reads only the tasks it is given', () => {
    // The service passes kept tasks only (deleted ones sit in the recycle bin,
    // restored ones are back); a restored task counts from its creation.
    const restored = task({ id: 'r', status: 'ready', createdAt: at(9, 20) })
    const result = report({ items: [restored], history: moves('r', [['ready', at(9, 20)]]) })
    expect(result.keyNumbers.open).toBe(1)
    expect(result.cumulativeFlow.points[0].date).toBe('2026-09-20')
  })

  it('lists overdue, long-blocked and conflicting work, and a milestone behind pace', () => {
    const m = milestone({ id: 'm', name: 'Beta', targetDate: '2026-10-15' })
    const items = [
      task({ id: 'late', title: 'Late one', status: 'ready', targetDate: '2026-10-01' }),
      task({ id: 'stuck', status: 'blocked' }),
      task({ id: 'fresh', status: 'blocked' }),
      task({ id: 'dep', status: 'ready', targetDate: '2026-10-20' }),
      task({
        id: 'early',
        status: 'ready',
        startDate: '2026-10-12',
        targetDate: '2026-10-25',
        dependencyIds: ['dep']
      }),
      ...['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((id) =>
        task({ id, milestoneId: 'm', status: 'ready' })
      ),
      task({ id: 'won', status: 'done' })
    ]
    const history = [
      ...moves('stuck', [['blocked', at(10, 1)]]),
      ...moves('fresh', [['blocked', at(10, 7)]]),
      ...moves('won', [
        ['active', at(9, 30)],
        ['done', at(10, 5)]
      ])
    ]
    const { atRisk, keyNumbers } = report({ items, history, milestones: [m] })
    expect(keyNumbers.overdueNow).toBe(1)
    expect(atRisk.overdue.map((ref) => ref.id)).toEqual(['late'])
    expect(atRisk.blocked.map((ref) => ref.id)).toEqual(['stuck'])
    expect(atRisk.conflicts).toEqual([
      expect.objectContaining({ start: '2026-10-12', dependencyDue: '2026-10-20' })
    ])
    expect(atRisk.conflicts[0].task.id).toBe('early')
    // One finished in four weeks: 6 left would need weeks, with 7 days to go.
    expect(atRisk.lateMilestones).toHaveLength(1)
    expect(atRisk.lateMilestones[0]).toMatchObject({ milestoneId: 'm', remaining: 6, daysLeft: 7 })
    expect(atRisk.lateMilestones[0].forecast).toEqual({
      kind: 'range',
      minDays: 42,
      maxDays: null,
      weeklyRate: 0.3
    })
    expect(atRisk.summary).toBe(
      'At risk: 1 overdue task, 1 task blocked for more than 3 days, 1 dependency conflict and 1 milestone likely to be late.'
    )
  })

  it('says "not enough history" for a forecast with zero throughput, never infinity', () => {
    expect(forecastFinish(5, [0, 0, 0, 0])).toEqual({
      kind: 'not-enough-history',
      reason: expect.stringMatching(/not enough history/)
    })
    const m = milestone({ id: 'm', name: 'Gamma', targetDate: '2026-12-01' })
    const items = [task({ id: 'a', milestoneId: 'm', status: 'ready', createdAt: at(8, 1) })]
    const { atRisk } = report({ items, milestones: [m] })
    expect(atRisk.lateMilestones).toEqual([])
    expect(atRisk.unforecastMilestones).toEqual([
      { milestoneId: 'm', name: 'Gamma', reason: expect.stringMatching(/not enough history/) }
    ])
    expect(JSON.stringify(atRisk)).not.toMatch(/Infinity|null days/)
  })

  it('sums workload per person, with unassigned work last and missing estimates counted', () => {
    const items = [
      task({ id: 'a', assigneeId: 'ana', estimate: 3, targetDate: '2026-10-01' }),
      task({ id: 'b', assigneeId: 'ana', estimate: null }),
      task({ id: 'c', assigneeId: 'bo', estimate: 2 }),
      task({ id: 'd', estimate: 1 })
    ]
    const { workload } = report({
      items,
      people: [
        { id: 'ana', name: 'Ana' },
        { id: 'bo', name: 'Bo' }
      ]
    })
    expect(workload.rows).toEqual([
      {
        personId: 'ana',
        name: 'Ana',
        openCount: 2,
        estimateSum: 3,
        unestimatedCount: 1,
        overdueCount: 1
      },
      {
        personId: 'bo',
        name: 'Bo',
        openCount: 1,
        estimateSum: 2,
        unestimatedCount: 0,
        overdueCount: 0
      },
      {
        personId: null,
        name: 'Unassigned',
        openCount: 1,
        estimateSum: 1,
        unestimatedCount: 0,
        overdueCount: 0
      }
    ])
    expect(workload.summary).toBe(
      'Ana has the most open work: 2 tasks, 1 overdue. 1 open task has nobody assigned.'
    )
  })

  it('buckets cycle times and states the median and 85th percentile', () => {
    const items = [1, 2, 4, 4, 12].map((days, index) => task({ id: `t${index}`, status: 'done' }))
    const history = [1, 2, 4, 4, 12].flatMap((days, index) =>
      moves(`t${index}`, [
        ['active', at(9, 20)],
        ['done', at(9, 20) + days * DAY]
      ])
    )
    const { cycleTime, keyNumbers } = report({ items, history })
    expect(cycleTime.buckets.map((bucket) => bucket.count)).toEqual([0, 2, 2, 0, 1, 0])
    expect(keyNumbers.cycleTimeMedianMs).toBe(4 * DAY)
    expect(keyNumbers.cycleTimeP85Ms).toBe(12 * DAY)
    expect(cycleTime.summary).toBe(
      'Half of the 5 tasks finished in the last 30 days took 4 days or less from start to done; 85% took 12 days or less.'
    )
  })

  it('narrows every section to a milestone over its life', () => {
    const m = milestone({ id: 'm', name: 'Alpha', createdAt: at(9, 25) })
    const items = [task({ id: 'in', milestoneId: 'm', createdAt: at(9, 28) }), task({ id: 'out' })]
    const result = report({ items, milestones: [m], range: 'milestone:m' })
    expect(result.rangeLabel).toBe('Milestone: Alpha')
    expect(result.from).toBe('2026-09-25')
    expect(result.keyNumbers.open).toBe(1)
    expect(result.burnUp.map((burn) => burn.milestoneId)).toEqual(['m'])
    expect(() => report({ range: 'milestone:nope' })).toThrow(/not in this project/)
  })

  it('reads ranges strictly', () => {
    expect(parseReportRange(undefined)).toBe('30d')
    expect(parseReportRange('90d')).toBe('90d')
    expect(parseReportRange('milestone:abc')).toBe('milestone:abc')
    expect(() => parseReportRange('7d')).toThrow(/30d, 90d or milestone/)
    expect(percentile([], 0.5)).toBeNull()
    expect(localIsoDate(NOW)).toBe('2026-10-08')
  })

  it('computes 90 days of daily flow for 5,000 tasks without a slow-down', () => {
    const statuses: PlanningWorkItemStatus[] = ['ready', 'active', 'review', 'done']
    const items: PlanningWorkItem[] = []
    const history: PlanningStatusTransition[] = []
    for (let index = 0; index < 5_000; index += 1) {
      const created = NOW - ((index % 120) + 1) * DAY
      const steps = statuses
        .slice(0, (index % 4) + 1)
        .map(
          (status, step) => [status, created + step * 2 * DAY] as [PlanningWorkItemStatus, number]
        )
        .filter(([, time]) => time < NOW)
      items.push(
        task({
          id: `w${index}`,
          createdAt: created,
          status: steps[steps.length - 1]?.[0] ?? 'backlog',
          milestoneId: `m${index % 10}`,
          estimate: index % 5
        })
      )
      history.push(...moves(`w${index}`, steps))
    }
    const milestones = Array.from({ length: 10 }, (_, index) => milestone({ id: `m${index}` }))
    const started = performance.now()
    const result = report({ items, history, milestones, range: '90d' })
    const elapsed = performance.now() - started
    expect(result.cumulativeFlow.points).toHaveLength(90)
    // A guard against a slow-down by orders of magnitude, loose enough for a busy CI runner.
    expect(elapsed).toBeLessThan(2000)
  })
})
