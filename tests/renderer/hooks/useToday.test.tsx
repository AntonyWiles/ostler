// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useToday } from '@renderer/hooks/useToday'

function Today() {
  return <span data-testid="today">{useToday()}</span>
}

afterEach(() => vi.useRealTimers())

it('turns over to the new day at local midnight, with nothing else rendering', () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date(2026, 9, 14, 23, 59, 30))
  render(<Today />)
  expect(screen.getByTestId('today')).toHaveTextContent('2026-10-14')
  act(() => {
    vi.advanceTimersByTime(29_000)
  })
  expect(screen.getByTestId('today')).toHaveTextContent('2026-10-14')
  act(() => {
    vi.advanceTimersByTime(2_000)
  })
  expect(screen.getByTestId('today')).toHaveTextContent('2026-10-15')
  // And again the night after.
  act(() => {
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
  })
  expect(screen.getByTestId('today')).toHaveTextContent('2026-10-16')
})
