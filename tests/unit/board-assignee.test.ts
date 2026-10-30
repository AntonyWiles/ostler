import { describe, expect, it } from 'vitest'
import { matchesBoardFilter } from '../../src/shared/planning/board'
import { compareIsoDates, isIsoDate } from '../../src/shared/dates'
import { cardDateRangeTitle } from '../../src/renderer/views/planning/card-due'
import type { PlanningWorkItem } from '../../src/shared/ostler-api'

const item = (assigneeId: string | null) =>
  ({
    title: 'Task',
    description: '',
    labels: [],
    priority: 'medium',
    milestoneId: null,
    status: 'ready',
    assigneeId
  }) as unknown as PlanningWorkItem

const filter = (assigneeId?: string) => ({
  query: '',
  priority: 'all' as const,
  milestoneId: 'all',
  goalId: 'all',
  assigneeId,
  hideDone: false
})

const passes = (candidate: PlanningWorkItem, assigneeId?: string) =>
  matchesBoardFilter(
    candidate,
    filter(assigneeId),
    () => 'ready',
    () => null
  )

describe('the Board assignee filter', () => {
  it('keeps everything for anyone, one person, or unassigned work', () => {
    expect(passes(item('ada'))).toBe(true)
    expect(passes(item('ada'), 'all')).toBe(true)
    expect(passes(item('ada'), 'ada')).toBe(true)
    expect(passes(item('bea'), 'ada')).toBe(false)
    expect(passes(item(null), 'none')).toBe(true)
    expect(passes(item('ada'), 'none')).toBe(false)
  })
})

describe('calendar dates', () => {
  it('compares days as text, so no time zone can move them', () => {
    expect(compareIsoDates('2026-10-20', '2026-10-21')).toBeLessThan(0)
    expect(compareIsoDates('2026-10-21', '2026-10-20')).toBeGreaterThan(0)
    expect(compareIsoDates('2026-10-20', '2026-10-20')).toBe(0)
    expect(isIsoDate('2026-02-29')).toBe(false)
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('20-10-2026')).toBe(false)
  })

  it("titles a card's start–due range, or nothing without a start", () => {
    const today = new Date(2026, 9, 8)
    expect(cardDateRangeTitle(null, '2026-10-20', false, today)).toBeNull()
    expect(cardDateRangeTitle('2026-10-12', null, false, today)).toMatch(/^Starts .*12.*2026$/)
    expect(cardDateRangeTitle('2026-10-12', '2026-10-20', false, today)).toMatch(
      /^Starts .*2026 · Due .*20.*2026$/
    )
  })
})
