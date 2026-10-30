import { describe, expect, it } from 'vitest'
import { cardDue } from '@renderer/views/planning/card-due'

// A Wednesday.
const today = new Date(2026, 9, 7)

describe('cardDue', () => {
  it('says Today, Tomorrow and Yesterday in words', () => {
    expect(cardDue('2026-10-07', false, today)?.text).toBe('Today')
    expect(cardDue('2026-10-08', false, today)?.text).toBe('Tomorrow')
    expect(cardDue('2026-10-06', false, today)?.text).toBe('Yesterday')
  })

  it('uses the weekday within the week and the date beyond it', () => {
    const friday = cardDue('2026-10-09', false, today)!.text
    expect(friday).toBe(new Date(2026, 9, 9).toLocaleDateString(undefined, { weekday: 'short' }))
    const later = cardDue('2026-10-20', false, today)!.text
    expect(later).not.toMatch(/2026/)
    expect(cardDue('2027-01-05', false, today)!.text).toMatch(/2027/)
  })

  it('is overdue once passed, soon within two days, and neither once done', () => {
    expect(cardDue('2026-10-01', false, today)).toMatchObject({ tone: 'overdue' })
    expect(cardDue('2026-10-01', false, today)!.title).toMatch(/^Overdue by 6 days/)
    expect(cardDue('2026-10-09', false, today)).toMatchObject({ tone: 'soon' })
    expect(cardDue('2026-10-10', false, today)).toMatchObject({ tone: 'plain' })
    expect(cardDue('2026-10-01', true, today)).toMatchObject({ tone: 'plain' })
  })

  it('ignores a value that is not a date', () => {
    expect(cardDue('soon', false, today)).toBeNull()
  })
})
