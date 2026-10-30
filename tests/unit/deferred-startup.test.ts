import { describe, expect, it, vi } from 'vitest'
import { createDeferredStartup } from '../../electron/app/deferred-startup'

function harness() {
  let fire: (() => void) | null = null
  const errors: string[] = []
  const startup = createDeferredStartup({
    fallbackMs: 10_000,
    onError: (name) => errors.push(name),
    setTimer: (callback) => {
      fire = callback
      return 1
    },
    clearTimer: () => {
      fire = null
    }
  })
  return { startup, errors, fireFallback: () => fire?.() }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('deferred start-up work (P9.1)', () => {
  it('waits for the first screen, then runs in the order given', async () => {
    const { startup } = harness()
    const order: string[] = []
    void startup.run('backups', () => order.push('backups'))
    void startup.run('housekeeping', () => order.push('housekeeping'))
    await tick()
    expect(order).toEqual([])
    startup.release()
    await tick()
    expect(order).toEqual(['backups', 'housekeeping'])
  })

  it('runs at once once released, and only ever releases once', async () => {
    const { startup } = harness()
    const onReleased = vi.fn()
    const released = createDeferredStartup({ fallbackMs: 1, onError: () => {}, onReleased })
    released.release()
    released.release()
    expect(onReleased).toHaveBeenCalledTimes(1)
    startup.release()
    await expect(startup.run('git history', () => 42)).resolves.toBe(42)
  })

  it('falls back to a timer when no screen ever reports (a window started hidden)', async () => {
    const { startup, fireFallback } = harness()
    const task = vi.fn()
    void startup.run('backups', task)
    startup.arm()
    fireFallback()
    await tick()
    expect(task).toHaveBeenCalledTimes(1)
    expect(startup.released).toBe(true)
  })

  it('reports a failing task by name without stopping the rest', async () => {
    const { startup, errors } = harness()
    const after = vi.fn()
    const failing = startup.run('housekeeping', () => {
      throw new Error('boom')
    })
    void startup.run('git history', after)
    startup.release()
    await expect(failing).rejects.toThrow('boom')
    await tick()
    expect(errors).toEqual(['housekeeping'])
    expect(after).toHaveBeenCalled()
  })

  it('drops waiting work when the services stop first', async () => {
    const { startup } = harness()
    const task = vi.fn()
    void startup.run('backups', task)
    startup.cancel()
    startup.release()
    await tick()
    expect(task).not.toHaveBeenCalled()
  })
})
