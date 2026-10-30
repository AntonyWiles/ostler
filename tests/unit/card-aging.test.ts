import { describe, expect, it } from 'vitest'
import { formatTimeInColumn, isAgedInColumn } from '@renderer/views/planning/card-aging'

describe('card aging', () => {
  it('formats column age as a single glanceable token', () => {
    const now = Date.UTC(2026, 7, 25, 12)
    expect(formatTimeInColumn(now - 30_000, now)).toBe('now')
    expect(formatTimeInColumn(now - 5 * 60_000, now)).toBe('5m')
    expect(formatTimeInColumn(now - 5 * 3_600_000, now)).toBe('5h')
    expect(formatTimeInColumn(now - 3 * 86_400_000, now)).toBe('3d')
    expect(formatTimeInColumn(now - 21 * 86_400_000, now)).toBe('3w')
  })

  it('flags items that have sat in a column past the threshold', () => {
    const now = Date.UTC(2026, 7, 25, 12)
    expect(isAgedInColumn(now - 3 * 86400000, now)).toBe(true)
    expect(isAgedInColumn(now - 86400000, now)).toBe(false)
  })
})
