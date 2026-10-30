// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlanningCreateForm } from '@renderer/hooks/planning/usePlanningCreateForm'

const ORIGINAL_TZ = process.env.TZ

describe('usePlanningCreateForm decision date', () => {
  beforeEach(() => {
    // 20:00 UTC on 14 Oct is already 15 Oct in Tonga.
    process.env.TZ = 'Pacific/Tongatapu'
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T20:00:00Z') })
  })
  afterEach(() => {
    vi.useRealTimers()
    process.env.TZ = ORIGINAL_TZ
  })

  it('defaults to the local date, on open and after a reset', () => {
    const { result } = renderHook(() => usePlanningCreateForm())
    expect(result.current.decisionDate).toBe('2026-10-15')
    act(() => result.current.setDecisionDate('2026-01-01'))
    act(() => result.current.closeCreate())
    expect(result.current.decisionDate).toBe('2026-10-15')
  })
})
