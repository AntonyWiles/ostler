import { describe, expect, it } from 'vitest'
import {
  isOrderKey,
  MAX_ORDER_KEY_LENGTH,
  orderKeyBetween,
  spacedOrderKeys
} from '../../src/shared/planning/order-key'

describe('order keys (D31)', () => {
  it('makes a first key, and keys before the first and after the last', () => {
    const first = orderKeyBetween(null, null)
    expect(isOrderKey(first)).toBe(true)
    const before = orderKeyBetween(null, first)
    const after = orderKeyBetween(first, null)
    expect(before < first).toBe(true)
    expect(after > first).toBe(true)
    expect(isOrderKey(before)).toBe(true)
    expect(isOrderKey(after)).toBe(true)
  })

  it('puts a key strictly between two keys', () => {
    for (const [low, high] of [
      ['V', 'W'],
      ['V', 'V1'],
      ['Uz', 'V'],
      ['a', 'b0V'],
      ['0V', '1'],
      ['zz', 'zzV']
    ]) {
      const key = orderKeyBetween(low, high)
      expect(key > low && key < high, `${low} < ${key} < ${high}`).toBe(true)
      expect(isOrderKey(key)).toBe(true)
    }
  })

  it('refuses keys given the wrong way round', () => {
    expect(() => orderKeyBetween('b', 'a')).toThrow()
    expect(() => orderKeyBetween('a', 'a')).toThrow()
  })

  it('appends thousands of times with short keys', () => {
    let key: string | null = null
    for (let i = 0; i < 5000; i++) {
      const next = orderKeyBetween(key, null)
      if (key !== null) expect(next > key).toBe(true)
      key = next
    }
    expect(key!.length).toBeLessThanOrEqual(3)
  })

  it('splits one place many times, and grows only by a digit every few moves', () => {
    let low = orderKeyBetween(null, null)
    const high = orderKeyBetween(low, null)
    let moves = 0
    while (moves < 1000) {
      const key = orderKeyBetween(low, high)
      expect(key > low && key < high).toBe(true)
      low = key
      moves++
      if (key.length > MAX_ORDER_KEY_LENGTH) break
    }
    // Always moving to the same spot is what grows keys; the caller then respaces.
    expect(moves).toBeGreaterThan(100)
  })

  it('spaces keys evenly at one length, in order, with room between each pair', () => {
    for (const count of [1, 2, 61, 62, 500, 5000]) {
      const keys = spacedOrderKeys(count)
      expect(keys).toHaveLength(count)
      for (let i = 1; i < keys.length; i++) {
        expect(keys[i - 1] < keys[i]).toBe(true)
        const between = orderKeyBetween(keys[i - 1], keys[i])
        expect(between.length).toBeLessThanOrEqual(keys[i].length + 1)
      }
      expect(keys.every(isOrderKey)).toBe(true)
      expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(4)
    }
  })
})
