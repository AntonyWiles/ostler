import { describe, expect, it } from 'vitest'
import { bridgeRoute } from '../../electron/services/opencode/bridge-routes'
import { PLAN_FIRST_AVAILABLE } from '../../src/shared/plan-first'

describe('bridgeRoute', () => {
  it('has a handler for each path the Ostler plugin posts to', () => {
    for (const path of [
      '/tool-call',
      '/tool-result',
      '/event',
      '/ask',
      '/complete',
      '/security-violation'
    ]) {
      expect(bridgeRoute(path), path).toBeTypeOf('function')
    }
  })

  it('answers /plan only while plan first is on', () => {
    expect(Boolean(bridgeRoute('/plan'))).toBe(PLAN_FIRST_AVAILABLE)
  })

  it('has no handler for unknown paths or object keys', () => {
    expect(bridgeRoute('/nope')).toBeUndefined()
    expect(bridgeRoute('toString')).toBeUndefined()
    expect(bridgeRoute('__proto__')).toBeUndefined()
  })
})
