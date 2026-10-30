import { describe, expect, it } from 'vitest'
import {
  countWorkingDays,
  dayOffOn,
  daysOffBetween,
  isWorkingDay,
  nextWorkingDay,
  peopleOffOn,
  workingDaysAfter,
  type DayOffSpan
} from '../../src/shared/planning/working-days'

const christmas: DayOffSpan = {
  personId: null,
  firstDate: '2026-12-25',
  lastDate: '2026-12-25',
  name: 'Christmas Day'
}
const boxing: DayOffSpan = {
  personId: null,
  firstDate: '2026-12-28',
  lastDate: '2026-12-28',
  name: 'Boxing Day (substitute)'
}
const samLeave: DayOffSpan = {
  personId: 'sam',
  firstDate: '2026-12-21',
  lastDate: '2027-01-08',
  name: 'Leave'
}
const daysOff = [christmas, boxing, samLeave]

describe('working-days.ts (N3.2)', () => {
  it('names everyone’s day off, and a person’s only for them', () => {
    expect(dayOffOn('2026-12-25', null, daysOff)?.name).toBe('Christmas Day')
    expect(dayOffOn('2026-12-22', null, daysOff)).toBeNull()
    expect(dayOffOn('2026-12-22', 'sam', daysOff)?.name).toBe('Leave')
    expect(dayOffOn('2026-12-22', 'alex', daysOff)).toBeNull()
    // Everyone’s comes first where both fall.
    expect(dayOffOn('2026-12-25', 'sam', daysOff)?.name).toBe('Christmas Day')
    expect(peopleOffOn('2026-12-22', daysOff)).toEqual(['sam'])
  })

  it('treats a day off and a non-working weekday as not working', () => {
    expect(isWorkingDay('2026-12-24', null, { daysOff })).toBe(true)
    expect(isWorkingDay('2026-12-25', null, { daysOff })).toBe(false)
    expect(isWorkingDay('2026-12-26', null, { daysOff })).toBe(false) // a Saturday
    expect(isWorkingDay('2026-12-26', null, { workingDays: [6], daysOff })).toBe(true)
    expect(isWorkingDay('2026-12-24', 'sam', { daysOff })).toBe(false)
  })

  it('uses Monday to Friday without working days from R3.2', () => {
    expect(isWorkingDay('2026-10-17', 'sam')).toBe(false)
    expect(isWorkingDay('2026-10-16', 'sam')).toBe(true)
    expect(isWorkingDay('2026-10-16', null, { workingDays: [] })).toBe(true)
  })

  it('finds the next working day across a long holiday', () => {
    expect(nextWorkingDay('2026-12-24', null, { daysOff })).toBe('2026-12-24')
    expect(nextWorkingDay('2026-12-25', null, { daysOff })).toBe('2026-12-29')
    expect(nextWorkingDay('2026-12-21', 'sam', { daysOff })).toBe('2027-01-11')
    expect(nextWorkingDay('2026-12-25', 'sam', { workingDays: [1, 2, 3], daysOff })).toBe(
      '2027-01-11'
    )
    expect(workingDaysAfter('2026-12-23', 3, null, { daysOff })).toEqual([
      '2026-12-24',
      '2026-12-29',
      '2026-12-30'
    ])
  })

  it('counts working days in a range, taking days off away once', () => {
    // 21 Dec to 1 Jan: ten weekdays, Christmas and the 28th off.
    expect(countWorkingDays('2026-12-21', '2027-01-01', null, { daysOff })).toBe(8)
    expect(countWorkingDays('2026-12-21', '2027-01-01', 'sam', { daysOff })).toBe(0)
    // A day off on a weekend changes nothing.
    const weekend: DayOffSpan = { ...christmas, firstDate: '2026-12-26', lastDate: '2026-12-27' }
    expect(countWorkingDays('2026-12-21', '2026-12-27', null, { daysOff: [weekend] })).toBe(5)
    expect(daysOffBetween('2026-12-21', '2026-12-27', null, { daysOff })).toEqual([
      { date: '2026-12-25', dayOff: christmas }
    ])
  })

  it('ignores a day off whose dates are not valid', () => {
    const broken: DayOffSpan = { ...christmas, firstDate: '2026-12-26', lastDate: '2026-12-20' }
    expect(isWorkingDay('2026-12-22', null, { daysOff: [broken] })).toBe(true)
  })
})
