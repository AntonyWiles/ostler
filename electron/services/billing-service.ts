import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { isIsoDate } from '@shared/dates'
import { t } from '@shared/i18n'
import { Refusal } from '@shared/refusal'
import { isCurrencyCode, type CurrencyCode } from '@shared/money'
import { dayRange } from '@shared/time/timesheet'
import {
  billableAmount,
  buildTimeReport,
  MAX_HOURLY_RATE,
  type Billing,
  type BillingSettings,
  type TimeReport,
  type UnmarkedBilling
} from '@shared/time/billing'
import type { TimeTracking } from './time-tracking'

interface BillingRow {
  id: string
  project_id: string
  from_date: string
  to_date: string
  marked_at: number
  entry_count: number
  billable_seconds: number
  hourly_rate: number | null
  amount: number | null
  currency: string
}

export interface BillingDependencies {
  getProjectIds(): string[]
  /** The project's currency, from its budget settings (N6.3a). */
  currency(projectId: string): CurrencyCode
  time: TimeTracking
  /** Called after a setting or billing changed. */
  changed(projectId: string): void
  now?: () => number
}

/** A billing as the project file carries it: its entries are named by the caller. */
export type StoredBilling = Omit<Billing, 'id' | 'projectId'>

/**
 * Billable time (N6.4, N47): a project's hourly rate and "New time is
 * billable", the Time report, and billings. The desktop app and the
 * automation API both come through here, on the planning connection, so the
 * report, its CSV and print, and Mark as billed all count the same way
 * (`@shared/time/billing`). Locking billed entries is the time tracker's
 * (`TimeTracking.refuseBilled`), which every edit and delete passes.
 */
export class BillingService {
  private readonly now: () => number

  constructor(
    private readonly db: Database.Database,
    private readonly deps: BillingDependencies
  ) {
    this.now = deps.now ?? Date.now
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  getSettings(projectId: string): BillingSettings {
    this.requireProject(projectId)
    const row = this.db
      .prepare('SELECT hourly_rate, new_time_billable FROM project_budgets WHERE project_id = ?')
      .get(projectId) as { hourly_rate: number | null; new_time_billable: number } | undefined
    return {
      projectId,
      hourlyRate: row?.hourly_rate ?? null,
      newTimeBillable: row?.new_time_billable === 1,
      currency: this.deps.currency(projectId)
    }
  }

  /**
   * Sets the hourly rate (null for none) and whether new time is billable; a
   * field left out keeps its value. Existing entries never change with it.
   */
  setSettings(projectId: string, input: unknown): BillingSettings {
    const current = this.getSettings(projectId)
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Refusal(t('errors:billing.settingsInvalid'))
    const value = input as Record<string, unknown>
    for (const key of Object.keys(value)) {
      if (key !== 'hourlyRate' && key !== 'newTimeBillable')
        throw new Refusal(t('errors:billing.settingsInvalid'))
    }
    const hourlyRate =
      value.hourlyRate === undefined ? current.hourlyRate : rateOf(value.hourlyRate)
    let newTimeBillable = current.newTimeBillable
    if (value.newTimeBillable !== undefined) {
      if (typeof value.newTimeBillable !== 'boolean')
        throw new Refusal(t('errors:billing.settingsInvalid'))
      newTimeBillable = value.newTimeBillable
    }
    this.writeSettings(projectId, current.currency, hourlyRate, newTimeBillable)
    this.deps.changed(projectId)
    return this.getSettings(projectId)
  }

  // ─── The report ───────────────────────────────────────────────────────────

  /** The project's time on local days `from` to `to`, inclusive, by the day each entry started. */
  report(projectId: string, from: unknown, to: unknown): TimeReport {
    const range = rangeOf(from, to)
    const settings = this.getSettings(projectId)
    const entries = this.deps.time.list(
      { ...dayRange(range.from, range.to), projectIds: [projectId] },
      [projectId]
    )
    return buildTimeReport({
      projectId,
      ...range,
      entries,
      settings,
      billings: this.listBillings(projectId)
    })
  }

  // ─── Billings ─────────────────────────────────────────────────────────────

  /** The project's billings, newest first. */
  listBillings(projectId: string): Billing[] {
    this.requireProject(projectId)
    return (
      this.db
        .prepare('SELECT * FROM billings WHERE project_id = ? ORDER BY marked_at DESC, rowid DESC')
        .all(projectId) as BillingRow[]
    ).map(toBilling)
  }

  getBilling(projectId: string, billingId: unknown): Billing {
    this.requireProject(projectId)
    if (typeof billingId !== 'string') throw new Refusal(t('errors:billing.billingNotFound'))
    const row = this.db
      .prepare('SELECT * FROM billings WHERE id = ? AND project_id = ?')
      .get(billingId, projectId) as BillingRow | undefined
    if (!row) throw new Refusal(t('errors:billing.billingNotFound'))
    return toBilling(row)
  }

  /**
   * Mark as billed: the range's finished, billable, unbilled entries join a
   * new billing, which keeps their hours and amount at today's rate. A
   * running timer is not billed until it stops.
   */
  markBilled(projectId: string, input: unknown): Billing {
    const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    const range = rangeOf(body.from, body.to)
    const settings = this.getSettings(projectId)
    const { from, to } = dayRange(range.from, range.to)
    const billing = this.db.transaction((): Billing => {
      const entries = this.db
        .prepare(
          `SELECT id, duration_seconds FROM planning_time_entries
           WHERE project_id = ? AND started_at >= ? AND started_at < ? AND billable = 1
             AND billing_id IS NULL AND duration_seconds IS NOT NULL`
        )
        .all(projectId, from, to) as Array<{ id: string; duration_seconds: number }>
      if (entries.length === 0) throw new Refusal(t('errors:billing.nothingToBill'))
      const seconds = entries.reduce((sum, entry) => sum + entry.duration_seconds, 0)
      const made: Billing = {
        id: uuidv4(),
        projectId,
        from: range.from,
        to: range.to,
        markedAt: this.now(),
        entryCount: entries.length,
        billableSeconds: seconds,
        hourlyRate: settings.hourlyRate,
        amount: settings.hourlyRate === null ? null : billableAmount(seconds, settings.hourlyRate),
        currency: settings.currency
      }
      this.insert(made)
      const join = this.db.prepare('UPDATE planning_time_entries SET billing_id = ? WHERE id = ?')
      for (const entry of entries) join.run(made.id, entry.id)
      return made
    })()
    this.deps.time.billingChanged(projectId)
    return billing
  }

  /** Unmark: the billing goes and its entries are unlocked. The result is what `restore` puts back. */
  unmark(projectId: string, billingId: unknown): UnmarkedBilling {
    const billing = this.getBilling(projectId, billingId)
    const entryIds = this.db.transaction((): string[] => {
      const ids = (
        this.db
          .prepare('SELECT id FROM planning_time_entries WHERE billing_id = ? ORDER BY started_at')
          .all(billing.id) as Array<{ id: string }>
      ).map((row) => row.id)
      this.db
        .prepare('UPDATE planning_time_entries SET billing_id = NULL WHERE billing_id = ?')
        .run(billing.id)
      this.db.prepare('DELETE FROM billings WHERE id = ?').run(billing.id)
      return ids
    })()
    this.deps.time.billingChanged(projectId)
    return { billing, entryIds }
  }

  /** Undoes `unmark`: the same billing, with its kept totals, and those of its entries still unbilled. */
  restore(projectId: string, input: unknown): Billing {
    this.requireProject(projectId)
    const value = (input && typeof input === 'object' ? input : {}) as Partial<UnmarkedBilling>
    const billing = storedOf(value.billing, 'billing')
    if (typeof value.billing?.id !== 'string' || !Array.isArray(value.entryIds))
      throw new Refusal(t('errors:billing.billingNotFound'))
    const id = value.billing.id
    const existing = this.db.prepare('SELECT 1 FROM billings WHERE id = ?').get(id)
    if (existing) return this.getBilling(projectId, id)
    this.db.transaction(() => {
      this.insert({ ...billing, id, projectId })
      const join = this.db.prepare(
        `UPDATE planning_time_entries SET billing_id = ? WHERE id = ? AND project_id = ?
           AND billing_id IS NULL AND billable = 1 AND duration_seconds IS NOT NULL`
      )
      for (const entryId of value.entryIds!) {
        if (typeof entryId === 'string') join.run(id, entryId, projectId)
      }
    })()
    this.deps.time.billingChanged(projectId)
    return this.getBilling(projectId, id)
  }

  // ─── The project file ─────────────────────────────────────────────────────

  /** Writes the rate and default read from a project file or template. */
  importSettings(
    projectId: string,
    settings: { hourlyRate: number | null; newTimeBillable: boolean }
  ): void {
    this.writeSettings(
      projectId,
      this.deps.currency(projectId),
      rateOf(settings.hourlyRate),
      settings.newTimeBillable === true
    )
  }

  /** Writes billings read from a project file; returns their new ids, in order. */
  importBillings(projectId: string, billings: readonly StoredBilling[]): string[] {
    return this.db.transaction(() =>
      billings.map((billing) => {
        const id = uuidv4()
        this.insert({ ...storedOf(billing, 'billing'), id, projectId })
        return id
      })
    )()
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private writeSettings(
    projectId: string,
    currency: CurrencyCode,
    hourlyRate: number | null,
    newTimeBillable: boolean
  ): void {
    this.db
      .prepare(
        `INSERT INTO project_budgets (project_id, amount, currency, updated_at, hourly_rate,
           new_time_billable) VALUES (?, NULL, ?, ?, ?, ?)
         ON CONFLICT(project_id) DO UPDATE SET hourly_rate = excluded.hourly_rate,
           new_time_billable = excluded.new_time_billable, updated_at = excluded.updated_at`
      )
      .run(projectId, currency, this.now(), hourlyRate, newTimeBillable ? 1 : 0)
  }

  private insert(billing: Billing): void {
    this.db
      .prepare(
        `INSERT INTO billings (id, project_id, from_date, to_date, marked_at, entry_count,
           billable_seconds, hourly_rate, amount, currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        billing.id,
        billing.projectId,
        billing.from,
        billing.to,
        billing.markedAt,
        billing.entryCount,
        billing.billableSeconds,
        billing.hourlyRate,
        billing.amount,
        billing.currency
      )
  }

  private requireProject(projectId: string): void {
    if (typeof projectId !== 'string' || !this.deps.getProjectIds().includes(projectId))
      throw new Refusal('Project not found')
  }
}

/** An hourly rate: whole minor units from 0 to the limit, or null. */
function rateOf(value: unknown): number | null {
  if (value === null) return null
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_HOURLY_RATE
  )
    throw new Refusal(t('errors:billing.rateInvalid'))
  return value
}

/** Two local days, `YYYY-MM-DD`, the first on or before the second. */
function rangeOf(from: unknown, to: unknown): { from: string; to: string } {
  if (!isIsoDate(from) || !isIsoDate(to) || to < from)
    throw new Refusal(t('errors:billing.rangeInvalid'))
  return { from, to }
}

/** A billing's fields, checked: from undo or a project file. */
function storedOf(value: unknown, what: string): StoredBilling {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const whole = (field: unknown) =>
    typeof field === 'number' && Number.isSafeInteger(field) && field >= 0
  const range = rangeOf(input.from, input.to)
  if (
    !whole(input.markedAt) ||
    !whole(input.entryCount) ||
    !whole(input.billableSeconds) ||
    !(input.amount === null || whole(input.amount)) ||
    !isCurrencyCode(input.currency)
  )
    throw new Refusal(`That ${what} is not valid`)
  return {
    ...range,
    markedAt: input.markedAt as number,
    entryCount: input.entryCount as number,
    billableSeconds: input.billableSeconds as number,
    hourlyRate: rateOf(input.hourlyRate ?? null),
    amount: input.amount as number | null,
    currency: input.currency as string
  }
}

function toBilling(row: BillingRow): Billing {
  return {
    id: row.id,
    projectId: row.project_id,
    from: row.from_date,
    to: row.to_date,
    markedAt: row.marked_at,
    entryCount: row.entry_count,
    billableSeconds: row.billable_seconds,
    hourlyRate: row.hourly_rate,
    amount: row.amount,
    currency: row.currency
  }
}
