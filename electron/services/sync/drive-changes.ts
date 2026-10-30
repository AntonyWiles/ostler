/**
 * One poller per Google account asks Drive "what changed?" and wakes only the Drive transports whose
 * folders changed, instead of every transport listing its whole folder tree. Polls every `baseMs`;
 * after `quietMs` with no change anyone cares about, the gap doubles each time up to `maxMs`, and it
 * drops back to `baseMs` on a change or `kick()`. Platform-neutral: the phone uses it too, so timers
 * come from options and nothing here touches Electron or the file system.
 */
import type { DriveClient } from './drive-client'

export interface DriveChangesOptions {
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  now?: () => number
  /** Gap between polls while things change; default 60 000 ms. */
  baseMs?: number
  /** Longest gap after a quiet spell; default 300 000 ms. */
  maxMs?: number
  /** How long without a change before the gap starts doubling; default 600 000 ms. */
  quietMs?: number
}

interface Subscriber {
  interestedIn: (parentIds: string[]) => boolean
  onChange: () => void
}

export class DriveChangesPoller {
  private readonly subscribers = new Set<Subscriber>()
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private readonly now: () => number
  private readonly baseMs: number
  private readonly maxMs: number
  private readonly quietMs: number
  private token: string | null = null
  private timer: unknown = null
  private gapMs: number
  private lastChange = 0
  private polling = false
  /** `kick()` came while a poll was running: poll again straight after it. */
  private kicked = false
  /** Bumped on stop, so a poll that was running when the last subscriber left is ignored. */
  private run = 0

  constructor(
    private readonly client: DriveClient,
    options: DriveChangesOptions = {}
  ) {
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    this.now = options.now ?? (() => Date.now())
    this.baseMs = options.baseMs ?? 60_000
    this.maxMs = options.maxMs ?? 300_000
    this.quietMs = options.quietMs ?? 600_000
    this.gapMs = this.baseMs
  }

  /** `onChange` is called at most once per poll, when a change has a parent `interestedIn` accepts. */
  subscribe(interestedIn: (parentIds: string[]) => boolean, onChange: () => void): () => void {
    const subscriber: Subscriber = { interestedIn, onChange }
    this.subscribers.add(subscriber)
    if (this.subscribers.size === 1) this.start()
    return () => {
      if (!this.subscribers.delete(subscriber)) return
      if (this.subscribers.size === 0) this.stop()
    }
  }

  /** Poll soon and go back to the shortest gap; called after a local write. */
  kick(): void {
    if (this.subscribers.size === 0) return
    this.gapMs = this.baseMs
    this.lastChange = this.now()
    if (this.polling) {
      this.kicked = true
      return
    }
    this.schedule(0)
  }

  private start(): void {
    this.gapMs = this.baseMs
    this.lastChange = this.now()
    this.schedule(0)
  }

  private stop(): void {
    this.run += 1
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
    this.token = null
    this.polling = false
    this.kicked = false
  }

  private schedule(ms: number): void {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.poll()
    }, ms)
  }

  private async poll(): Promise<void> {
    const run = this.run
    this.polling = true
    let woken = new Set<Subscriber>()
    try {
      if (this.token === null) {
        // The first poll only marks where "changed since" starts.
        const token = await this.client.startPageToken()
        if (run !== this.run) return
        this.token = token
      } else {
        // Page through from the stored token; keep it until every page has come back.
        let pageToken = this.token
        const changedParents: string[][] = []
        for (;;) {
          const page = await this.client.changes(pageToken)
          if (run !== this.run) return
          for (const change of page.changes) changedParents.push(change.parents)
          if (page.nextPageToken) {
            pageToken = page.nextPageToken
            continue
          }
          if (page.newStartPageToken) this.token = page.newStartPageToken
          break
        }
        woken = this.interested(changedParents)
      }
    } catch {
      // Offline or refused: the stored token stays, and the next tick tries again.
    }
    if (run !== this.run) return
    this.polling = false

    if (woken.size > 0) {
      this.gapMs = this.baseMs
      this.lastChange = this.now()
    } else if (this.now() - this.lastChange >= this.quietMs) {
      this.gapMs = Math.min(this.gapMs * 2, this.maxMs)
    }
    for (const subscriber of woken) {
      if (!this.subscribers.has(subscriber)) continue
      try {
        subscriber.onChange()
      } catch {
        // One subscriber's failure must not stop the others hearing.
      }
    }
    if (this.subscribers.size === 0 || run !== this.run) return
    if (this.kicked) {
      this.kicked = false
      this.schedule(0)
    } else {
      this.schedule(this.gapMs)
    }
  }

  private interested(changedParents: string[][]): Set<Subscriber> {
    const woken = new Set<Subscriber>()
    if (changedParents.length === 0) return woken
    for (const subscriber of this.subscribers) {
      if (changedParents.some((parents) => subscriber.interestedIn(parents))) woken.add(subscriber)
    }
    return woken
  }
}
