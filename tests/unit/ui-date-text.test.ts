import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysFromToday,
  parseIsoDate,
  relativeDateText,
  toIsoDate
} from '../../src/renderer/ui/date-text'

const today = new Date(2026, 9, 8, 15, 30) // 8 October 2026, mid-afternoon

describe('relativeDateText', () => {
  it('names today, tomorrow and the coming week', () => {
    expect(relativeDateText('2026-10-08', { today })).toBe('Today')
    expect(relativeDateText('2026-10-09', { today })).toBe('Tomorrow')
    expect(relativeDateText('2026-10-11', { today })).toBe('In 3 days')
    expect(relativeDateText('2026-10-15', { today })).toBe('In 7 days')
    expect(relativeDateText('2026-10-16', { today })).toBe('')
  })

  it('says how overdue a due date is', () => {
    expect(relativeDateText('2026-10-07', { today })).toBe('Overdue by 1 day')
    expect(relativeDateText('2026-10-06', { today })).toBe('Overdue by 2 days')
  })

  it('says how long ago a plain date was', () => {
    expect(relativeDateText('2026-10-07', { today, due: false })).toBe('Yesterday')
    expect(relativeDateText('2026-10-03', { today, due: false })).toBe('5 days ago')
  })

  it('crosses month and year boundaries', () => {
    const newYearsEve = new Date(2026, 11, 31)
    expect(relativeDateText('2027-01-01', { today: newYearsEve })).toBe('Tomorrow')
  })

  it('is empty for invalid dates', () => {
    expect(relativeDateText('', { today })).toBe('')
    expect(relativeDateText('2026-02-30', { today })).toBe('')
    expect(relativeDateText('tomorrow', { today })).toBe('')
  })
})

describe('date helpers', () => {
  it('formats, parses and adds days in local time', () => {
    expect(toIsoDate(today)).toBe('2026-10-08')
    expect(toIsoDate(addDays(today, 30))).toBe('2026-11-07')
    expect(parseIsoDate('2026-10-08')?.getDate()).toBe(8)
    expect(parseIsoDate('2026-13-01')).toBeNull()
    expect(daysFromToday('2026-10-01', today)).toBe(-7)
  })
})
