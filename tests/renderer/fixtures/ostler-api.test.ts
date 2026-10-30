// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { installOstlerApi } from './ostler-api'

describe('installOstlerApi', () => {
  it('answers an unmocked method with a "not mocked" failure', async () => {
    const api = installOstlerApi()

    await expect(api.getPlanningGoals('p1')).resolves.toEqual({
      ok: false,
      error: 'ostlerAPI.getPlanningGoals is not mocked in this test'
    })
    expect(window.ostlerAPI).toBe(api)
  })

  it('gives every subscription a no-op unsubscribe', () => {
    const unsubscribe = installOstlerApi().onProjectStateChange(() => {})

    expect(typeof unsubscribe).toBe('function')
    expect(() => unsubscribe()).not.toThrow()
  })

  it('uses an override when one is given', async () => {
    const api = installOstlerApi({ getPlanningGoals: async () => ({ ok: true, value: [] }) })

    await expect(api.getPlanningGoals('p1')).resolves.toEqual({ ok: true, value: [] })
  })
})
