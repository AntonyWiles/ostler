import { describe, expect, it } from 'vitest'
import {
  criticalPath,
  MAX_CRITICAL_CHAINS,
  type CriticalPathTaskInput
} from '../../src/shared/planning/critical-path'

function task(overrides: Partial<CriticalPathTaskInput> & { id: string }): CriticalPathTaskInput {
  return {
    status: 'ready',
    milestoneId: null,
    startDate: null,
    targetDate: null,
    dependencyIds: [],
    ...overrides
  }
}

const slack = (result: ReturnType<typeof criticalPath>) =>
  Object.fromEntries(result.tasks.map((entry) => [entry.taskId, entry.slackDays]))

describe('criticalPath (N7.3)', () => {
  it('finds a chain that sets the end, first to last', () => {
    const result = criticalPath([
      task({ id: 'c', startDate: '2026-10-15', targetDate: '2026-10-16', dependencyIds: ['b'] }),
      task({ id: 'a', startDate: '2026-10-01', targetDate: '2026-10-05' }),
      task({ id: 'b', startDate: '2026-10-05', targetDate: '2026-10-15', dependencyIds: ['a'] })
    ])
    expect(result.end).toBe('2026-10-16')
    expect(result.endFrom).toBe('tasks')
    expect(result.chains).toEqual([['a', 'b', 'c']])
    expect(slack(result)).toEqual({ a: 0, b: 0, c: 0 })
    expect(result.tasks.every((entry) => entry.critical)).toBe(true)
  })

  it('gives a parallel branch its slack', () => {
    const result = criticalPath([
      task({ id: 'a', startDate: '2026-10-01', targetDate: '2026-10-02' }),
      task({ id: 'long', startDate: '2026-10-02', targetDate: '2026-10-12', dependencyIds: ['a'] }),
      task({
        id: 'short',
        startDate: '2026-10-02',
        targetDate: '2026-10-06',
        dependencyIds: ['a']
      }),
      task({ id: 'end', targetDate: '2026-10-12', dependencyIds: ['long', 'short'] })
    ])
    expect(result.chains).toEqual([['a', 'long', 'end']])
    expect(slack(result).short).toBe(6)
    const short = result.tasks.find((entry) => entry.taskId === 'short')!
    expect(short.critical).toBe(false)
    expect(short.latestEnd).toBe('2026-10-12')
  })

  it('gives two chains when they tie', () => {
    const result = criticalPath([
      task({ id: 'a', targetDate: '2026-10-01' }),
      task({ id: 'x', startDate: '2026-10-01', targetDate: '2026-10-05', dependencyIds: ['a'] }),
      task({ id: 'y', startDate: '2026-10-01', targetDate: '2026-10-05', dependencyIds: ['a'] }),
      task({
        id: 'z',
        startDate: '2026-10-05',
        targetDate: '2026-10-06',
        dependencyIds: ['x', 'y']
      })
    ])
    expect(result.chains).toEqual([
      ['a', 'x', 'z'],
      ['a', 'y', 'z']
    ])
    expect(result.moreChains).toBe(false)
  })

  it('stops listing chains at the limit', () => {
    const tasks = [task({ id: 'root', targetDate: '2026-10-01' })]
    for (let index = 0; index < MAX_CRITICAL_CHAINS + 2; index++)
      tasks.push(task({ id: `t${index}`, targetDate: '2026-10-01', dependencyIds: ['root'] }))
    const result = criticalPath(tasks)
    expect(result.chains).toHaveLength(MAX_CRITICAL_CHAINS)
    expect(result.moreChains).toBe(true)
  })

  it('measures a milestone against its date, counting its tasks and what they wait on', () => {
    const result = criticalPath(
      [
        task({ id: 'before', targetDate: '2026-10-03' }),
        task({
          id: 'm1',
          milestoneId: 'm',
          startDate: '2026-10-03',
          targetDate: '2026-10-08',
          dependencyIds: ['before']
        }),
        task({ id: 'm2', milestoneId: 'm', targetDate: '2026-10-05' }),
        task({ id: 'other', targetDate: '2026-12-01' })
      ],
      { id: 'm', targetDate: '2026-10-10' }
    )
    expect(result.milestoneId).toBe('m')
    expect(result.end).toBe('2026-10-10')
    expect(result.endFrom).toBe('milestone')
    expect(slack(result)).toEqual({ before: 2, m1: 2, m2: 5 })
    expect(result.chains).toEqual([])
  })

  it("uses a milestone's latest task when it has no date", () => {
    const result = criticalPath(
      [
        task({ id: 'before', targetDate: '2026-10-03' }),
        task({
          id: 'm1',
          milestoneId: 'm',
          startDate: '2026-10-03',
          targetDate: '2026-10-08',
          dependencyIds: ['before']
        }),
        task({ id: 'other', targetDate: '2026-12-01' })
      ],
      { id: 'm', targetDate: null }
    )
    expect(result.end).toBe('2026-10-08')
    expect(result.endFrom).toBe('tasks')
    expect(result.chains).toEqual([['before', 'm1']])
  })

  it('gives negative slack to a task already late against the end', () => {
    const result = criticalPath(
      [
        task({ id: 'a', startDate: '2026-10-01', targetDate: '2026-10-06' }),
        task({ id: 'b', startDate: '2026-10-06', targetDate: '2026-10-12', dependencyIds: ['a'] })
      ],
      null
    )
    expect(slack(result)).toEqual({ a: 0, b: 0 })
    const late = criticalPath(
      [
        task({ id: 'a', milestoneId: 'm', targetDate: '2026-10-06' }),
        task({
          id: 'b',
          milestoneId: 'm',
          startDate: '2026-10-06',
          targetDate: '2026-10-12',
          dependencyIds: ['a']
        })
      ],
      { id: 'm', targetDate: '2026-10-10' }
    )
    expect(slack(late)).toEqual({ a: -2, b: -2 })
    expect(late.chains).toEqual([['a', 'b']])
  })

  it('keeps done tasks fixed and never critical', () => {
    const result = criticalPath([
      task({ id: 'done', status: 'done', targetDate: '2026-12-01' }),
      task({ id: 'a', targetDate: '2026-10-05' }),
      task({
        id: 'b',
        startDate: '2026-10-05',
        targetDate: '2026-10-07',
        dependencyIds: ['a', 'done']
      })
    ])
    expect(result.end).toBe('2026-10-07')
    expect(result.tasks.map((entry) => entry.taskId)).toEqual(['a', 'b'])
    expect(result.chains).toEqual([['a', 'b']])
  })

  it('lists undated tasks apart', () => {
    const result = criticalPath([
      task({ id: 'a', targetDate: '2026-10-05' }),
      task({ id: 'none', dependencyIds: ['a'] }),
      task({ id: 'gone', status: 'done' })
    ])
    expect(result.undatedTaskIds).toEqual(['none'])
    expect(result.tasks.map((entry) => entry.taskId)).toEqual(['a'])
  })

  it('counts a start date alone as one day', () => {
    const result = criticalPath([
      task({ id: 'a', startDate: '2026-10-03' }),
      task({ id: 'b', targetDate: '2026-10-08' })
    ])
    expect(slack(result)).toEqual({ a: 5, b: 0 })
  })

  it('has no end when nothing is dated', () => {
    const result = criticalPath([task({ id: 'a' })])
    expect(result.end).toBeNull()
    expect(result.chains).toEqual([])
    expect(result.undatedTaskIds).toEqual(['a'])
  })

  it('stops safely on a cycle', () => {
    const result = criticalPath([
      task({ id: 'a', targetDate: '2026-10-05', dependencyIds: ['b'] }),
      task({ id: 'b', targetDate: '2026-10-07', dependencyIds: ['a'] })
    ])
    expect(result.tasks).toHaveLength(2)
  })

  it('handles a chain of 2000 tasks', () => {
    const tasks: CriticalPathTaskInput[] = []
    for (let index = 0; index < 2000; index++)
      tasks.push(
        task({
          id: `t${index}`,
          targetDate: '2026-10-05',
          dependencyIds: index > 0 ? [`t${index - 1}`] : []
        })
      )
    const result = criticalPath(tasks)
    expect(result.chains).toHaveLength(1)
    expect(result.chains[0]).toHaveLength(2000)
  })
})
