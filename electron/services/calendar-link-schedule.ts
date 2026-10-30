/**
 * When subscribed calendar links are fetched (N3.3b, decision N27 A): once a
 * minute after Ostler starts (never during the cold start), then every hour
 * while it runs. Adding a link and Refresh fetch on their own; nothing else
 * does. A hidden link is paused: no pass fetches it, and showing it again
 * fetches it at once (`OutsideCalendarService.update`), then hourly as before.
 * With no shown link, no pass fetches anything. A pass fetches the links one
 * after another, and a pass never starts while the last is still running.
 */

export const FIRST_FETCH_DELAY_MS = 60_000
export const FETCH_INTERVAL_MS = 60 * 60_000

export interface CalendarLinkScheduleDependencies {
  /** Whether any shown calendar is a link. */
  hasLinks(): boolean
  /** Fetches every shown link, one after another. */
  refreshLinks(): Promise<unknown>
  /** After a pass that fetched: the Calendar and Settings read again. */
  onRefreshed?(): void
  setTimer?(callback: () => void, ms: number): unknown
  clearTimer?(handle: unknown): void
  firstDelayMs?: number
  intervalMs?: number
}

export class CalendarLinkSchedule {
  private timer: unknown = null
  private running = false
  private stopped = true

  constructor(private readonly deps: CalendarLinkScheduleDependencies) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.schedule(this.deps.firstDelayMs ?? FIRST_FETCH_DELAY_MS)
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) (this.deps.clearTimer ?? defaultClear)(this.timer)
    this.timer = null
  }

  /** One pass; exposed for tests. Skipped while one is running or with no links. */
  async tick(): Promise<void> {
    if (this.running || !this.deps.hasLinks()) return
    this.running = true
    try {
      await this.deps.refreshLinks()
      this.deps.onRefreshed?.()
    } catch {
      // Each failure is recorded on its calendar; nothing to add here.
    } finally {
      this.running = false
    }
  }

  private schedule(ms: number): void {
    if (this.stopped) return
    this.timer = (this.deps.setTimer ?? defaultSet)(() => {
      this.timer = null
      void this.tick().finally(() => this.schedule(this.deps.intervalMs ?? FETCH_INTERVAL_MS))
    }, ms)
  }
}

function defaultSet(callback: () => void, ms: number): unknown {
  const handle = setTimeout(callback, ms)
  handle.unref?.()
  return handle
}

function defaultClear(handle: unknown): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>)
}
