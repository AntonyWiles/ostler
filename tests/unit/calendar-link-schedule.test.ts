import { describe, expect, it, vi } from 'vitest'
import {
  CalendarLinkSchedule,
  FETCH_INTERVAL_MS,
  FIRST_FETCH_DELAY_MS
} from '../../electron/services/calendar-link-schedule'

/** A clock the test moves by hand. */
function fakeClock() {
  let now = 0
  let next = 1
  const timers = new Map<number, { at: number; callback: () => void }>()
  return {
    setTimer: (callback: () => void, ms: number) => {
      const id = next++
      timers.set(id, { at: now + ms, callback })
      return id
    },
    clearTimer: (id: unknown) => void timers.delete(id as number),
    pending: () => timers.size,
    async advance(ms: number) {
      const until = now + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].callback()
        // Let the pass and its rescheduling run.
        for (let i = 0; i < 10; i += 1) await Promise.resolve()
      }
      now = until
    }
  }
}

describe('CalendarLinkSchedule (N3.3b)', () => {
  it('waits a minute after start, then fetches every hour', async () => {
    const clock = fakeClock()
    const refreshLinks = vi.fn(async () => 1)
    const onRefreshed = vi.fn()
    const schedule = new CalendarLinkSchedule({
      hasLinks: () => true,
      refreshLinks,
      onRefreshed,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer
    })
    schedule.start()
    await clock.advance(FIRST_FETCH_DELAY_MS - 1)
    expect(refreshLinks).not.toHaveBeenCalled()
    await clock.advance(1)
    expect(refreshLinks).toHaveBeenCalledTimes(1)
    expect(onRefreshed).toHaveBeenCalledTimes(1)
    await clock.advance(FETCH_INTERVAL_MS - 1)
    expect(refreshLinks).toHaveBeenCalledTimes(1)
    await clock.advance(1)
    expect(refreshLinks).toHaveBeenCalledTimes(2)
    await clock.advance(FETCH_INTERVAL_MS * 3)
    expect(refreshLinks).toHaveBeenCalledTimes(5)
    schedule.stop()
    expect(clock.pending()).toBe(0)
    await clock.advance(FETCH_INTERVAL_MS * 3)
    expect(refreshLinks).toHaveBeenCalledTimes(5)
  })

  it('fetches nothing while there are no links', async () => {
    const clock = fakeClock()
    const refreshLinks = vi.fn(async () => 0)
    const schedule = new CalendarLinkSchedule({
      hasLinks: () => false,
      refreshLinks,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer
    })
    schedule.start()
    await clock.advance(FETCH_INTERVAL_MS * 5)
    expect(refreshLinks).not.toHaveBeenCalled()
    schedule.stop()
  })

  it('never starts a pass while the last one is still running', async () => {
    let finish: () => void = () => {}
    let running = 0
    let most = 0
    const refreshLinks = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          running += 1
          most = Math.max(most, running)
          finish = () => {
            running -= 1
            resolve()
          }
        })
    )
    const schedule = new CalendarLinkSchedule({ hasLinks: () => true, refreshLinks })
    const first = schedule.tick()
    const second = schedule.tick()
    await second
    expect(refreshLinks).toHaveBeenCalledTimes(1)
    finish()
    await first
    expect(most).toBe(1)
  })
})
