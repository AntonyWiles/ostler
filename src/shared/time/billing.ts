import type { TimeEntry } from '../ostler-api/time-types'
import type { CurrencyCode } from '../money'

/**
 * Billable time (N6.4, N47): the one set of rules for the Time report, its
 * CSV and print, Mark as billed and the automation API. A project has one
 * hourly rate in minor units of its currency; an amount is billable hours
 * times the rate, rounded to minor units once, at the end of each total,
 * never per entry. Billed time keeps the rate it was billed at.
 */

/** The highest hourly rate, in minor units: far beyond any real rate. */
export const MAX_HOURLY_RATE = 100_000_000

/** A project's billing settings, beside its budget (N6.3a). */
export interface BillingSettings {
  projectId: string
  /** Minor units of `currency` per hour, or null for no rate. */
  hourlyRate: number | null
  /** Whether new time on this project starts billable. Changing it changes no entry. */
  newTimeBillable: boolean
  /** The project's currency, from its budget settings. */
  currency: CurrencyCode
}

/** A range of a project's time marked as billed, with its totals at that moment. */
export interface Billing {
  id: string
  projectId: string
  /** First and last local day of the range, `YYYY-MM-DD`, inclusive. */
  from: string
  to: string
  /** When it was marked, epoch milliseconds. */
  markedAt: number
  entryCount: number
  billableSeconds: number
  /** The rate when it was marked, or null when the project had none. */
  hourlyRate: number | null
  /** The amount when it was marked, minor units, or null without a rate. */
  amount: number | null
  currency: CurrencyCode
}

/** What Unmark released, so Undo can put it back. */
export interface UnmarkedBilling {
  billing: Billing
  entryIds: string[]
}

export interface TimeReportTotals {
  seconds: number
  billableSeconds: number
  /** Minor units, or null when none of the billable time has a rate. */
  amount: number | null
}

export interface TimeReportTask extends TimeReportTotals {
  workItemId: string
  title: string
  /** The task's entries in the range, in start order. */
  entries: TimeEntry[]
}

export interface TimeReportPart extends TimeReportTotals {
  tasks: TimeReportTask[]
}

/** A project's time between two local days (inclusive), unbilled and billed apart. */
export interface TimeReport {
  projectId: string
  from: string
  to: string
  currency: CurrencyCode
  hourlyRate: number | null
  totals: TimeReportTotals
  unbilled: TimeReportPart
  billed: TimeReportPart
  /** A running timer's entry in the range: shown, never counted or billed until it stops. */
  running: TimeEntry[]
  /** Every billing of the project, newest first. */
  billings: Billing[]
}

/** `seconds` at `rate` per hour, rounded half up to whole minor units. */
export function billableAmount(seconds: number, rate: number): number {
  return roundRated(BigInt(Math.round(seconds)) * BigInt(Math.round(rate)))
}

/** Σ(seconds × rate) to minor units: divided by 3600 and rounded once, half up. */
function roundRated(rated: bigint): number {
  return Number((rated * 2n + 3600n) / 7200n)
}

/** Running totals that round once, at the end. */
class Accumulator {
  seconds = 0
  billableSeconds = 0
  private rated = 0n
  private hasRate = false

  add(entry: TimeEntry, rate: number | null): void {
    const seconds = entry.durationSeconds ?? 0
    this.seconds += seconds
    if (!entry.billable) return
    this.billableSeconds += seconds
    if (rate === null) return
    this.hasRate = true
    this.rated += BigInt(seconds) * BigInt(rate)
  }

  merge(other: Accumulator): void {
    this.seconds += other.seconds
    this.billableSeconds += other.billableSeconds
    this.rated += other.rated
    this.hasRate ||= other.hasRate
  }

  totals(): TimeReportTotals {
    return {
      seconds: this.seconds,
      billableSeconds: this.billableSeconds,
      amount: this.hasRate ? roundRated(this.rated) : null
    }
  }
}

/** The rate an entry is charged at: its billing's, or the project's while unbilled. */
export function entryRate(
  entry: Pick<TimeEntry, 'billingId'>,
  settings: Pick<BillingSettings, 'hourlyRate'>,
  billings: ReadonlyMap<string, Billing>
): number | null {
  if (entry.billingId === null) return settings.hourlyRate
  return billings.get(entry.billingId)?.hourlyRate ?? null
}

/** One entry's amount, for the CSV's rows only: totals never add these up. */
export function entryAmount(
  entry: TimeEntry,
  settings: Pick<BillingSettings, 'hourlyRate'>,
  billings: ReadonlyMap<string, Billing>
): number | null {
  const rate = entryRate(entry, settings, billings)
  if (!entry.billable || rate === null || entry.durationSeconds === null) return null
  return billableAmount(entry.durationSeconds, rate)
}

/**
 * The Time report from a project's entries that started in the range (the
 * caller picks them by local start day, as the Timesheet does). Totals,
 * then a table by task, for unbilled and billed time apart; a running
 * timer is listed on its own.
 */
export function buildTimeReport(input: {
  projectId: string
  from: string
  to: string
  entries: readonly TimeEntry[]
  settings: BillingSettings
  billings: readonly Billing[]
}): TimeReport {
  const billings = new Map(input.billings.map((billing) => [billing.id, billing]))
  const part = (entries: TimeEntry[]): { part: TimeReportPart; sum: Accumulator } => {
    const byTask = new Map<string, { title: string; entries: TimeEntry[]; sum: Accumulator }>()
    const sum = new Accumulator()
    for (const entry of entries) {
      const rate = entryRate(entry, input.settings, billings)
      let task = byTask.get(entry.workItemId)
      if (!task) {
        task = { title: entry.workItemTitle, entries: [], sum: new Accumulator() }
        byTask.set(entry.workItemId, task)
      }
      task.entries.push(entry)
      task.sum.add(entry, rate)
      sum.add(entry, rate)
    }
    const tasks = [...byTask.entries()]
      .map(([workItemId, task]) => ({
        workItemId,
        title: task.title,
        entries: task.entries,
        ...task.sum.totals()
      }))
      .sort((a, b) => a.title.localeCompare(b.title) || a.workItemId.localeCompare(b.workItemId))
    return { part: { ...sum.totals(), tasks }, sum }
  }
  const sorted = [...input.entries].sort((a, b) => a.startedAt - b.startedAt)
  const finished = sorted.filter((entry) => entry.durationSeconds !== null)
  const unbilled = part(finished.filter((entry) => entry.billingId === null))
  const billed = part(finished.filter((entry) => entry.billingId !== null))
  const all = new Accumulator()
  all.merge(unbilled.sum)
  all.merge(billed.sum)
  return {
    projectId: input.projectId,
    from: input.from,
    to: input.to,
    currency: input.settings.currency,
    hourlyRate: input.settings.hourlyRate,
    totals: all.totals(),
    unbilled: unbilled.part,
    billed: billed.part,
    running: sorted.filter((entry) => entry.durationSeconds === null),
    billings: [...input.billings].sort((a, b) => b.markedAt - a.markedAt)
  }
}

/** The local day of the first and last day of the month holding `today`. */
export function thisMonth(today: Date = new Date()): { from: string; to: string } {
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = today.getFullYear()
  const month = today.getMonth()
  const last = new Date(year, month + 1, 0).getDate()
  return {
    from: `${year}-${pad(month + 1)}-01`,
    to: `${year}-${pad(month + 1)}-${pad(last)}`
  }
}
