import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/ostler-api'
import { FLUSH_EDITS_TIMEOUT_MS, createEditFlusher } from '../../electron/app/desktop/edit-flush'

/** A window that records what main sends it. */
function fakeWindow(destroyed = false) {
  const sent: Array<{ channel: string; args: unknown[] }> = []
  return {
    sent,
    isDestroyed: () => destroyed,
    webContents: { send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }) }
  }
}

describe('saving edits on quit (R1.5)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('asks the window to save, and resolves when it answers', async () => {
    const flusher = createEditFlusher()
    const window = fakeWindow()
    let done = false
    const flushing = flusher.flush(window).then(() => (done = true))
    expect(window.sent).toEqual([{ channel: IPC_CHANNELS.ON_FLUSH_EDITS, args: [1] }])
    await Promise.resolve()
    expect(done).toBe(false)
    flusher.acknowledge('1') // not the request's id
    flusher.acknowledge(1)
    await flushing
    expect(done).toBe(true)
  })

  it('never waits longer than its fixed wait for a window that does not answer', async () => {
    vi.useFakeTimers()
    const flusher = createEditFlusher()
    let done = false
    void flusher.flush(fakeWindow()).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(FLUSH_EDITS_TIMEOUT_MS - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
    expect(FLUSH_EDITS_TIMEOUT_MS).toBeLessThanOrEqual(2000)
  })

  it('does not wait for a window that is gone', async () => {
    const flusher = createEditFlusher()
    const window = fakeWindow(true)
    await flusher.flush(window)
    await flusher.flush(null)
    expect(window.sent).toEqual([])
  })
})
