/**
 * Start-up work that can wait until the first screen is on (P9.1): the
 * backup check, task housekeeping and the Git history sync. The window says
 * when its first screen (Home, or a project view) has rendered; if it never
 * does (a window started hidden in the tray paints nothing), the fallback
 * timer runs the work anyway.
 *
 * Never deferred: recovering interrupted agent sessions and applying a pending
 * restore, which run before anything else (`main.ts`, `startServices`).
 */
export interface DeferredStartup {
  /**
   * Runs `task` once the first screen is on, in the order given; at once (on
   * the next tick) if it already is. The promise settles with the task.
   */
  run<T>(name: string, task: () => T | Promise<T>): Promise<T>
  /** Starts the fallback timer. Called when the services start. */
  arm(): void
  /** The first screen rendered: runs what is waiting. Later calls do nothing. */
  release(): void
  /** Whether the deferred work has been let go. */
  readonly released: boolean
  /** Drops waiting work and the timer (services stopping). */
  cancel(): void
}

export interface DeferredStartupOptions {
  fallbackMs: number
  onError(name: string, error: unknown): void
  /** Called once, after the waiting work has been started. */
  onReleased?(): void
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

export const DEFERRED_STARTUP_FALLBACK_MS = 10_000

export function createDeferredStartup(options: DeferredStartupOptions): DeferredStartup {
  const setTimer =
    options.setTimer ??
    ((callback: () => void, ms: number) => {
      const timer = setTimeout(callback, ms)
      timer.unref?.()
      return timer
    })
  const clearTimer =
    options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  let released = false
  let cancelled = false
  let timer: unknown = null
  const waiting: Array<() => void> = []

  const start = <T>(name: string, task: () => T | Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const go = () => {
        if (cancelled) return
        Promise.resolve()
          .then(task)
          .then(resolve, (error) => {
            options.onError(name, error)
            reject(error)
          })
      }
      if (released) go()
      else waiting.push(go)
    })

  return {
    run: start,
    arm() {
      if (released || cancelled || timer !== null) return
      timer = setTimer(() => this.release(), options.fallbackMs)
    },
    release() {
      if (released || cancelled) return
      released = true
      if (timer !== null) clearTimer(timer)
      timer = null
      for (const go of waiting.splice(0)) go()
      options.onReleased?.()
    },
    get released() {
      return released
    },
    cancel() {
      cancelled = true
      if (timer !== null) clearTimer(timer)
      timer = null
      waiting.length = 0
    }
  }
}
