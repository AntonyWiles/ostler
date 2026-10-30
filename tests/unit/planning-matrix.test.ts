import { describe, expect, it } from 'vitest'
import {
  compareMatrixTasks,
  isImportant,
  isUrgent,
  matrixBoxOf,
  matrixCandidates,
  priorityForRow,
  sortIntoMatrix
} from '../../src/shared/planning/matrix'
import type { PlanningPriority } from '../../src/shared/ostler-api'

const today = '2026-10-16'

function task(
  title: string,
  priority: PlanningPriority,
  targetDate: string | null = null,
  extra: Partial<{ status: 'backlog' | 'done'; someday: boolean; showFrom: string | null }> = {}
) {
  return {
    id: title,
    title,
    priority,
    targetDate,
    status: extra.status ?? ('backlog' as const),
    someday: extra.someday ?? false,
    showFrom: extra.showFrom ?? null
  }
}

describe('priority matrix rule (N7.5)', () => {
  it('counts high and critical as important, low and medium as not', () => {
    expect(isImportant('critical')).toBe(true)
    expect(isImportant('high')).toBe(true)
    expect(isImportant('medium')).toBe(false)
    expect(isImportant('low')).toBe(false)
  })

  it('counts overdue, today and up to three days ahead as urgent, and never an undated task', () => {
    expect(isUrgent({ targetDate: '2026-10-01' }, today)).toBe(true)
    expect(isUrgent({ targetDate: today }, today)).toBe(true)
    expect(isUrgent({ targetDate: '2026-10-19' }, today)).toBe(true)
    expect(isUrgent({ targetDate: '2026-10-20' }, today)).toBe(false)
    expect(isUrgent({ targetDate: null }, today)).toBe(false)
  })

  it('crosses a month end by local calendar dates', () => {
    expect(isUrgent({ targetDate: '2026-11-02' }, '2026-10-30')).toBe(true)
    expect(isUrgent({ targetDate: '2026-11-03' }, '2026-10-30')).toBe(false)
  })

  it('puts each priority and due date in its box', () => {
    expect(matrixBoxOf(task('a', 'critical', today), today)).toBe('urgentImportant')
    expect(matrixBoxOf(task('a', 'high', '2026-10-20'), today)).toBe('important')
    expect(matrixBoxOf(task('a', 'high'), today)).toBe('important')
    expect(matrixBoxOf(task('a', 'medium', '2026-10-10'), today)).toBe('urgent')
    expect(matrixBoxOf(task('a', 'low', '2026-10-19'), today)).toBe('urgent')
    expect(matrixBoxOf(task('a', 'low'), today)).toBe('neither')
    expect(matrixBoxOf(task('a', 'medium', '2026-10-20'), today)).toBe('neither')
  })

  it('orders a box by due date, then priority, then title, undated last', () => {
    const boxes = sortIntoMatrix(
      [
        task('Zed', 'high'),
        task('Beta', 'high', '2026-10-25'),
        task('Alpha', 'high', '2026-10-25'),
        task('Gamma', 'critical', '2026-10-25'),
        task('Early', 'high', '2026-10-22'),
        task('Able', 'critical')
      ],
      today
    )
    expect(boxes.important.map((item) => item.title)).toEqual([
      'Early',
      'Gamma',
      'Alpha',
      'Beta',
      'Able',
      'Zed'
    ])
    expect(boxes.urgentImportant).toEqual([])
    expect(compareMatrixTasks(task('a', 'low'), task('a', 'low'))).toBe(0)
  })

  it('shows the Board tasks that are open: not done, not in Someday, not shown later', () => {
    const shown = matrixCandidates(
      [
        task('open', 'low'),
        task('done', 'low', null, { status: 'done' }),
        task('someday', 'low', null, { someday: true }),
        task('later', 'low', null, { showFrom: '2026-10-17' }),
        task('from today', 'low', null, { showFrom: today })
      ],
      today
    )
    expect(shown.map((item) => item.title)).toEqual(['open', 'from today'])
  })

  it('sets high going up and medium going down, unless already on that side', () => {
    expect(priorityForRow('low', true)).toBe('high')
    expect(priorityForRow('medium', true)).toBe('high')
    expect(priorityForRow('high', true)).toBeNull()
    expect(priorityForRow('critical', true)).toBeNull()
    expect(priorityForRow('critical', false)).toBe('medium')
    expect(priorityForRow('high', false)).toBe('medium')
    expect(priorityForRow('medium', false)).toBeNull()
    expect(priorityForRow('low', false)).toBeNull()
  })
})
