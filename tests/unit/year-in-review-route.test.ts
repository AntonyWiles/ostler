import { describe, expect, it } from 'vitest'
import {
  parseMyWeekHash,
  parseYearInReviewHash,
  yearInReviewHashPath
} from '../../src/shared/print-route'

describe("Your year's print route (N3.6)", () => {
  it('builds and reads the year and week start', () => {
    const hash = yearInReviewHashPath({ year: 2026, weekStart: 1 })
    expect(hash).toBe('/print/year-in-review?year=2026&weekStart=1')
    expect(parseYearInReviewHash(hash)).toEqual({ year: 2026, weekStart: 1 })
    expect(parseMyWeekHash(hash)).toBeNull()
  })

  it('refuses anything else', () => {
    expect(() => yearInReviewHashPath({ year: 26, weekStart: 1 })).toThrow()
    expect(() => yearInReviewHashPath({ year: 2026, weekStart: 7 as 1 })).toThrow()
    expect(parseYearInReviewHash('/print/year-in-review?year=2026')).toBeNull()
    expect(parseYearInReviewHash('/print/year-in-review?year=2026&weekStart=9')).toBeNull()
    expect(parseYearInReviewHash('/print/year-in-review?year=1200&weekStart=1')).toBeNull()
    expect(parseYearInReviewHash('/print/my-week?today=2026-10-15')).toBeNull()
  })
})
