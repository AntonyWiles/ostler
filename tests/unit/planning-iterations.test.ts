import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanningService } from '../../electron/services/planning-service'
import type { PlanningStatusTransition } from '../../src/shared/ostler-api'
import {
  currentIteration,
  iterationBurndown,
  nextIteration,
  rangesOverlap
} from '../../src/shared/planning/iterations'
import { matchesFilter, type TaskFilterContext } from '../../src/shared/task-filter'
import { createMigratedDatabase } from '../helpers/database'
import { useTempDir } from '../helpers/temp-dir'

/** Iterations (R6.1, D44) as the planning service keeps them. */
describe('PlanningService iterations', () => {
  const tempDir = useTempDir('ostler-iterations-')
  let service: PlanningService
  const human = { kind: 'human' } as const

  beforeEach(async () => {
    service = new PlanningService(await createMigratedDatabase(tempDir()), () => ['p1', 'p2'])
  })

  afterEach(() => {
    service.close()
  })

  const make = (name: string, startDate: string, endDate: string, projectId = 'p1') =>
    service.iterations.create(projectId, { name, startDate, endDate })
  const task = (title: string, iterationId: string | null, estimate: number | null = null) =>
    service.createWorkItem('p1', { title, iterationId, estimate }, human)

  it('creates iterations in date order and refuses an overlap, end day included', () => {
    const b = make('Two', '2026-10-15', '2026-10-28')
    const a = make('One', '2026-10-01', '2026-10-14')
    expect(service.iterations.list('p1').map((i) => i.id)).toEqual([a.id, b.id])
    expect(a.status).toBe('planned')
    expect(() => make('Clash', '2026-10-14', '2026-10-20')).toThrow(/One/)
    expect(() => service.iterations.update(b.id, { startDate: '2026-10-10' })).toThrow()
    expect(() => make('Backwards', '2026-11-10', '2026-11-01')).toThrow()
    // Another project's dates are its own.
    expect(make('Elsewhere', '2026-10-01', '2026-10-14', 'p2').name).toBe('Elsewhere')
    expect(
      service.iterations.update(b.id, { name: 'Renamed', endDate: '2026-10-30' })
    ).toMatchObject({ name: 'Renamed', endDate: '2026-10-30' })
  })

  it('lets one iteration be active at a time', () => {
    const a = make('One', '2026-10-01', '2026-10-14')
    const b = make('Two', '2026-10-15', '2026-10-28')
    expect(service.iterations.start(a.id).status).toBe('active')
    expect(() => service.iterations.start(b.id)).toThrow(/One/)
    service.iterations.finish(a.id, 'none', human)
    expect(() => service.iterations.start(a.id)).toThrow()
    expect(service.iterations.start(b.id).status).toBe('active')
  })

  it('puts a task in at most one iteration, of its own project', () => {
    const a = make('One', '2026-10-01', '2026-10-14')
    const other = make('Theirs', '2026-10-01', '2026-10-14', 'p2')
    const item = task('Paint', a.id)
    expect(item.iterationId).toBe(a.id)
    expect(() => task('Wrong', other.id)).toThrow()
    expect(service.updateWorkItem(item.id, { iterationId: null }, human).iterationId).toBeNull()
  })

  it('finishes carrying unfinished work to the next iteration, keeping a summary', () => {
    const a = make('One', '2026-10-01', '2026-10-14')
    const b = make('Two', '2026-10-15', '2026-10-28')
    service.iterations.start(a.id)
    const done = task('Done', a.id, 3)
    service.updateWorkItem(done.id, { status: 'done' }, human)
    const open = task('Open', a.id, 5)
    const result = service.iterations.finish(a.id, 'next', human)
    expect(result.movedTaskIds).toEqual([open.id])
    expect(result.iteration.summary).toEqual({
      doneCount: 1,
      doneEstimate: 3,
      carriedCount: 1,
      carriedEstimate: 5,
      carryOver: 'next',
      carriedToIterationId: b.id
    })
    expect(service.iterations.get(a.id).status).toBe('finished')
    expect(service.iterations.get(a.id).summary?.doneCount).toBe(1)
    const items = new Map(service.listWorkItems('p1').map((item) => [item.id, item]))
    expect(items.get(done.id)?.iterationId).toBe(a.id)
    expect(items.get(open.id)?.iterationId).toBe(b.id)
    // The move is in the task's activity, not a second history.
    expect(service.iterations.joinedAt('p1', b.id).has(open.id)).toBe(true)
  })

  it('finishes carrying unfinished work to no iteration, and refuses next without one', () => {
    const a = make('One', '2026-10-01', '2026-10-14')
    service.iterations.start(a.id)
    const open = task('Open', a.id)
    expect(() => service.iterations.finish(a.id, 'next', human)).toThrow()
    const result = service.iterations.finish(a.id, 'none', human)
    expect(result.iteration.summary).toMatchObject({
      carryOver: 'none',
      carriedToIterationId: null
    })
    expect(service.listWorkItems('p1').find((item) => item.id === open.id)?.iterationId).toBeNull()
    expect(() => service.iterations.finish(a.id, 'none', human)).toThrow()
  })

  it('deletes an iteration, leaving its tasks, and Undo puts both back', () => {
    const a = make('One', '2026-10-01', '2026-10-14')
    const item = task('Paint', a.id)
    const before = service.listWorkItems('p1')[0].updatedAt
    const deletion = service.iterations.delete(a.id)
    expect(service.iterations.list('p1')).toEqual([])
    const after = service.listWorkItems('p1')[0]
    expect(after.iterationId).toBeNull()
    expect(after.updatedAt).toBe(before)
    const restored = service.iterations.restore(deletion)
    expect(restored.id).toBe(a.id)
    expect(service.listWorkItems('p1').find((i) => i.id === item.id)?.iterationId).toBe(a.id)
    expect(() => service.iterations.restore(deletion)).toThrow()
  })

  it('reads Current iteration on its end day through the filter context', () => {
    const a = make('One', '2026-10-01', '2026-10-14')
    const item = task('Paint', a.id)
    const filter = {
      match: 'all' as const,
      conditions: [{ field: 'iteration', op: 'is', value: ['current'] }]
    }
    const ctxOn = service.taskFilterContext('p1', '2026-10-14')
    const ctxAfter = service.taskFilterContext('p1', '2026-10-15')
    expect(ctxOn.currentIterationId).toBe(a.id)
    expect(ctxAfter.currentIterationId).toBeNull()
    const listed = service.listWorkItems('p1').find((i) => i.id === item.id)!
    expect(matchesFilter(listed, filter as never, ctxOn)).toBe(true)
    expect(matchesFilter(listed, filter as never, ctxAfter)).toBe(false)
  })
})

describe('iteration rules', () => {
  const it1 = {
    id: 'a',
    startDate: '2026-10-01',
    endDate: '2026-10-14',
    status: 'finished' as const
  }
  const it2 = {
    id: 'b',
    startDate: '2026-10-15',
    endDate: '2026-10-28',
    status: 'planned' as const
  }
  const it3 = {
    id: 'c',
    startDate: '2026-11-01',
    endDate: '2026-11-14',
    status: 'planned' as const
  }

  it('overlaps on a shared end day and not on neighbouring days', () => {
    expect(rangesOverlap(it1, { startDate: '2026-10-14', endDate: '2026-10-20' })).toBe(true)
    expect(rangesOverlap(it1, it2)).toBe(false)
  })

  it('finds the current and the next iteration', () => {
    expect(currentIteration([it1, it2, it3], '2026-10-28')?.id).toBe('b')
    expect(currentIteration([it1, it2, it3], '2026-10-30')).toBeNull()
    expect(currentIteration([it1, { ...it3, status: 'active' as const }], '2026-10-02')?.id).toBe(
      'c'
    )
    expect(nextIteration([it3, it2, it1], it1)?.id).toBe('b')
    expect(nextIteration([it1, it2], it2)).toBeNull()
  })

  it('matches "current" to no task when there is no current iteration', () => {
    const ctx: TaskFilterContext = {
      today: '2026-10-14',
      meId: null,
      currentIterationId: null
    }
    const filter = {
      match: 'all',
      conditions: [{ field: 'iteration', op: 'is', value: ['current'] }]
    }
    expect(matchesFilter({ id: 't', iterationId: null } as never, filter as never, ctx)).toBe(false)
  })
})

describe('iterationBurndown', () => {
  const at = (date: string) => new Date(`${date}T12:00:00`).getTime()
  const iteration = { id: 'i1', startDate: '2026-10-01', endDate: '2026-10-05' }
  const move = (
    workItemId: string,
    to: PlanningStatusTransition['to'],
    date: string
  ): PlanningStatusTransition => ({ workItemId, from: null, to, at: at(date) })

  it('burns down counts and estimates against an ideal line, stopping at today', () => {
    const series = iterationBurndown({
      iteration,
      tasks: [
        { id: 'a', estimate: 2, createdAt: at('2026-09-30'), iterationId: 'i1' },
        { id: 'b', estimate: 3, createdAt: at('2026-09-30'), iterationId: 'i1' },
        { id: 'x', estimate: 8, createdAt: at('2026-09-30'), iterationId: null }
      ],
      transitions: [move('a', 'done', '2026-10-02')],
      joinedAt: new Map(),
      today: '2026-10-03'
    })
    expect(series.startCount).toBe(2)
    expect(series.startEstimate).toBe(5)
    expect(series.allEstimated).toBe(true)
    expect(series.days.map((d) => d.remainingCount)).toEqual([2, 1, 1, null, null])
    expect(series.days.map((d) => d.remainingEstimate)).toEqual([5, 3, 3, null, null])
    expect(series.days.map((d) => d.idealCount)).toEqual([2, 1.5, 1, 0.5, 0])
    expect(series.days[4].idealEstimate).toBe(0)
  })

  it('raises the line for scope added part-way and for work reopened', () => {
    const series = iterationBurndown({
      iteration,
      tasks: [
        { id: 'a', estimate: null, createdAt: at('2026-09-30'), iterationId: 'i1' },
        { id: 'late', estimate: 1, createdAt: at('2026-09-01'), iterationId: 'i1' }
      ],
      transitions: [move('a', 'done', '2026-10-02'), move('a', 'ready', '2026-10-04')],
      joinedAt: new Map([['late', at('2026-10-03')]]),
      today: '2026-10-05'
    })
    expect(series.startCount).toBe(1)
    expect(series.allEstimated).toBe(false)
    expect(series.days.map((d) => d.remainingCount)).toEqual([1, 0, 1, 2, 2])
  })
})
