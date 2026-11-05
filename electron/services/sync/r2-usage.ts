/**
 * Counts this device's calls to the R2 bucket by R2's billing class, per calendar month, and
 * remembers how the last call went. R2's free tier is per account (every device together):
 * a million class A calls (writes and listings) and ten million class B calls (reads and HEADs)
 * a month. docs/sync.md works out what a typical setup uses.
 */

export const R2_FREE_CLASS_A = 1_000_000
export const R2_FREE_CLASS_B = 10_000_000
/**
 * The share of the free tier one device may use before Advanced sync warns: the tier is shared by
 * every device on the account, so a device using half of it leaves little for the others.
 */
export const R2_WARN_SHARE = 0.5

export type R2CallClass = 'A' | 'B'

export interface R2UsageTotals {
  /** `YYYY-MM`, in the device's time zone. */
  month: string
  /** Class A: writes and listings. */
  writes: number
  /** Class B: reads and HEADs. */
  reads: number
}

/** Why the last call failed, as `R2Error.reason`; null after one that worked. */
export type R2LastError = string | null

export interface R2UsageOptions {
  /** What `save` stored before; anything else starts at zero. */
  initial?: unknown
  save?(totals: R2UsageTotals): void
  now?(): number
  /** How long counts wait before they are saved, so a burst of calls is one save; default 10 s. */
  saveDelayMs?: number
}

const DEFAULT_SAVE_DELAY_MS = 10_000

export function monthOf(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** True when this device alone has used `R2_WARN_SHARE` of either free allowance this month. */
export function nearFreeTier(totals: R2UsageTotals): boolean {
  return (
    totals.writes >= R2_FREE_CLASS_A * R2_WARN_SHARE ||
    totals.reads >= R2_FREE_CLASS_B * R2_WARN_SHARE
  )
}

export class R2Usage {
  private current: R2UsageTotals
  private timer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<() => void>()
  lastError: R2LastError = null

  constructor(private readonly options: R2UsageOptions = {}) {
    const month = monthOf(this.now())
    const saved = options.initial as Partial<R2UsageTotals> | null | undefined
    this.current =
      saved && saved.month === month
        ? { month, writes: whole(saved.writes), reads: whole(saved.reads) }
        : { month, writes: 0, reads: 0 }
  }

  /** Adds counts saved earlier (read after this started counting) when they are for this month. */
  restore(saved: unknown): void {
    this.roll()
    const old = saved as Partial<R2UsageTotals> | null | undefined
    if (!old || old.month !== this.current.month) return
    this.current.writes += whole(old.writes)
    this.current.reads += whole(old.reads)
  }

  count(kind: R2CallClass): void {
    this.roll()
    if (kind === 'A') this.current.writes += 1
    else this.current.reads += 1
    this.saveSoon()
  }

  /** How the last call went: the `R2Error` reason, or null when it worked. */
  noteResult(reason: R2LastError): void {
    if (this.lastError === reason) return
    this.lastError = reason
    for (const listener of [...this.listeners]) listener()
  }

  /** Calls `listener` when `lastError` changes; returns the way to stop. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  totals(): R2UsageTotals {
    this.roll()
    return { ...this.current }
  }

  /** Saves now (when the app closes). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.options.save?.(this.totals())
  }

  private saveSoon(): void {
    if (!this.options.save || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.options.save?.(this.totals())
    }, this.options.saveDelayMs ?? DEFAULT_SAVE_DELAY_MS)
    ;(this.timer as { unref?: () => void }).unref?.()
  }

  private roll(): void {
    const month = monthOf(this.now())
    if (month !== this.current.month) this.current = { month, writes: 0, reads: 0 }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}

function whole(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
