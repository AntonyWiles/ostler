import { describe, expect, it } from 'vitest'
import { buildProjectReport, type ReportInput } from '../../electron/services/report-builder'
import type { PlanningStatusTransition, PlanningWorkItem } from '@shared/ostler-api'

// "Today" is Thursday 8 October 2026, noon, local time.
const at = (month: number, day: number, hour = 12) => new Date(2026, month - 1, day, hour).getTime()
const NOW = at(10, 8)

function task(id: string, typeId: string | null, overrides: Partial<PlanningWorkItem> = {}) {
  return {
    id,
    projectId: 'p',
    milestoneId: null,
    title: id,
    description: '',
    status: 'done',
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
    typeId,
    ...overrides
  } as PlanningWorkItem
}

/** Started on `start`, done on `done` (days of October, or September when negative). */
function finished(id: string, start: number, done: number): PlanningStatusTransition[] {
  const day = (value: number) => (value > 0 ? at(10, value) : at(9, 30 + value))
  return [
    { workItemId: id, from: null, to: 'ready', at: at(9, 1) },
    { workItemId: id, from: 'ready', to: 'active', at: day(start) },
    { workItemId: id, from: 'active', to: 'done', at: day(done) }
  ]
}

const type = (id: string, name: string) => ({ id, name, icon: 'bug', color: '#ef4444' })

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

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

describe('reports split by task type (N2.7b)', () => {
  it('has no split for a project without types', () => {
    const result = report({ items: [task('a', null)], history: finished('a', 1, 2) })
    expect(result.throughput.byType).toBeUndefined()
    expect(result.cycleTime.byType).toBeUndefined()
  })

  it('splits throughput and cycle time so the parts sum to the whole, counting No type', () => {
    const items = [
      task('b1', 'bug'),
      task('b2', 'bug'),
      task('f1', 'feature'),
      task('n1', null),
      task('gone', 'deleted-type'),
      task('open', 'bug', { status: 'active' })
    ]
    const history = [
      ...finished('b1', 1, 2),
      ...finished('b2', -10, 5),
      ...finished('f1', -3, 6),
      ...finished('n1', 2, 7),
      ...finished('gone', 3, 3),
      { workItemId: 'open', from: null, to: 'active' as const, at: at(10, 1) }
    ]
    const result = report({
      items,
      history,
      taskTypes: [type('bug', 'Bug'), type('feature', 'Feature'), type('chore', 'Chore')]
    })
    const throughput = result.throughput.byType!
    expect(throughput.map((part) => part.series.name)).toEqual(['Bug', 'Feature', 'No type'])
    expect(throughput.map((part) => part.total)).toEqual([2, 1, 2])
    expect(throughput[2].series).toMatchObject({ key: 'none', icon: null, color: null })
    expect(throughput[0].series).toMatchObject({ key: 'bug', icon: 'bug', color: '#ef4444' })
    // Week by week, the series add up to the unsplit chart.
    result.throughput.weeks.forEach((week, index) => {
      expect(throughput.every((part) => part.weeks[index].weekStart === week.weekStart)).toBe(true)
      expect(sum(throughput.map((part) => part.weeks[index].count))).toBe(week.count)
    })
    const cycle = result.cycleTime.byType!
    result.cycleTime.buckets.forEach((bucket, index) =>
      expect(sum(cycle.map((part) => part.buckets[index].count))).toBe(bucket.count)
    )
    expect(sum(cycle.map((part) => part.sampleSize))).toBe(result.cycleTime.sampleSize)
    expect(throughput[0].summary).toMatch(/^Bug: 2 tasks finished in the last 30 days/)
    expect(cycle[1].summary).toMatch(/^Feature: One task was finished/)
  })

  it('groups the smallest into Other after six series', () => {
    const types = Array.from({ length: 8 }, (_, index) => type(`t${index}`, `Type ${index}`))
    const items: PlanningWorkItem[] = []
    const history: PlanningStatusTransition[] = []
    // Type i finishes i + 1 tasks, so t0 and t1 are the smallest.
    types.forEach((entry, index) => {
      for (let n = 0; n <= index; n++) {
        const id = `${entry.id}-${n}`
        items.push(task(id, entry.id))
        history.push(...finished(id, 1, 2))
      }
    })
    const result = report({ items, history, taskTypes: types })
    const split = result.throughput.byType!
    expect(split.map((part) => part.series.key)).toEqual([
      't2',
      't3',
      't4',
      't5',
      't6',
      't7',
      'other'
    ])
    expect(split[6].series).toMatchObject({ name: 'Other', typeIds: ['t0', 't1'] })
    expect(split[6].total).toBe(3)
    expect(sum(split.map((part) => part.total))).toBe(result.keyNumbers.doneInRange)
    expect(result.cycleTime.byType!.map((part) => part.series.key)).toEqual(
      split.map((part) => part.series.key)
    )
  })
})
