import { describe, expect, it } from 'vitest'
import {
  HybridClock,
  MAX_COUNTER,
  compareStamps,
  formatStamp,
  parseStamp
} from '@shared/sync/clock'

describe('sync clock stamps', () => {
  it('round-trips a stamp and rejects bad input', () => {
    const stamp = formatStamp({ wall: 1_700_000_000_123, counter: 42, device: 'pc-a' })
    expect(stamp).toBe('001700000000123-000042-pc-a')
    expect(parseStamp(stamp)).toEqual({ wall: 1_700_000_000_123, counter: 42, device: 'pc-a' })

    expect(() => formatStamp({ wall: -1, counter: 0, device: 'pc-a' })).toThrow(RangeError)
    expect(() => formatStamp({ wall: 1, counter: MAX_COUNTER + 1, device: 'pc-a' })).toThrow(
      RangeError
    )
    expect(() => formatStamp({ wall: 1, counter: 0, device: '' })).toThrow(RangeError)
    expect(() => formatStamp({ wall: 1, counter: 0, device: 'pc a' })).toThrow(RangeError)
    expect(() => parseStamp('nonsense')).toThrow(RangeError)
  })

  it('gives increasing stamps for ticks, including when the PC clock goes back', () => {
    let now = 5000
    const clock = new HybridClock('pc-a', () => now)
    expect(clock.tick()).toBe('000000000005000-000000-pc-a')
    expect(clock.tick()).toBe('000000000005000-000001-pc-a')
    now = 9000
    expect(clock.tick()).toBe('000000000009000-000000-pc-a')
    now = 4000
    const back = clock.tick()
    expect(back).toBe('000000000009000-000001-pc-a')
    expect(compareStamps(back, '000000000009000-000000-pc-a')).toBe(1)
  })

  it('sorts a local stamp after a far-future remote stamp', () => {
    const clock = new HybridClock('pc-a', () => 1000)
    const remote = formatStamp({ wall: 9_000_000_000_000, counter: 3, device: 'pc-b' })
    const received = clock.receive(remote)
    expect(compareStamps(received, remote)).toBe(1)
    expect(received.endsWith('-pc-a')).toBe(true)
    const next = clock.tick()
    expect(compareStamps(next, remote)).toBe(1)
    expect(next.endsWith('-pc-a')).toBe(true)
  })

  it('orders stamps with the same wall and counter by device', () => {
    const alpha = formatStamp({ wall: 5000, counter: 0, device: 'alpha' })
    const zeta = formatStamp({ wall: 5000, counter: 0, device: 'zeta' })
    expect(compareStamps(alpha, zeta)).toBe(-1)
    expect(compareStamps(zeta, alpha)).toBe(1)
    expect([zeta, alpha].sort()).toEqual([alpha, zeta])
  })
})
