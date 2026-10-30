import { afterEach, describe, expect, it } from 'vitest'
import {
  calendarWeeks,
  layoutWeek,
  localeWeekStart,
  shiftPeriod,
  type Weekday
} from '@renderer/ui/calendar-layout'
import { dropTaskOnDate, shiftTaskDates, taskCalendarRange } from '@shared/planning/calendar'
import { isoDaysBetween, shiftIsoDate } from '@shared/dates'

const ORIGINAL_TZ = process.env.TZ

describe('calendar grid generation', () => {
  it('starts weeks on Monday or Sunday', () => {
    // October 2026 begins on a Thursday.
    const monday = calendarWeeks('2026-10-15', 'month', 1)
    expect(monday[0][0]).toBe('2026-09-28')
    expect(monday.at(-1)!.at(-1)).toBe('2026-11-01')
    expect(monday).toHaveLength(5)
    const sunday = calendarWeeks('2026-10-15', 'month', 0)
    expect(sunday[0][0]).toBe('2026-09-27')
    expect(sunday.at(-1)!.at(-1)).toBe('2026-10-31')
    expect(sunday).toHaveLength(5)
  })

  it('covers a month starting on each weekday, whole weeks only', () => {
    // 2026: Feb 1 Sun, Jun 1 Mon, Sep 1 Tue, Apr 1 Wed, Jan 1 Thu, May 1 Fri, Aug 1 Sat.
    const firsts = [
      '2026-02-01',
      '2026-06-01',
      '2026-09-01',
      '2026-04-01',
      '2026-01-01',
      '2026-05-01',
      '2026-08-01'
    ]
    const seen = new Set<number>()
    for (const first of firsts) {
      for (const weekStart of [0, 1] as Weekday[]) {
        const weeks = calendarWeeks(first, 'month', weekStart)
        const days = weeks.flat()
        expect(weeks.every((week) => week.length === 7)).toBe(true)
        // Consecutive days, starting on the week's first day.
        days.forEach(
          (day, index) => index > 0 && expect(isoDaysBetween(days[index - 1], day)).toBe(1)
        )
        expect(new Date(`${days[0]}T12:00:00Z`).getUTCDay()).toBe(weekStart)
        // The whole month, and no week entirely outside it.
        const month = first.slice(0, 7)
        expect(days).toContain(first)
        expect(weeks.every((week) => week.some((day) => day.startsWith(month)))).toBe(true)
        expect(days.filter((day) => day.startsWith(month)).length).toBeGreaterThanOrEqual(28)
      }
      seen.add(new Date(`${first}T12:00:00Z`).getUTCDay())
    }
    expect(seen.size).toBe(7)
  })

  it('handles leap-year February', () => {
    const leap = calendarWeeks('2028-02-10', 'month', 1).flat()
    expect(leap.filter((day) => day.startsWith('2028-02'))).toHaveLength(29)
    expect(leap).toContain('2028-02-29')
    const plain = calendarWeeks('2027-02-10', 'month', 1).flat()
    expect(plain.filter((day) => day.startsWith('2027-02'))).toHaveLength(28)
    // 31 January, one month on, is the last day of February.
    expect(shiftPeriod('2028-01-31', 'month', 1)).toBe('2028-02-29')
    expect(shiftPeriod('2027-01-31', 'month', 1)).toBe('2027-02-28')
    expect(shiftPeriod('2026-12-15', 'month', 1)).toBe('2027-01-15')
    expect(shiftPeriod('2026-01-15', 'month', -1)).toBe('2025-12-15')
    expect(shiftPeriod('2026-10-15', 'week', 1)).toBe('2026-10-22')
  })

  it('shows one week in week mode', () => {
    expect(calendarWeeks('2026-10-08', 'week', 1)).toEqual([
      [
        '2026-10-05',
        '2026-10-06',
        '2026-10-07',
        '2026-10-08',
        '2026-10-09',
        '2026-10-10',
        '2026-10-11'
      ]
    ])
  })

  it('reads the first day of the week from the locale, else Monday', () => {
    expect(localeWeekStart('en-GB')).toBe(1)
    const us = localeWeekStart('en-US')
    // Runtimes without week info fall back to Monday.
    expect([0, 1]).toContain(us)
  })
})

describe('calendar spans', () => {
  const weeks = calendarWeeks('2026-10-15', 'month', 1)

  it('wraps a span across weeks, one piece per week, in one lane', () => {
    const items = [{ id: 'trip', start: '2026-10-08', end: '2026-10-14' }]
    const first = layoutWeek(items, weeks[1], 3)
    const second = layoutWeek(items, weeks[2], 3)
    expect(first.segments).toMatchObject([
      {
        start: '2026-10-08',
        column: 3,
        span: 4,
        lane: 0,
        continuesBefore: false,
        continuesAfter: true
      }
    ])
    expect(second.segments).toMatchObject([
      {
        start: '2026-10-12',
        column: 0,
        span: 3,
        lane: 0,
        continuesBefore: true,
        continuesAfter: false
      }
    ])
  })

  it('keeps a bar in one lane and stacks others beside it', () => {
    const items = [
      { id: 'a', start: '2026-10-13', end: '2026-10-13' },
      { id: 'long', start: '2026-10-12', end: '2026-10-15' },
      { id: 'b', start: '2026-10-15', end: '2026-10-16' }
    ]
    const { segments } = layoutWeek(items, weeks[2], 3)
    const lane = Object.fromEntries(segments.map((segment) => [segment.item.id, segment.lane]))
    expect(lane).toEqual({ long: 0, a: 1, b: 1 })
  })

  it('counts "+N more" per day, keeping the last row for it', () => {
    const day = '2026-10-14'
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, start: day, end: day }))
    const crowded = layoutWeek(items, weeks[2], 3)
    expect(crowded.segments.map((segment) => segment.item.id)).toEqual(['a', 'b'])
    expect(crowded.hidden.get(day)!.map((item) => item.id)).toEqual(['c', 'd', 'e'])
    // Exactly as many as fit: no "+N more".
    const full = layoutWeek(items.slice(0, 3), weeks[2], 3)
    expect(full.segments).toHaveLength(3)
    expect(full.hidden.get(day)).toEqual([])
  })

  it('cuts a bar on the days it has no room', () => {
    const bars = ['x', 'y', 'z'].map((id) => ({ id, start: '2026-10-13', end: '2026-10-15' }))
    const extra = { id: 'extra', start: '2026-10-14', end: '2026-10-14' }
    const { segments, hidden } = layoutWeek([...bars, extra], weeks[2], 3)
    // The 14th has four items: two rows, then "+2 more" (z and extra).
    expect(segments.filter((segment) => segment.item.id === 'z')).toMatchObject([
      { start: '2026-10-13', span: 1, lane: 2, continuesAfter: true },
      { start: '2026-10-15', span: 1, lane: 2, continuesBefore: true }
    ])
    expect(hidden.get('2026-10-14')!.map((item) => item.id)).toEqual(['z', 'extra'])
    expect(hidden.get('2026-10-13')).toEqual([])
  })
})

describe.each([
  ['UTC+13', 'Pacific/Tongatapu'],
  ['UTC-5', 'America/Bogota']
])('task moves in %s', (_name, zone) => {
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ
  })

  it('moves the due and start dates by the same days, as strings', () => {
    process.env.TZ = zone
    const item = { startDate: '2026-10-30', targetDate: '2026-11-01' }
    expect(shiftTaskDates(item, 1)).toEqual({ targetDate: '2026-11-02', startDate: '2026-10-31' })
    expect(shiftTaskDates(item, -7)).toEqual({ targetDate: '2026-10-25', startDate: '2026-10-23' })
    expect(shiftTaskDates({ startDate: null, targetDate: '2028-02-28' }, 1)).toEqual({
      targetDate: '2028-02-29'
    })
    expect(shiftTaskDates({ startDate: null, targetDate: '2026-12-31' }, 1)).toEqual({
      targetDate: '2027-01-01'
    })
    expect(shiftTaskDates({ startDate: null, targetDate: null }, 1)).toBeNull()
  })

  it('drops a task on a day by the days from where it was held', () => {
    process.env.TZ = zone
    const item = { startDate: '2026-10-05', targetDate: '2026-10-07' }
    // Held by its last day, dropped on the next day.
    expect(dropTaskOnDate(item, '2026-10-08')).toEqual({
      targetDate: '2026-10-08',
      startDate: '2026-10-06'
    })
    // Held by its first day, dropped two days on.
    expect(dropTaskOnDate(item, '2026-10-07', '2026-10-05')).toEqual({
      targetDate: '2026-10-09',
      startDate: '2026-10-07'
    })
    expect(dropTaskOnDate(item, '2026-10-07')).toBeNull()
  })

  it('gives an unscheduled task the day it is dropped on', () => {
    process.env.TZ = zone
    expect(dropTaskOnDate({ startDate: null, targetDate: null }, '2026-10-20')).toEqual({
      targetDate: '2026-10-20'
    })
    // A start date after the new due date would be refused, so it is cleared.
    expect(dropTaskOnDate({ startDate: '2026-11-01', targetDate: null }, '2026-10-20')).toEqual({
      targetDate: '2026-10-20',
      startDate: null
    })
    expect(dropTaskOnDate({ startDate: '2026-10-01', targetDate: null }, '2026-10-20')).toEqual({
      targetDate: '2026-10-20'
    })
  })

  it('reads the range a task covers', () => {
    process.env.TZ = zone
    expect(taskCalendarRange({ startDate: '2026-10-05', targetDate: '2026-10-07' })).toEqual({
      start: '2026-10-05',
      end: '2026-10-07'
    })
    expect(taskCalendarRange({ startDate: null, targetDate: '2026-10-07' })).toEqual({
      start: '2026-10-07',
      end: '2026-10-07'
    })
    expect(taskCalendarRange({ startDate: '2026-10-05', targetDate: null })).toBeNull()
    expect(shiftIsoDate('2026-03-29', 1)).toBe('2026-03-30')
  })
})
