import { IPC_CHANNELS } from '@shared/ostler-api'

/**
 * The longest Ostler waits, on quit, for the window to save edits typed in the
 * last second (R1.5, D30). Saves are local and take milliseconds; a window
 * that does not answer in time is not waited for any longer.
 */
export const FLUSH_EDITS_TIMEOUT_MS = 2000

/** The part of a BrowserWindow the flush needs. */
export interface FlushableWindow {
  isDestroyed(): boolean
  webContents: { send(channel: string, ...args: unknown[]): void }
}

export interface EditFlusher {
  /** Asks the window to save its pending edits; resolves when it has, or after the wait. */
  flush(window: FlushableWindow | null): Promise<void>
  /** The window's answer (`editsFlushed`) to the request with this id. */
  acknowledge(requestId: unknown): void
}

export function createEditFlusher(timeoutMs = FLUSH_EDITS_TIMEOUT_MS): EditFlusher {
  let nextId = 1
  const waiting = new Map<number, () => void>()
  return {
    flush(window) {
      if (!window || window.isDestroyed()) return Promise.resolve()
      const id = nextId++
      return new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          waiting.delete(id)
          resolve()
        }
        const timer = setTimeout(done, timeoutMs)
        waiting.set(id, done)
        try {
          window.webContents.send(IPC_CHANNELS.ON_FLUSH_EDITS, id)
        } catch {
          done()
        }
      })
    },
    acknowledge(requestId) {
      if (typeof requestId === 'number') waiting.get(requestId)?.()
    }
  }
}
