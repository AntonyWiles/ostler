import { describe, expect, it } from 'vitest'
import { tabsThatFit } from '@renderer/hooks/useTabsThatFit'

describe('tabsThatFit', () => {
  const widths = [100, 80, 80, 120, 90]

  it('shows every tab before the row is measured', () => {
    expect(tabsThatFit(widths, 4, 0, 0)).toEqual([0, 1, 2, 3, 4])
  })

  it('shows every tab when they all fit, gaps and all', () => {
    expect(tabsThatFit(widths, 4, 470 + 16, 0)).toEqual([0, 1, 2, 3, 4])
  })

  it('keeps as many from the start as fit, and stops at the first that does not', () => {
    // 100 + 4 + 80 + 4 + 80 = 268; the 120 after it does not fit.
    expect(tabsThatFit(widths, 4, 300, 0)).toEqual([0, 1, 2])
  })

  it('keeps the tab on show in its place, fitting the others around it', () => {
    // The 90 on show, then 100 and 80 from the start: 90 + 4 + 100 + 4 + 80 = 278.
    expect(tabsThatFit(widths, 4, 300, 4)).toEqual([0, 1, 4])
  })

  it('shows the tab on show alone when nothing else fits', () => {
    expect(tabsThatFit(widths, 4, 50, 3)).toEqual([3])
  })
})
