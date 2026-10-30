import { describe, expect, it } from 'vitest'
import {
  expectedValue,
  goalProgress,
  measureAgainstTarget,
  measureSummary,
  parseGoalCheckInInput,
  parseGoalMeasure,
  parseMeasureNumber,
  type GoalMeasure
} from '../../src/shared/goal-measures'

const MEMBERS: GoalMeasure = {
  unit: 'members',
  startValue: 0,
  targetValue: 200,
  startDate: '2026-01-01',
  targetDate: '2026-01-21',
  direction: 'up'
}

const BACKLOG: GoalMeasure = {
  unit: 'tasks',
  startValue: 120,
  targetValue: 20,
  startDate: '2026-01-01',
  targetDate: '2026-01-11',
  direction: 'down'
}

describe('a goal measure (N5.6a)', () => {
  it('reads a measure and works out its direction from the target', () => {
    expect(parseGoalMeasure({ ...BACKLOG, direction: undefined })).toEqual(BACKLOG)
    expect(parseGoalMeasure({ ...MEMBERS, unit: '  £ ' }).unit).toBe('£')
  })

  it('refuses dates out of order, a target on the wrong side, and a long unit', () => {
    expect(() => parseGoalMeasure({ ...MEMBERS, targetDate: '2026-01-01' })).toThrow(/after/)
    expect(() => parseGoalMeasure({ ...MEMBERS, direction: 'down' })).toThrow(/below/)
    expect(() => parseGoalMeasure({ ...MEMBERS, targetValue: 0 })).toThrow(/differ/)
    expect(() => parseGoalMeasure({ ...MEMBERS, unit: 'x'.repeat(21) })).toThrow(/20/)
    expect(() => parseGoalMeasure({ ...MEMBERS, startValue: '3' })).toThrow(/number/)
  })

  it('reads a check-in, trimming its note', () => {
    expect(parseGoalCheckInInput({ date: '2026-01-05', value: 3.5, note: ' hi ' })).toEqual({
      date: '2026-01-05',
      value: 3.5,
      note: 'hi'
    })
    expect(() => parseGoalCheckInInput({ date: '5 Jan', value: 1 })).toThrow(/date/)
    expect(() => parseGoalCheckInInput({ date: '2026-01-05', value: NaN })).toThrow(/number/)
  })
})

describe('goal progress (N5.6a)', () => {
  it('shows the start value with no check-ins', () => {
    const progress = goalProgress(MEMBERS, [], '2026-01-01')
    expect(progress.latest).toBe(0)
    expect(progress.latestDate).toBeNull()
    expect(progress.share).toBe(0)
    expect(progress.pace).toBe('on-pace')
  })

  it('is behind or ahead of the straight line for a higher-is-better goal', () => {
    // Day 15 of 20: the line says 150.
    expect(expectedValue(MEMBERS, '2026-01-16')).toBe(150)
    const behind = goalProgress(MEMBERS, [{ date: '2026-01-16', value: 142 }], '2026-01-16')
    expect(behind.pace).toBe('on-pace') // 8 behind is within 5% of 200
    const further = goalProgress(MEMBERS, [{ date: '2026-01-16', value: 120 }], '2026-01-16')
    expect(further.pace).toBe('behind')
    expect(further.gap).toBe(-30)
    const ahead = goalProgress(MEMBERS, [{ date: '2026-01-16', value: 180 }], '2026-01-16')
    expect(ahead.pace).toBe('ahead')
    expect(ahead.share).toBeCloseTo(0.9)
  })

  it('counts the 5% band on either side as on pace', () => {
    // The line says 100 on day 10; 5% of 200 is 10.
    const at = (value: number) =>
      goalProgress(MEMBERS, [{ date: '2026-01-11', value }], '2026-01-11').pace
    expect(at(90)).toBe('on-pace')
    expect(at(110)).toBe('on-pace')
    expect(at(89)).toBe('behind')
    expect(at(111)).toBe('ahead')
  })

  it('reads a lower-is-better goal the other way round', () => {
    // Day 5 of 10: the line says 70.
    const behind = goalProgress(BACKLOG, [{ date: '2026-01-06', value: 90 }], '2026-01-06')
    expect(behind.pace).toBe('behind')
    expect(behind.gap).toBe(-20)
    const ahead = goalProgress(BACKLOG, [{ date: '2026-01-06', value: 50 }], '2026-01-06')
    expect(ahead.pace).toBe('ahead')
    expect(ahead.share).toBeCloseTo(0.7)
    expect(goalProgress(BACKLOG, [{ date: '2026-01-06', value: 18 }], '2026-01-06').pace).toBe(
      'reached'
    )
  })

  it('holds the line at the start before the start date, and at the target after it', () => {
    expect(expectedValue(MEMBERS, '2025-12-01')).toBe(0)
    expect(goalProgress(MEMBERS, [], '2025-12-01').pace).toBe('on-pace')
    expect(expectedValue(MEMBERS, '2026-03-01')).toBe(200)
    const late = goalProgress(MEMBERS, [{ date: '2026-01-20', value: 150 }], '2026-03-01')
    expect(late.pace).toBe('behind')
    expect(late.gap).toBe(-50)
  })

  it('uses the latest check-in by date, whatever order they come in', () => {
    const progress = goalProgress(
      MEMBERS,
      [
        { date: '2026-01-10', value: 90 },
        { date: '2026-01-03', value: 20 }
      ],
      '2026-01-10'
    )
    expect(progress.latest).toBe(90)
    expect(progress.latestDate).toBe('2026-01-10')
  })

  it('says it in words', () => {
    const progress = goalProgress(MEMBERS, [{ date: '2026-01-16', value: 120 }], '2026-01-16')
    expect(measureSummary(progress, MEMBERS)).toBe('120 of 200 members, 30 behind the line')
    expect(measureAgainstTarget(1200, { ...MEMBERS, unit: '£', targetValue: 3000 })).toBe(
      '£1,200 of £3,000'
    )
  })
})

describe('typing a number in the person region (N5.6a)', () => {
  it('reads the region decimal separator and ignores group separators', () => {
    expect(parseMeasureNumber('1,234.5', '.')).toBe(1234.5)
    expect(parseMeasureNumber('1.234,5', ',')).toBe(1234.5)
    expect(parseMeasureNumber('-3', '.')).toBe(-3)
    expect(parseMeasureNumber('', '.')).toBeNull()
    expect(parseMeasureNumber('twelve', '.')).toBeNull()
  })
})
