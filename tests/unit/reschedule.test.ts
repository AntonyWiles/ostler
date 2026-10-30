import { describe, expect, it } from 'vitest'
import {
  nextWorkingDays,
  planChanges,
  planReschedule,
  undoChanges,
  type RescheduleContext,
  type RescheduleTask
} from '../../src/shared/planning/reschedule'

// Thursday 15 October 2026. Tomorrow is Friday; the next working days after
// it are Monday 19 to Thursday 22.
const today = '2026-10-15'

let created = 0
function task(overrides: Partial<RescheduleTask> & { id: string }): RescheduleTask {
  created += 1
  return {
    projectId: 'p1',
    title: overrides.id,
    priority: 'medium',
    targetDate: '2026-10-10',
    startDate: null,
    estimate: null,
    estimateUnit: 'hours',
    dependencyIds: [],
    createdAt: created,
    recurring: false,
    ...overrides
  }
}

const context = (overrides: Partial<RescheduleContext> = {}): RescheduleContext => ({
  today,
  weeklyCapacityHours: null,
  ...overrides
})

const dueById = (plan: ReturnType<typeof planReschedule>) =>
  Object.fromEntries(plan.entries.map((entry) => [entry.id, entry.toDue]))

describe('planReschedule: one day', () => {
  const tasks = [task({ id: 'a' }), task({ id: 'b', targetDate: '2026-09-30' })]

  it('moves every due date to today', () => {
    expect(dueById(planReschedule(tasks, { mode: 'today' }, context()))).toEqual({
      a: today,
      b: today
    })
  })

  it('moves every due date to tomorrow', () => {
    const plan = planReschedule(tasks, { mode: 'tomorrow' }, context())
    expect(dueById(plan)).toEqual({ a: '2026-10-16', b: '2026-10-16' })
    expect(plan.entries[0]).toMatchObject({ fromDue: '2026-10-10', fromStart: null, toStart: null })
  })

  it('moves every due date to a chosen date', () => {
    expect(dueById(planReschedule(tasks, { mode: 'date', date: '2026-11-02' }, context()))).toEqual(
      { a: '2026-11-02', b: '2026-11-02' }
    )
  })

  it('refuses a date mode without a date, and leaves out tasks it would not move', () => {
    expect(() => planReschedule(tasks, { mode: 'date' }, context())).toThrow(/date/)
    const plan = planReschedule(
      [task({ id: 'same', targetDate: today }), task({ id: 'none', targetDate: null })],
      { mode: 'today' },
      context()
    )
    expect(plan.entries).toEqual([])
  })

  it('keeps the gap between start and due, and never puts the start after the due date', () => {
    const plan = planReschedule(
      [task({ id: 'a', startDate: '2026-10-06', targetDate: '2026-10-08' })],
      { mode: 'tomorrow' },
      context()
    )
    expect(plan.entries[0]).toMatchObject({ toStart: '2026-10-14', toDue: '2026-10-16' })
  })

  it('marks a repeating task', () => {
    const plan = planReschedule([task({ id: 'r', recurring: true })], { mode: 'today' }, context())
    expect(plan.entries[0].recurring).toBe(true)
  })
})

describe('planReschedule: spreading', () => {
  it('skips days that are not working days', () => {
    expect(nextWorkingDays(today, 5)).toEqual([
      '2026-10-16',
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22'
    ])
    expect(nextWorkingDays(today, 3, [6, 7])).toEqual(['2026-10-17', '2026-10-18', '2026-10-24'])
  })

  it('without a capacity, a day takes three tasks, by priority then age', () => {
    const tasks = [
      task({ id: 'low', priority: 'low', targetDate: '2026-09-01' }),
      task({ id: 'newer', targetDate: '2026-10-12' }),
      task({ id: 'older', targetDate: '2026-10-01' }),
      task({ id: 'critical', priority: 'critical', targetDate: '2026-10-14' }),
      task({ id: 'high', priority: 'high' })
    ]
    const plan = planReschedule(tasks, { mode: 'spread', days: 2 }, context())
    expect(plan.days).toEqual(['2026-10-16', '2026-10-19'])
    expect(dueById(plan)).toEqual({
      critical: '2026-10-16',
      high: '2026-10-16',
      older: '2026-10-16',
      newer: '2026-10-19',
      low: '2026-10-19'
    })
  })

  it('fills each day up to the daily hours from the weekly capacity', () => {
    // 20 h over five days: 4 h a day.
    const tasks = [
      task({ id: 'three', estimate: 3, priority: 'high' }),
      task({ id: 'two', estimate: 2 }),
      task({ id: 'unestimated' }),
      task({ id: 'four', estimate: 4, priority: 'low' })
    ]
    const plan = planReschedule(
      tasks,
      { mode: 'spread', days: 3 },
      context({ weeklyCapacityHours: 20 })
    )
    // three (3 h) + unestimated (1 h) fill Friday; two goes Monday; four Tuesday.
    expect(dueById(plan)).toEqual({
      three: '2026-10-16',
      two: '2026-10-19',
      unestimated: '2026-10-16',
      four: '2026-10-20'
    })
  })

  it('counts a points estimate as one hour', () => {
    const tasks = [
      task({ id: 'a', estimate: 8, estimateUnit: 'points' }),
      task({ id: 'b', estimate: 8, estimateUnit: 'points' })
    ]
    const plan = planReschedule(
      tasks,
      { mode: 'spread', days: 2 },
      context({ weeklyCapacityHours: 10 })
    )
    expect(dueById(plan)).toEqual({ a: '2026-10-16', b: '2026-10-16' })
  })

  it('counts the work already due on a day against it', () => {
    const plan = planReschedule(
      [task({ id: 'a', estimate: 2 })],
      { mode: 'spread', days: 2 },
      context({
        weeklyCapacityHours: 20,
        dueWork: [{ targetDate: '2026-10-16', estimate: 3, estimateUnit: 'hours' }]
      })
    )
    expect(dueById(plan)).toEqual({ a: '2026-10-19' })
  })

  it('puts what does not fit on the last day', () => {
    const tasks = ['a', 'b', 'c', 'd', 'e'].map((id) => task({ id }))
    const plan = planReschedule(tasks, { mode: 'spread', days: 1 }, context())
    expect(Object.values(dueById(plan))).toEqual(Array(5).fill('2026-10-16'))
  })

  it('uses the working days and capacity given, and defaults to five days', () => {
    // 12 h over Monday, Wednesday and Friday: 4 h a day.
    const plan = planReschedule(
      [task({ id: 'a', estimate: 4 }), task({ id: 'b', estimate: 4 })],
      { mode: 'spread' },
      context({ weeklyCapacityHours: 12, workingDays: [1, 3, 5] })
    )
    expect(plan.days).toEqual([
      '2026-10-16',
      '2026-10-19',
      '2026-10-21',
      '2026-10-23',
      '2026-10-26'
    ])
    expect(dueById(plan)).toEqual({ a: '2026-10-16', b: '2026-10-19' })
  })

  it('refuses a number of days out of range', () => {
    expect(() => planReschedule([], { mode: 'spread', days: 0 }, context())).toThrow()
    expect(() => planReschedule([], { mode: 'spread', days: 31 }, context())).toThrow()
  })
})

describe('planReschedule: dependencies', () => {
  it('warns when a moved task would start before something it waits on is due', () => {
    const plan = planReschedule(
      [
        task({ id: 'a', priority: 'critical', dependencyIds: ['dep'] }),
        task({ id: 'x', priority: 'high' }),
        task({ id: 'y', priority: 'high' }),
        task({ id: 'dep', title: 'Design', priority: 'low', targetDate: '2026-10-01' })
      ],
      { mode: 'spread', days: 2 },
      context()
    )
    const warning = {
      taskId: 'a',
      taskTitle: 'a',
      dependencyId: 'dep',
      dependencyTitle: 'Design',
      start: '2026-10-16',
      dependencyDue: '2026-10-19'
    }
    const byId = Object.fromEntries(plan.entries.map((entry) => [entry.id, entry]))
    expect(byId.a.warnings).toEqual([warning])
    expect(byId.dep.warnings).toEqual([warning])
    expect(byId.x.warnings).toEqual([])
  })

  it('warns when a task waiting on a moved one would start before it, without moving it', () => {
    const plan = planReschedule(
      [task({ id: 'a' })],
      { mode: 'date', date: '2026-10-30' },
      context({
        related: [
          {
            id: 'next',
            title: 'Build',
            targetDate: '2026-10-25',
            startDate: '2026-10-20',
            dependencyIds: ['a']
          }
        ]
      })
    )
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0].warnings).toMatchObject([{ taskId: 'next', dependencyId: 'a' }])
  })

  it('does not repeat a wait already out of order', () => {
    const plan = planReschedule(
      [task({ id: 'a', targetDate: '2026-10-12', dependencyIds: ['dep'] })],
      { mode: 'today' },
      context({
        related: [
          {
            id: 'dep',
            title: 'Design',
            targetDate: '2026-10-20',
            startDate: null,
            dependencyIds: []
          }
        ]
      })
    )
    expect(plan.entries[0].warnings).toEqual([])
  })
})

describe('changes and undo', () => {
  it('turns a plan into changes, and undo swaps them back', () => {
    const plan = planReschedule(
      [task({ id: 'a', startDate: '2026-10-08' })],
      { mode: 'tomorrow' },
      context()
    )
    const changes = planChanges(plan.entries)
    expect(changes).toEqual([
      {
        id: 'a',
        fromDue: '2026-10-10',
        toDue: '2026-10-16',
        fromStart: '2026-10-08',
        toStart: '2026-10-14'
      }
    ])
    expect(undoChanges(changes)).toEqual([
      {
        id: 'a',
        fromDue: '2026-10-16',
        toDue: '2026-10-10',
        fromStart: '2026-10-14',
        toStart: '2026-10-08'
      }
    ])
  })

  it('plans a pile of 200 tasks in one pass', () => {
    const tasks = Array.from({ length: 200 }, (_, index) =>
      task({ id: `t${index}`, estimate: (index % 4) + 1 })
    )
    const started = performance.now()
    const plan = planReschedule(
      tasks,
      { mode: 'spread', days: 10 },
      context({ weeklyCapacityHours: 40 })
    )
    expect(plan.entries).toHaveLength(200)
    expect(performance.now() - started).toBeLessThan(200)
  })
})

describe('planReschedule: days off (N3.2)', () => {
  it('spreads past everyone’s days off and the person’s own leave, not others’', () => {
    const tasks = Array.from({ length: 6 }, (_, index) => task({ id: `d${index}` }))
    const daysOff = [
      { personId: null, firstDate: '2026-10-19', lastDate: '2026-10-19', name: 'Holiday' },
      { personId: 'sam', firstDate: '2026-10-20', lastDate: '2026-10-20', name: 'Leave' },
      { personId: 'alex', firstDate: '2026-10-16', lastDate: '2026-10-16', name: 'Leave' }
    ]
    const plan = planReschedule(
      tasks,
      { mode: 'spread', days: 3 },
      context({ daysOff, personId: 'sam' })
    )
    expect(plan.days).toEqual(['2026-10-16', '2026-10-21', '2026-10-22'])
    expect(nextWorkingDays(today, 2, undefined, daysOff, null)).toEqual([
      '2026-10-16',
      '2026-10-20'
    ])
  })
})
