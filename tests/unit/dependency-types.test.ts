import { describe, expect, it } from 'vitest'
import type {
  PlanningDependencyLink,
  PlanningDependencyType,
  PlanningWorkItem
} from '../../src/shared/ostler-api'
import { unmetDependencyIds } from '../../src/shared/planning/dependencies'
import { dependencyLinksOf } from '../../src/shared/planning/dependency-links'
import { criticalPath, type CriticalPathTaskInput } from '../../src/shared/planning/critical-path'
import {
  planDependentMoves,
  type DependentTask,
  type TaskDateMove
} from '../../src/shared/planning/move-dependents'
import { dependencyConflicts, dependencyLinkConflict } from '../../src/shared/planning/timeline'

// Monday 12 October 2026 to Friday 16; Saturday 17, Sunday 18.
type Dated = Pick<PlanningWorkItem, 'id' | 'startDate' | 'targetDate'>
const dated = (id: string, startDate: string | null, targetDate: string | null): Dated => ({
  id,
  startDate,
  targetDate
})
const link = (
  type: PlanningDependencyType,
  lagDays: number,
  id = 'other'
): PlanningDependencyLink => ({
  id,
  type,
  lagDays
})

describe('dependencyLinksOf (N7.2a)', () => {
  it('reads a task without links as finish to start, 0 days, in dependencyIds order', () => {
    expect(dependencyLinksOf({ dependencyIds: ['a', 'b'] })).toEqual([
      { id: 'a', type: 'finish-to-start', lagDays: 0 },
      { id: 'b', type: 'finish-to-start', lagDays: 0 }
    ])
    expect(
      dependencyLinksOf({
        dependencyIds: ['b', 'a'],
        dependencyLinks: [{ id: 'a', type: 'start-to-start', lagDays: 2 }]
      })
    ).toEqual([
      { id: 'b', type: 'finish-to-start', lagDays: 0 },
      { id: 'a', type: 'start-to-start', lagDays: 2 }
    ])
  })
})

describe('dependencyLinkConflict (N7.2a)', () => {
  // The other task runs Tuesday 13 to Thursday 15.
  const other = dated('other', '2026-10-13', '2026-10-15')

  it('finish to start: starts on or after the other is due, plus the lag', () => {
    const on = dated('task', '2026-10-15', '2026-10-16')
    expect(dependencyLinkConflict(on, link('finish-to-start', 0), other)).toBeNull()
    expect(dependencyLinkConflict(on, link('finish-to-start', 1), other)).toMatchObject({
      start: '2026-10-15',
      dependencyDue: '2026-10-15',
      earliest: '2026-10-16',
      type: 'finish-to-start',
      lagDays: 1
    })
    const early = dated('task', '2026-10-13', '2026-10-16')
    expect(dependencyLinkConflict(early, link('finish-to-start', -2), other)).toBeNull()
    expect(dependencyLinkConflict(early, link('finish-to-start', -1), other)).toMatchObject({
      earliest: '2026-10-14'
    })
  })

  it('start to start: starts on or after the other starts, plus the lag', () => {
    const task = dated('task', '2026-10-15', '2026-10-16')
    expect(dependencyLinkConflict(task, link('start-to-start', 0), other)).toBeNull()
    expect(dependencyLinkConflict(task, link('start-to-start', 2), other)).toBeNull()
    expect(dependencyLinkConflict(task, link('start-to-start', 3), other)).toMatchObject({
      start: '2026-10-15',
      dependencyDue: '2026-10-13',
      earliest: '2026-10-16'
    })
    const before = dated('task', '2026-10-12', '2026-10-12')
    expect(dependencyLinkConflict(before, link('start-to-start', 0), other)).not.toBeNull()
    expect(dependencyLinkConflict(before, link('start-to-start', -1), other)).toBeNull()
    // The other's first day is its due date when it has no start.
    const dueOnly = dated('other', null, '2026-10-15')
    expect(dependencyLinkConflict(task, link('start-to-start', 0), dueOnly)).toBeNull()
    expect(dependencyLinkConflict(task, link('start-to-start', 1), dueOnly)).not.toBeNull()
  })

  it('finish to finish: is due on or after the other is due, plus the lag', () => {
    // Starting before the other is due is fine; only the due dates count.
    const task = dated('task', '2026-10-12', '2026-10-15')
    expect(dependencyLinkConflict(task, link('finish-to-finish', 0), other)).toBeNull()
    expect(dependencyLinkConflict(task, link('finish-to-finish', 1), other)).toMatchObject({
      start: '2026-10-15',
      dependencyDue: '2026-10-15',
      earliest: '2026-10-16'
    })
    const early = dated('task', '2026-10-12', '2026-10-13')
    expect(dependencyLinkConflict(early, link('finish-to-finish', 0), other)).not.toBeNull()
    expect(dependencyLinkConflict(early, link('finish-to-finish', -2), other)).toBeNull()
    // A task without a due date has nothing to compare.
    const startOnly = dated('task', '2026-10-12', null)
    expect(dependencyLinkConflict(startOnly, link('finish-to-finish', 0), other)).toBeNull()
  })

  it('is no conflict when a date the link needs is missing', () => {
    const task = dated('task', '2026-10-12', '2026-10-12')
    const startOnly = dated('other', '2026-10-13', null)
    expect(dependencyLinkConflict(task, link('finish-to-start', 0), startOnly)).toBeNull()
    expect(dependencyLinkConflict(task, link('start-to-start', 0), startOnly)).not.toBeNull()
    expect(
      dependencyLinkConflict(dated('task', null, null), link('start-to-start', 0), other)
    ).toBeNull()
  })

  it('finish to start with no lag gives exactly the results from before types', () => {
    const tasks = [
      { ...dated('a', '2026-10-12', '2026-10-14'), dependencyIds: [] },
      { ...dated('b', '2026-10-13', '2026-10-16'), dependencyIds: ['a'] },
      { ...dated('c', null, '2026-10-14'), dependencyIds: ['a', 'b'] },
      { ...dated('d', '2026-10-14', null), dependencyIds: ['a'] }
    ]
    const plain = dependencyConflicts(tasks)
    const typed = dependencyConflicts(
      tasks.map((task) => ({ ...task, dependencyLinks: dependencyLinksOf(task) }))
    )
    expect(typed).toEqual(plain)
    expect(
      plain.map(({ taskId, dependencyId, start, dependencyDue }) => ({
        taskId,
        dependencyId,
        start,
        dependencyDue
      }))
    ).toEqual([
      { taskId: 'b', dependencyId: 'a', start: '2026-10-13', dependencyDue: '2026-10-14' },
      { taskId: 'c', dependencyId: 'b', start: '2026-10-14', dependencyDue: '2026-10-16' }
    ])
  })

  it('follows each task’s links in dependencyConflicts', () => {
    const conflicts = dependencyConflicts([
      { ...dated('plaster', '2026-10-12', '2026-10-16'), dependencyIds: [] },
      {
        ...dated('paint', '2026-10-13', '2026-10-16'),
        dependencyIds: ['plaster'],
        dependencyLinks: [link('start-to-start', 2, 'plaster')]
      }
    ])
    expect(conflicts).toEqual([
      expect.objectContaining({ taskId: 'paint', earliest: '2026-10-14', type: 'start-to-start' })
    ])
  })
})

describe('unmetDependencyIds with types (N7.2a)', () => {
  const item = (id: string, status: PlanningWorkItem['status']) =>
    ({ id, status }) as PlanningWorkItem
  const items = new Map([
    ['a', item('a', 'ready')],
    ['b', item('b', 'ready')],
    ['c', item('c', 'ready')]
  ])

  it('holds work back only on finish-to-start links', () => {
    const waiting = {
      parentWorkItemId: null,
      dependencyIds: ['a', 'b', 'c'],
      dependencyLinks: [
        link('finish-to-start', 3, 'a'),
        link('start-to-start', 0, 'b'),
        link('finish-to-finish', 0, 'c')
      ]
    }
    expect(
      unmetDependencyIds(
        waiting,
        (id) => items.get(id),
        (other) => other.status === 'done'
      )
    ).toEqual(['a'])
  })

  it('holds work back on every link of a task without types, as before', () => {
    expect(
      unmetDependencyIds(
        { parentWorkItemId: null, dependencyIds: ['a', 'b'] },
        (id) => items.get(id),
        (other) => other.status === 'done'
      )
    ).toEqual(['a', 'b'])
  })
})

describe('planDependentMoves with types (N7.2a)', () => {
  const task = (overrides: Partial<DependentTask> & { id: string }): DependentTask => ({
    title: overrides.id,
    status: 'ready',
    startDate: null,
    targetDate: null,
    dependencyIds: [],
    ...overrides
  })
  const move = (
    id: string,
    from: [string | null, string],
    to: [string | null, string]
  ): TaskDateMove => ({ id, fromStart: from[0], fromDue: from[1], toStart: to[0], toDue: to[1] })

  it('finish to start with a lag moves what is now too early for the lag', () => {
    // b starts Thursday, two days after a is due on Tuesday: fine with lag 2.
    const tasks = [
      task({ id: 'a', targetDate: '2026-10-13' }),
      task({
        id: 'b',
        startDate: '2026-10-15',
        targetDate: '2026-10-15',
        dependencyIds: ['a'],
        dependencyLinks: [link('finish-to-start', 2, 'a')]
      })
    ]
    // a one day later: b would need Friday.
    const plan = planDependentMoves(tasks, [move('a', [null, '2026-10-13'], [null, '2026-10-14'])])
    expect(plan.entries).toEqual([
      expect.objectContaining({ id: 'b', days: 1, toStart: '2026-10-16', toDue: '2026-10-16' })
    ])
    // With lag 1 the same move leaves b where it is.
    const loose = planDependentMoves(
      tasks.map((t) =>
        t.id === 'b' ? { ...t, dependencyLinks: [link('finish-to-start', 1, 'a')] } : t
      ),
      [move('a', [null, '2026-10-13'], [null, '2026-10-14'])]
    )
    expect(loose.entries).toEqual([])
  })

  it('start to start moves by how far the other’s first day moved', () => {
    const tasks = [
      task({ id: 'a', startDate: '2026-10-12', targetDate: '2026-10-16' }),
      task({
        id: 'b',
        startDate: '2026-10-13',
        targetDate: '2026-10-14',
        dependencyIds: ['a'],
        dependencyLinks: [link('start-to-start', 1, 'a')]
      })
    ]
    // a starts two days later; its due date stays.
    const plan = planDependentMoves(tasks, [
      move('a', ['2026-10-12', '2026-10-16'], ['2026-10-14', '2026-10-16'])
    ])
    expect(plan.entries).toEqual([
      expect.objectContaining({ id: 'b', days: 2, toStart: '2026-10-15', toDue: '2026-10-16' })
    ])
    // Only the due date moving later pulls nothing on a start-to-start link.
    const dueOnly = planDependentMoves(tasks, [
      move('a', ['2026-10-12', '2026-10-16'], ['2026-10-12', '2026-10-20'])
    ])
    expect(dueOnly.entries).toEqual([])
  })

  it('finish to finish moves what would now be due too early', () => {
    const tasks = [
      task({ id: 'a', startDate: '2026-10-12', targetDate: '2026-10-13' }),
      task({
        id: 'b',
        startDate: '2026-10-12',
        targetDate: '2026-10-14',
        dependencyIds: ['a'],
        dependencyLinks: [link('finish-to-finish', 0, 'a')]
      })
    ]
    // b starts before a is due: fine for finish to finish, so moving a by a day moves nothing.
    expect(
      planDependentMoves(tasks, [
        move('a', ['2026-10-12', '2026-10-13'], ['2026-10-13', '2026-10-14'])
      ]).entries
    ).toEqual([])
    // Two days: b would be due before a, so it moves two days.
    const plan = planDependentMoves(tasks, [
      move('a', ['2026-10-12', '2026-10-13'], ['2026-10-14', '2026-10-15'])
    ])
    expect(plan.entries).toEqual([
      expect.objectContaining({ id: 'b', days: 2, toStart: '2026-10-14', toDue: '2026-10-16' })
    ])
  })
})

describe('criticalPath with types (N7.2a)', () => {
  const input = (
    id: string,
    startDate: string,
    targetDate: string,
    links: PlanningDependencyLink[] = []
  ): CriticalPathTaskInput => ({
    id,
    status: 'ready',
    milestoneId: null,
    startDate,
    targetDate,
    dependencyIds: links.map((entry) => entry.id),
    dependencyLinks: links
  })
  const slack = (path: ReturnType<typeof criticalPath>) =>
    Object.fromEntries(path.tasks.map((task) => [task.taskId, task.slackDays]))

  it('finish to start with a lag takes the lag from the slack', () => {
    const tasks = [
      input('a', '2026-10-12', '2026-10-12'),
      input('b', '2026-10-15', '2026-10-16', [link('finish-to-start', 2, 'a')])
    ]
    // b may start on the 15th; a must be due by the 13th: one day of slack.
    expect(slack(criticalPath(tasks))).toEqual({ a: 1, b: 0 })
    expect(slack(criticalPath(tasks.map((t) => ({ ...t, dependencyLinks: undefined }))))).toEqual({
      a: 3,
      b: 0
    })
  })

  it('start to start ties the first days', () => {
    const tasks = [
      input('a', '2026-10-12', '2026-10-13'),
      input('b', '2026-10-14', '2026-10-16', [link('start-to-start', 2, 'a')])
    ]
    // b's latest start is the 14th, so a may start by the 12th and end by the 13th.
    const path = criticalPath(tasks)
    expect(slack(path)).toEqual({ a: 0, b: 0 })
    expect(path.chains).toEqual([['a', 'b']])
  })

  it('finish to finish ties the due dates', () => {
    const tasks = [
      input('a', '2026-10-12', '2026-10-14'),
      input('b', '2026-10-12', '2026-10-16', [link('finish-to-finish', 1, 'a')])
    ]
    // b must be due a day after a: a may end by the 15th.
    expect(slack(criticalPath(tasks))).toEqual({ a: 1, b: 0 })
  })
})
