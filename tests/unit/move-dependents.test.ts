import { describe, expect, it } from 'vitest'
import {
  moveDays,
  planDependentMoves,
  type DependentTask,
  type TaskDateMove
} from '../../src/shared/planning/move-dependents'

// Monday 12 October 2026 to Friday 16; Saturday 17, Sunday 18.
function task(overrides: Partial<DependentTask> & { id: string }): DependentTask {
  return {
    title: overrides.id,
    status: 'ready',
    startDate: null,
    targetDate: null,
    dependencyIds: [],
    ...overrides
  }
}

/** A moved due date (no start), from `fromDue` to `toDue`. */
const move = (id: string, fromDue: string, toDue: string): TaskDateMove => ({
  id,
  fromDue,
  toDue,
  fromStart: null,
  toStart: null
})

const toDue = (plan: ReturnType<typeof planDependentMoves>) =>
  Object.fromEntries(plan.entries.map((entry) => [entry.id, entry.toDue]))

describe('planDependentMoves (N7.1)', () => {
  it('moves a chain by the same number of days, keeping each start-to-due gap', () => {
    const tasks = [
      task({ id: 'a', targetDate: '2026-10-12' }),
      task({ id: 'b', startDate: '2026-10-13', targetDate: '2026-10-14', dependencyIds: ['a'] }),
      task({ id: 'c', startDate: '2026-10-15', targetDate: '2026-10-15', dependencyIds: ['b'] })
    ]
    // a: Monday to Wednesday, two days later.
    const plan = planDependentMoves(tasks, [move('a', '2026-10-12', '2026-10-14')])
    expect(plan.entries).toEqual([
      expect.objectContaining({
        id: 'b',
        fromStart: '2026-10-13',
        toStart: '2026-10-15',
        fromDue: '2026-10-14',
        toDue: '2026-10-16',
        dependencyId: 'a',
        days: 2
      }),
      // c starts on Saturday 17 after two days, so it lands on Monday 19.
      expect.objectContaining({ id: 'c', toStart: '2026-10-19', toDue: '2026-10-19', days: 4 })
    ])
    expect(plan.skipped).toEqual([])
  })

  it('moves both sides of a fork', () => {
    const tasks = [
      task({ id: 'a', targetDate: '2026-10-12' }),
      task({ id: 'b', targetDate: '2026-10-13', dependencyIds: ['a'] }),
      task({ id: 'c', targetDate: '2026-10-13', dependencyIds: ['a'] })
    ]
    const plan = planDependentMoves(tasks, [move('a', '2026-10-12', '2026-10-14')])
    expect(toDue(plan)).toEqual({ b: '2026-10-15', c: '2026-10-15' })
  })

  it('moves the bottom of a diamond once', () => {
    const tasks = [
      task({ id: 'a', targetDate: '2026-10-12' }),
      task({ id: 'b', targetDate: '2026-10-13', dependencyIds: ['a'] }),
      task({ id: 'c', targetDate: '2026-10-13', dependencyIds: ['a'] }),
      task({ id: 'd', targetDate: '2026-10-14', dependencyIds: ['b', 'c'] })
    ]
    const plan = planDependentMoves(tasks, [move('a', '2026-10-12', '2026-10-14')])
    expect(plan.entries.map((entry) => entry.id)).toEqual(['b', 'c', 'd'])
    expect(toDue(plan)).toEqual({ b: '2026-10-15', c: '2026-10-15', d: '2026-10-16' })
  })

  it('leaves a dependent with slack where it is', () => {
    const tasks = [
      task({ id: 'a', targetDate: '2026-10-12' }),
      // Starts Friday: still after a's new due date, Wednesday.
      task({ id: 'b', startDate: '2026-10-16', targetDate: '2026-10-16', dependencyIds: ['a'] }),
      // Starting on the day a dependency is due is not too early.
      task({ id: 'c', targetDate: '2026-10-14', dependencyIds: ['a'] })
    ]
    const plan = planDependentMoves(tasks, [move('a', '2026-10-12', '2026-10-14')])
    expect(plan.entries).toEqual([])
  })

  it('skips done and undated tasks, and does not move past a done one', () => {
    const tasks = [
      task({ id: 'a', targetDate: '2026-10-12' }),
      task({ id: 'done', status: 'done', targetDate: '2026-10-13', dependencyIds: ['a'] }),
      task({ id: 'after-done', targetDate: '2026-10-13', dependencyIds: ['done'] }),
      task({ id: 'undated', dependencyIds: ['a'] }),
      task({ id: 'start-only', startDate: '2026-10-13', dependencyIds: ['a'] })
    ]
    const plan = planDependentMoves(tasks, [move('a', '2026-10-12', '2026-10-14')])
    expect(plan.entries).toEqual([])
    expect(plan.skipped).toEqual([
      { id: 'done', title: 'done', reason: 'done' },
      { id: 'undated', title: 'undated', reason: 'undated' },
      { id: 'start-only', title: 'start-only', reason: 'undated' }
    ])
  })

  it('pulls nothing when a task moves earlier', () => {
    const tasks = [
      task({ id: 'a', targetDate: '2026-10-14' }),
      task({ id: 'b', targetDate: '2026-10-15', dependencyIds: ['a'] })
    ]
    expect(planDependentMoves(tasks, [move('a', '2026-10-14', '2026-10-12')]).entries).toEqual([])
    expect(moveDays(move('a', '2026-10-14', '2026-10-12'))).toBe(0)
    // Nor when the due date did not move (only the start did), or was cleared.
    expect(moveDays(move('a', '2026-10-14', '2026-10-14'))).toBe(0)
    expect(moveDays({ ...move('a', '2026-10-14', '2026-10-14'), toDue: null })).toBe(0)
  })

  it('lands on the working days given, Monday to Friday without them', () => {
    const tasks = [
      task({ id: 'a', targetDate: '2026-10-16' }),
      task({ id: 'b', targetDate: '2026-10-16', dependencyIds: ['a'] })
    ]
    const moves = [move('a', '2026-10-16', '2026-10-17')]
    // Saturday 17: on to Monday 19.
    expect(toDue(planDependentMoves(tasks, moves))).toEqual({ b: '2026-10-19' })
    // A person who works Saturdays.
    expect(toDue(planDependentMoves(tasks, moves, { workingDays: [1, 2, 3, 4, 5, 6] }))).toEqual({
      b: '2026-10-17'
    })
    // Tuesday to Saturday: Saturday is a working day.
    expect(toDue(planDependentMoves(tasks, moves, { workingDays: [2, 3, 4, 5, 6] }))).toEqual({
      b: '2026-10-17'
    })
    // Monday only (a day a week): on to Monday.
    expect(toDue(planDependentMoves(tasks, moves, { workingDays: [1] }))).toEqual({
      b: '2026-10-19'
    })
  })

  it('skips days off too, by the one working-day rule', () => {
    const tasks = [
      task({ id: 'a', targetDate: '2026-10-16' }),
      task({ id: 'b', targetDate: '2026-10-16', dependencyIds: ['a'] })
    ]
    const moves = [move('a', '2026-10-16', '2026-10-17')]
    const bankHoliday = {
      personId: null,
      firstDate: '2026-10-19',
      lastDate: '2026-10-19',
      name: 'Bank holiday'
    }
    const myLeave = {
      personId: 'me',
      firstDate: '2026-10-20',
      lastDate: '2026-10-20',
      name: 'Leave'
    }
    const someoneElses = {
      personId: 'sam',
      firstDate: '2026-10-21',
      lastDate: '2026-10-21',
      name: 'Leave'
    }
    // Saturday 17: past the weekend, everyone's Monday off and my Tuesday off, to Wednesday 21.
    expect(
      toDue(
        planDependentMoves(tasks, moves, {
          personId: 'me',
          daysOff: [bankHoliday, myLeave, someoneElses]
        })
      )
    ).toEqual({ b: '2026-10-21' })
    // With nobody as Me, only everyone's days off count.
    expect(
      toDue(planDependentMoves(tasks, moves, { personId: null, daysOff: [bankHoliday, myLeave] }))
    ).toEqual({ b: '2026-10-20' })
  })

  it('stops at a cycle, moving each task once', () => {
    const tasks = [
      task({ id: 'a', targetDate: '2026-10-12', dependencyIds: ['c'] }),
      task({ id: 'b', targetDate: '2026-10-13', dependencyIds: ['a'] }),
      task({ id: 'c', targetDate: '2026-10-14', dependencyIds: ['b'] })
    ]
    const plan = planDependentMoves(tasks, [move('a', '2026-10-12', '2026-10-14')])
    expect(plan.entries.map((entry) => entry.id)).toEqual(['b', 'c'])
  })

  it('never moves a task that is itself one of the moves (bulk edit)', () => {
    const tasks = [
      task({ id: 'a', targetDate: '2026-10-12' }),
      task({ id: 'b', targetDate: '2026-10-13', dependencyIds: ['a'] }),
      task({ id: 'c', targetDate: '2026-10-14', dependencyIds: ['b'] })
    ]
    const plan = planDependentMoves(tasks, [
      move('a', '2026-10-12', '2026-10-14'),
      move('b', '2026-10-13', '2026-10-15')
    ])
    expect(toDue(plan)).toEqual({ c: '2026-10-16' })
  })

  it('plans a big project in one pass', () => {
    const tasks: DependentTask[] = [task({ id: 't0', targetDate: '2026-10-12' })]
    for (let index = 1; index < 2000; index++)
      tasks.push(
        task({ id: `t${index}`, targetDate: '2026-10-12', dependencyIds: [`t${index - 1}`] })
      )
    const started = performance.now()
    const plan = planDependentMoves(tasks, [move('t0', '2026-10-12', '2026-10-13')])
    expect(plan.entries).toHaveLength(1999)
    expect(performance.now() - started).toBeLessThan(500)
  })
})
