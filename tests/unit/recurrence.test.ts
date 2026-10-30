import { describe, expect, it } from 'vitest'
import {
  advanceRecurrence,
  firstRuleDateFrom,
  nextOccurrenceDate,
  nextInRotation,
  normalizeRecurrence,
  rotationIndexAfterEdit,
  type RecurrenceSettings
} from '../../src/shared/recurrence'

describe('take turns: who is next (N2.3)', () => {
  const none = () => false
  const archived =
    (...ids: string[]) =>
    (id: string) =>
      ids.includes(id)

  it('picks the person at the index and moves the turn on, wrapping round', () => {
    expect(nextInRotation(['sam', 'alex', 'jo'], 1, none)).toEqual({
      personId: 'alex',
      index: 1,
      nextIndex: 2,
      passedOver: []
    })
    expect(nextInRotation(['sam', 'alex', 'jo'], 2, none)?.nextIndex).toBe(0)
  })

  it('passes over archived people', () => {
    expect(nextInRotation(['sam', 'alex', 'jo'], 1, archived('alex', 'jo'))).toEqual({
      personId: 'sam',
      index: 0,
      nextIndex: 1,
      passedOver: ['alex', 'jo']
    })
  })

  it('with one person, it is always their turn', () => {
    expect(nextInRotation(['sam'], 0, none)).toMatchObject({ personId: 'sam', nextIndex: 0 })
  })

  it('is no one when everyone is archived, or there is no rotation', () => {
    expect(nextInRotation(['sam', 'alex'], 0, archived('sam', 'alex'))).toBeNull()
    expect(nextInRotation(null, 0, none)).toBeNull()
    expect(nextInRotation([], 0, none)).toBeNull()
  })

  it('keeps the next person next when people are added or reordered', () => {
    expect(rotationIndexAfterEdit(['sam', 'alex'], 1, ['jo', 'sam', 'alex'])).toBe(2)
    expect(rotationIndexAfterEdit(['sam', 'alex', 'jo'], 0, ['jo', 'alex', 'sam'])).toBe(2)
  })

  it('gives the turn to the person after one who is removed', () => {
    expect(rotationIndexAfterEdit(['sam', 'alex', 'jo'], 1, ['sam', 'jo'])).toBe(1)
    expect(rotationIndexAfterEdit(['sam', 'alex', 'jo'], 2, ['sam', 'alex'])).toBe(0)
    expect(rotationIndexAfterEdit(['sam'], 0, null)).toBe(0)
    expect(rotationIndexAfterEdit(null, 0, ['sam', 'alex'])).toBe(0)
  })

  it('checks a rotation as sent', () => {
    const rule = { every: 'week', interval: 1 }
    expect(normalizeRecurrence({ rule, rotation: ['a', 'b'], nextIndex: 1 })).toMatchObject({
      rotation: ['a', 'b'],
      nextIndex: 1
    })
    expect(normalizeRecurrence({ rule, rotation: [] })).toMatchObject({
      rotation: null,
      nextIndex: 0
    })
    expect(() => normalizeRecurrence({ rule, rotation: ['a', 'a'] })).toThrow()
    expect(() => normalizeRecurrence({ rule, rotation: ['a'], nextIndex: 1 })).toThrow()
    expect(() => normalizeRecurrence({ rule, rotation: 'a' })).toThrow()
  })

  it('moves the rotation and its turn with the repeat', () => {
    const settings = repeat({ every: 'day', interval: 1 }, { rotation: ['a', 'b'], nextIndex: 1 })
    expect(advanceRecurrence(settings)).toMatchObject({ rotation: ['a', 'b'], nextIndex: 1 })
  })
})

const repeat = (rule: RecurrenceSettings['rule'], extra: Partial<RecurrenceSettings> = {}) => ({
  rule,
  endsOn: null,
  remaining: null,
  rotation: null,
  nextIndex: 0,
  ...extra
})

describe('recurrence dates', () => {
  it('repeats daily and every N days', () => {
    expect(
      nextOccurrenceDate(repeat({ every: 'day', interval: 1 }), '2026-10-07', '2026-10-07')
    ).toBe('2026-10-08')
    expect(
      nextOccurrenceDate(repeat({ every: 'day', interval: 3 }), '2026-10-07', '2026-10-07')
    ).toBe('2026-10-10')
  })

  it('lands on the 30th for day 31 in a 30-day month, and back on the 31st after', () => {
    const rule = { every: 'month' as const, interval: 1, monthDay: 31 }
    expect(firstRuleDateFrom(rule, '2026-08-31', '2026-08-31')).toBe('2026-09-30')
    expect(firstRuleDateFrom(rule, '2026-09-30', '2026-09-30')).toBe('2026-10-31')
    expect(firstRuleDateFrom(rule, '2027-01-31', '2027-01-31')).toBe('2027-02-28')
  })

  it('keeps 29 February for leap years and uses the 28th between them', () => {
    const rule = { every: 'year' as const, interval: 1, monthDay: 29 }
    expect(firstRuleDateFrom(rule, '2028-02-29', '2028-02-29')).toBe('2029-02-28')
    expect(firstRuleDateFrom(rule, '2031-02-28', '2031-02-28')).toBe('2032-02-29')
  })

  it('repeats on weekdays only', () => {
    const rule = { every: 'week' as const, interval: 1, weekdays: [1, 2, 3, 4, 5] }
    // Friday 9 Oct 2026 → Monday 12 Oct.
    expect(firstRuleDateFrom(rule, '2026-10-09', '2026-10-09')).toBe('2026-10-12')
    expect(firstRuleDateFrom(rule, '2026-10-12', '2026-10-12')).toBe('2026-10-13')
  })

  it('repeats every 2 weeks on Monday and Thursday', () => {
    const rule = { every: 'week' as const, interval: 2, weekdays: [1, 4] }
    // Anchored on Monday 5 Oct: Thu 8 Oct, then Mon 19 and Thu 22 Oct.
    expect(firstRuleDateFrom(rule, '2026-10-05', '2026-10-05')).toBe('2026-10-08')
    expect(firstRuleDateFrom(rule, '2026-10-05', '2026-10-09')).toBe('2026-10-19')
    expect(firstRuleDateFrom(rule, '2026-10-05', '2026-10-20')).toBe('2026-10-22')
  })

  it('repeats weekly on the due date’s weekday when no days are chosen', () => {
    expect(firstRuleDateFrom({ every: 'week', interval: 1 }, '2026-10-07', '2026-10-07')).toBe(
      '2026-10-14'
    )
  })

  it('catches up past occurrences to today or later', () => {
    const weekly = repeat({ every: 'week', interval: 1 })
    // Due Wed 7 Oct, finished Tue 27 Oct: the next Wednesday on or after it.
    expect(nextOccurrenceDate(weekly, '2026-10-07', '2026-10-27')).toBe('2026-10-28')
    // Finished on a rule day: that day itself.
    expect(nextOccurrenceDate(weekly, '2026-10-07', '2026-10-28')).toBe('2026-10-28')
    const monthly = repeat({ every: 'month', interval: 2, monthDay: 15 })
    expect(nextOccurrenceDate(monthly, '2026-01-15', '2026-06-01')).toBe('2026-07-15')
  })

  it('counts from today when the task has no due date', () => {
    expect(nextOccurrenceDate(repeat({ every: 'day', interval: 1 }), null, '2026-10-07')).toBe(
      '2026-10-08'
    )
  })

  it('stops after N times', () => {
    let settings: RecurrenceSettings = repeat({ every: 'day', interval: 1 }, { remaining: 2 })
    const dates: string[] = []
    let due = '2026-10-07'
    for (;;) {
      const next = nextOccurrenceDate(settings, due, due)
      if (!next) break
      dates.push(next)
      due = next
      settings = advanceRecurrence(settings)
    }
    expect(dates).toEqual(['2026-10-08', '2026-10-09'])
  })

  it('stops after the end date', () => {
    const settings = repeat({ every: 'week', interval: 1 }, { endsOn: '2026-10-20' })
    expect(nextOccurrenceDate(settings, '2026-10-07', '2026-10-07')).toBe('2026-10-14')
    expect(nextOccurrenceDate(settings, '2026-10-14', '2026-10-14')).toBeNull()
  })

  it('checks what a caller sends', () => {
    expect(normalizeRecurrence({ rule: { every: 'week', weekdays: [4, 1, 1] } })).toEqual({
      rule: { every: 'week', interval: 1, weekdays: [1, 4] },
      endsOn: null,
      remaining: null,
      rotation: null,
      nextIndex: 0
    })
    expect(() => normalizeRecurrence({ rule: { every: 'fortnight' } })).toThrow('every: day')
    expect(() => normalizeRecurrence({ rule: { every: 'day', interval: 0 } })).toThrow('interval')
    expect(() => normalizeRecurrence({ rule: { every: 'day', weekdays: [1] } })).toThrow(
      'Only a weekly'
    )
    expect(() =>
      normalizeRecurrence({ rule: { every: 'day' }, endsOn: '2026-12-01', remaining: 3 })
    ).toThrow('not both')
  })
})
