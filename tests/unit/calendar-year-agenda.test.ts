import { describe, expect, it } from 'vitest'
import {
  agendaDays,
  shiftPeriod,
  workLevel,
  yearMonths,
  yearWork
} from '@renderer/ui/calendar-layout'
import { normalizeCalendarSettings } from '@renderer/views/planning/calendar/calendar-settings'

type Item = { id: string; start: string; end: string; milestone?: boolean }

describe('Year layout', () => {
  it('draws twelve months in the week start, with blanks outside each month', () => {
    const monday = yearMonths('2026-06-10', 1)
    expect(monday).toHaveLength(12)
    expect(monday.map((month) => month.first)).toEqual(
      Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`)
    )
    // 1 January 2026 is a Thursday: three blanks Monday-first, four Sunday-first.
    expect(monday[0].weeks[0]).toEqual([
      null,
      null,
      null,
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04'
    ])
    const sunday = yearMonths('2026-06-10', 0)
    expect(sunday[0].weeks[0].slice(0, 5)).toEqual([null, null, null, null, '2026-01-01'])
    for (const month of monday) for (const week of month.weeks) expect(week).toHaveLength(7)
  })

  it('has 29 February in a leap year only', () => {
    const days = (anchor: string) => yearMonths(anchor, 1)[1].weeks.flat().filter(Boolean)
    expect(days('2028-01-01')).toHaveLength(29)
    expect(days('2026-01-01')).toHaveLength(28)
  })

  it('counts tasks over days and milestones on them, inside the year only', () => {
    const items: Item[] = [
      { id: 'a', start: '2025-12-30', end: '2026-01-02' },
      { id: 'b', start: '2026-01-02', end: '2026-01-02' },
      { id: 'm', start: '2026-01-02', end: '2026-01-02', milestone: true },
      { id: 'z', start: '2027-01-01', end: '2027-01-03' }
    ]
    const work = yearWork(items, '2026-05-05', (item) => item.milestone === true)
    expect(work.get('2026-01-01')).toEqual({ tasks: 1, milestones: 0 })
    expect(work.get('2026-01-02')).toEqual({ tasks: 2, milestones: 1 })
    expect(work.has('2026-01-03')).toBe(false)
    expect(work.size).toBe(2)
  })

  it('grades a day as one, a few or many', () => {
    expect(workLevel(undefined)).toBe(0)
    expect(workLevel({ tasks: 1, milestones: 0 })).toBe(1)
    expect(workLevel({ tasks: 3, milestones: 1 })).toBe(2)
    expect(workLevel({ tasks: 5, milestones: 0 })).toBe(3)
  })

  it('counts 5,000 dated tasks quickly', () => {
    const items: Item[] = Array.from({ length: 5000 }, (_, index) => ({
      id: String(index),
      start: '2026-01-01',
      end: index % 2 ? '2026-12-31' : '2026-01-10'
    }))
    const began = performance.now()
    const work = yearWork(items, '2026-01-01', () => false)
    expect(performance.now() - began).toBeLessThan(250)
    expect(work.get('2026-06-01')).toEqual({ tasks: 2500, milestones: 0 })
  })
})

describe('Agenda layout', () => {
  it('lists each item once, on its first day in the month, leaving empty days out', () => {
    const items: Item[] = [
      { id: 'm', start: '2026-03-14', end: '2026-03-14', milestone: true },
      { id: 'span', start: '2026-03-14', end: '2026-03-18' },
      { id: 'from-feb', start: '2026-02-25', end: '2026-03-03' },
      { id: 'into-apr', start: '2026-03-30', end: '2026-04-02' },
      { id: 'april', start: '2026-04-01', end: '2026-04-01' }
    ]
    const march = agendaDays(items, '2026-03-20')
    expect(march.map((day) => [day.date, day.items.map((item) => item.id)])).toEqual([
      ['2026-03-01', ['from-feb']],
      ['2026-03-14', ['m', 'span']],
      ['2026-03-30', ['into-apr']]
    ])
    const april = agendaDays(items, '2026-04-10')
    expect(april.map((day) => [day.date, day.items.map((item) => item.id)])).toEqual([
      ['2026-04-01', ['into-apr', 'april']]
    ])
  })
})

describe('periods and settings', () => {
  it('moves a year in Year and a month in Agenda', () => {
    expect(shiftPeriod('2028-02-29', 'year', 1)).toBe('2029-02-28')
    expect(shiftPeriod('2026-10-15', 'year', -1)).toBe('2025-10-15')
    expect(shiftPeriod('2026-01-31', 'agenda', 1)).toBe('2026-02-28')
    expect(shiftPeriod('2026-01-15', 'agenda', -1)).toBe('2025-12-15')
  })

  it('keeps the new modes and falls back to Month for anything else', () => {
    expect(normalizeCalendarSettings({ mode: 'year' }).mode).toBe('year')
    expect(normalizeCalendarSettings({ mode: 'agenda' }).mode).toBe('agenda')
    expect(normalizeCalendarSettings({ mode: 'decade' }).mode).toBe('month')
  })
})
