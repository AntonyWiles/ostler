import { describe, expect, it } from 'vitest'
import {
  UNASSIGNED,
  computeWorkload,
  countWorkingDays,
  hoursOver,
  loggedHoursByWeek,
  weekCapacityHours,
  weeksOverCapacity,
  workloadWeeks,
  type WorkloadTaskInput
} from '../../src/shared/planning/workload'
import type { TimeEntry } from '../../src/shared/ostler-api'

// Wednesday 14 October 2026; its week starts on Monday the 12th.
const today = '2026-10-14'
const weeks = workloadWeeks(today, 3) // 12 Oct, 19 Oct, 26 Oct

function task(overrides: Partial<WorkloadTaskInput>): WorkloadTaskInput {
  return {
    id: 't',
    assigneeId: 'ada',
    status: 'active',
    startDate: null,
    targetDate: null,
    estimate: null,
    estimateUnit: 'hours',
    ...overrides
  }
}

function workload(tasks: WorkloadTaskInput[], days: Record<string, number[]> = {}) {
  return computeWorkload(tasks, {
    weeks,
    today,
    workingDays: (personId) => days[personId]
  })
}

const hoursPerWeek = (rows: ReturnType<typeof workload>, personId = 'ada') =>
  weeks.map((week) => Math.round((rows.get(personId)?.weeks[week].hours ?? 0) * 100) / 100)

describe('workload weeks', () => {
  it('starts weeks on Monday and counts working days, also across a month', () => {
    expect(weeks).toEqual(['2026-10-12', '2026-10-19', '2026-10-26'])
    expect(workloadWeeks('2026-10-18', 1)).toEqual(['2026-10-12'])
    const weekdays = new Set([1, 2, 3, 4, 5])
    expect(countWorkingDays('2026-10-12', '2026-10-25', weekdays)).toBe(10)
    expect(countWorkingDays('2026-10-29', '2026-11-03', weekdays)).toBe(4)
    expect(countWorkingDays('2026-10-15', '2026-10-14', weekdays)).toBe(0)
  })
})

describe('computeWorkload (D36)', () => {
  it('spreads hours evenly over the working days from start to due', () => {
    // Thu 15 to Wed 21 Oct: Thu, Fri, Mon, Tue, Wed = 5 working days, 2 h each.
    const rows = workload([
      task({ startDate: '2026-10-15', targetDate: '2026-10-21', estimate: 10 })
    ])
    expect(hoursPerWeek(rows)).toEqual([4, 6, 0])
    expect(rows.get('ada')!.weeks['2026-10-12'].tasks).toEqual([
      { taskId: 't', hours: 4, inPoints: false }
    ])
  })

  it('puts everything on the due date when there is no start date', () => {
    const rows = workload([task({ targetDate: '2026-10-28', estimate: 8 })])
    expect(hoursPerWeek(rows)).toEqual([0, 0, 8])
  })

  it('counts overdue, unfinished work in the current week, and leaves done tasks out', () => {
    const rows = workload([
      task({ id: 'late', targetDate: '2026-10-01', estimate: 5 }),
      // 5 to 16 Oct: 5 working days before this week, 5 in it (Mon to Fri, 1 h each).
      task({ id: 'half', startDate: '2026-10-05', targetDate: '2026-10-16', estimate: 10 }),
      task({ id: 'done', targetDate: '2026-10-01', estimate: 50, status: 'done' })
    ])
    expect(hoursPerWeek(rows)).toEqual([15, 0, 0])
    expect(rows.get('ada')!.weeks['2026-10-12'].taskCount).toBe(2)
  })

  it('shows nothing planned for open tasks in past weeks', () => {
    const rows = computeWorkload([task({ targetDate: '2026-10-07', estimate: 3 })], {
      weeks: ['2026-10-05', '2026-10-12'],
      today,
      workingDays: () => undefined
    })
    expect(rows.get('ada')!.weeks['2026-10-05'].hours).toBe(0)
    expect(rows.get('ada')!.weeks['2026-10-12'].hours).toBe(3)
  })

  it('counts tasks without dates as Unscheduled', () => {
    const rows = workload([task({ estimate: 4 }), task({ id: 'u2', assigneeId: null })])
    expect(rows.get('ada')!.unscheduled).toMatchObject({ hours: 4, taskCount: 1 })
    expect(rows.get(UNASSIGNED)!.unscheduled).toMatchObject({ hours: 0, taskCount: 1 })
    expect(hoursPerWeek(rows)).toEqual([0, 0, 0])
  })

  it('counts tasks in points projects as tasks, never as hours', () => {
    const rows = workload([
      task({ id: 'p', targetDate: '2026-10-20', estimate: 8, estimateUnit: 'points' }),
      task({ id: 'h', targetDate: '2026-10-20', estimate: 3 })
    ])
    expect(rows.get('ada')!.weeks['2026-10-19']).toMatchObject({
      hours: 3,
      taskCount: 2,
      pointsTaskCount: 1
    })
  })

  it('counts a task with no estimate as one task with no hours, in every week it spans', () => {
    const rows = workload([task({ startDate: '2026-10-16', targetDate: '2026-10-27' })])
    const row = rows.get('ada')!
    expect(weeks.map((week) => row.weeks[week].taskCount)).toEqual([1, 1, 1])
    expect(hoursPerWeek(rows)).toEqual([0, 0, 0])
  })

  it('splits a week that crosses a month by its days', () => {
    // Thu 29 Oct to Tue 3 Nov: 4 working days, two in the week of 26 Oct.
    const rows = computeWorkload(
      [task({ startDate: '2026-10-29', targetDate: '2026-11-03', estimate: 8 })],
      { weeks: ['2026-10-26', '2026-11-02'], today, workingDays: () => undefined }
    )
    expect(rows.get('ada')!.weeks['2026-10-26'].hours).toBe(4)
    expect(rows.get('ada')!.weeks['2026-11-02'].hours).toBe(4)
  })

  it('is not moved by a daylight-saving change', () => {
    // Clocks go back in Europe on 25 Oct 2026 and in the US on 1 Nov 2026.
    const rows = computeWorkload(
      [task({ startDate: '2026-10-19', targetDate: '2026-11-06', estimate: 15 })],
      { weeks: ['2026-10-19', '2026-10-26', '2026-11-02'], today, workingDays: () => undefined }
    )
    const row = rows.get('ada')!
    expect(['2026-10-19', '2026-10-26', '2026-11-02'].map((w) => row.weeks[w].hours)).toEqual([
      5, 5, 5
    ])
  })

  it("follows the assignee's working days: a four-day week", () => {
    // Mon 19 to Sun 25 Oct, Monday to Thursday: 4 days, 3 h each.
    const rows = workload(
      [task({ startDate: '2026-10-19', targetDate: '2026-10-25', estimate: 12 })],
      { ada: [1, 2, 3, 4] }
    )
    expect(hoursPerWeek(rows)).toEqual([0, 12, 0])
    const fiveDay = workload([
      task({ startDate: '2026-10-19', targetDate: '2026-10-21', estimate: 12 })
    ])
    expect(hoursPerWeek(fiveDay)).toEqual([0, 12, 0])
  })

  it('puts everything on the due date when the span has no working day', () => {
    // Sat 24 to Sun 25 Oct.
    const rows = workload([
      task({ startDate: '2026-10-24', targetDate: '2026-10-25', estimate: 6 })
    ])
    expect(hoursPerWeek(rows)).toEqual([0, 6, 0])
  })

  it('works out hours over a capacity in words-ready numbers', () => {
    expect(hoursOver(46, 40)).toBe(6)
    expect(hoursOver(40, 40)).toBe(0)
    expect(hoursOver(46, null)).toBe(0)
  })
})

describe('loggedHoursByWeek', () => {
  it('adds hours per person and local week', () => {
    const entry = (personId: string | null, startedAt: Date, hours: number) =>
      ({ personId, startedAt: startedAt.getTime(), durationSeconds: hours * 3600 }) as TimeEntry
    const logged = loggedHoursByWeek(
      [
        entry('ada', new Date(2026, 9, 12, 9), 2),
        entry('ada', new Date(2026, 9, 18, 23), 1.5),
        entry(null, new Date(2026, 9, 20, 9), 1),
        entry('ada', new Date(2026, 8, 1, 9), 9)
      ],
      weeks,
      Date.now()
    )
    expect(logged.get('ada')).toEqual({ '2026-10-12': 3.5 })
    expect(logged.get(UNASSIGNED)).toEqual({ '2026-10-19': 1 })
  })
})

describe('computeWorkload: days off (N3.2)', () => {
  const daysOff = [
    { personId: null, firstDate: '2026-10-21', lastDate: '2026-10-21', name: 'Holiday' },
    { personId: 'ada', firstDate: '2026-10-22', lastDate: '2026-10-23', name: 'Leave' }
  ]

  it('spreads an estimate only over the assignee’s working days that are not off', () => {
    // 19 to 27 Oct: Ada works the 19th, 20th, 26th and 27th.
    const rows = computeWorkload(
      [task({ startDate: '2026-10-19', targetDate: '2026-10-27', estimate: 8 })],
      { weeks, today, workingDays: () => undefined, daysOff }
    )
    expect(hoursPerWeek(rows)).toEqual([0, 4, 4])
  })

  it('gives a week with days off less capacity', () => {
    expect(weekCapacityHours(40, '2026-10-19', 'ada', [1, 2, 3, 4, 5], daysOff)).toEqual({
      hours: 16,
      daysOff: [
        { date: '2026-10-21', name: 'Holiday' },
        { date: '2026-10-22', name: 'Leave' },
        { date: '2026-10-23', name: 'Leave' }
      ]
    })
    expect(weekCapacityHours(40, '2026-10-19', 'bob', undefined, daysOff)?.hours).toBe(32)
    expect(weekCapacityHours(null, '2026-10-19', 'ada', undefined, daysOff)).toBeNull()
  })
})

describe('weeksOverCapacity', () => {
  // Ada: 40 h in the week of 12 Oct; Bo: 30 h in each of 12 and 19 Oct.
  const rows = workload([
    task({ id: 'a', startDate: '2026-10-12', targetDate: '2026-10-16', estimate: 40 }),
    task({
      id: 'b',
      assigneeId: 'bo',
      startDate: '2026-10-12',
      targetDate: '2026-10-23',
      estimate: 60
    })
  ])
  const person = (id: string, weeklyCapacityHours: number | null) => ({
    id,
    weeklyCapacityHours,
    workingDays: [1, 2, 3, 4, 5]
  })

  it('says a person over capacity is over, at or under it is not, by week then person', () => {
    expect(
      weeksOverCapacity({ rows, people: [person('ada', 40), person('bo', 25)], weeks })
    ).toEqual([
      { personId: 'bo', week: '2026-10-12', hours: 30, capacity: 25, over: 5 },
      { personId: 'bo', week: '2026-10-19', hours: 30, capacity: 25, over: 5 }
    ])
    expect(weeksOverCapacity({ rows, people: [person('ada', 50)], weeks })).toEqual([])
    expect(
      weeksOverCapacity({ rows, people: [person('bo', 20), person('ada', 30)], weeks })
    ).toEqual([
      { personId: 'bo', week: '2026-10-12', hours: 30, capacity: 20, over: 10 },
      { personId: 'ada', week: '2026-10-12', hours: 40, capacity: 30, over: 10 },
      { personId: 'bo', week: '2026-10-19', hours: 30, capacity: 20, over: 10 }
    ])
  })

  it('never says someone with no capacity set is over', () => {
    expect(weeksOverCapacity({ rows, people: [person('bo', null)], weeks })).toEqual([])
  })

  it('lowers capacity for a day off', () => {
    const daysOff = [
      { personId: 'ada', firstDate: '2026-10-12', lastDate: '2026-10-12', name: 'Leave' }
    ]
    // The day off also moves Ada's 40 h onto four days; capacity drops to 32 h.
    const withLeave = computeWorkload(
      [task({ id: 'a', startDate: '2026-10-12', targetDate: '2026-10-16', estimate: 40 })],
      { weeks, today, workingDays: () => undefined, daysOff }
    )
    expect(
      weeksOverCapacity({ rows: withLeave, people: [person('ada', 40)], weeks, daysOff })
    ).toEqual([{ personId: 'ada', week: '2026-10-12', hours: 40, capacity: 32, over: 8 }])
  })
})
