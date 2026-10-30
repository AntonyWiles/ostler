import { isIsoDate, isoDaysBetween } from '../dates'

/**
 * Baselines (N7.4, N52): a named, dated snapshot of every live task's and
 * milestone's dates, and how today's plan compares with one. A baseline is
 * history: nothing later updates it, and moving a task never changes it.
 */

/** At most this many baselines per project. */
export const MAX_BASELINES = 10
/** A baseline's name is at most this many characters. */
export const MAX_BASELINE_NAME = 80

export type BaselineItemKind = 'task' | 'milestone'

/** A baseline, without its entries. */
export interface Baseline {
  id: string
  projectId: string
  name: string
  /** When it was saved, epoch milliseconds. */
  savedAt: number
  taskCount: number
  milestoneCount: number
}

/** An item's dates as they were when the baseline was saved. A milestone has only `due` (its target date). */
export interface BaselineEntry {
  kind: BaselineItemKind
  itemId: string
  start: string | null
  due: string | null
}

export interface BaselineWithEntries extends Baseline {
  entries: BaselineEntry[]
}

/** What `POST /baselines` and Save a baseline take. */
export interface BaselineCreateInput {
  name: string
  /** At the limit, the baseline to delete to make room for this one. */
  replaceId?: string
}

/** The dates the comparison reads from today's plan. */
export interface PlanItemDates {
  kind: BaselineItemKind
  itemId: string
  start: string | null
  due: string | null
}

/** One item in both the baseline and the plan. */
export interface BaselineItemChange {
  kind: BaselineItemKind
  itemId: string
  baseline: { start: string | null; due: string | null }
  current: { start: string | null; due: string | null }
  /** Calendar days its start moved, positive later; null when either side has none. */
  startDays: number | null
  /** Calendar days its due (or target) date moved, positive later; null when either side has none. */
  dueDays: number | null
}

export interface BaselineComparison {
  baselineId: string
  name: string
  savedAt: number
  /** Items in both, in the baseline's order. */
  changes: BaselineItemChange[]
  /** Items in the plan that the baseline does not have. */
  added: { kind: BaselineItemKind; itemId: string }[]
  /** Items in the baseline that the plan no longer has (deleted, archived or binned). */
  gone: { kind: BaselineItemKind; itemId: string }[]
  /** Tasks only: how many moved later, earlier, stayed, or are new since. */
  summary: { later: number; earlier: number; unchanged: number; added: number }
}

const date = (value: string | null | undefined): string | null =>
  value && isIsoDate(value) ? value : null

const shift = (from: string | null, to: string | null): number | null =>
  from && to ? isoDaysBetween(from, to) : null

/**
 * How far an item moved, in days: its due date's move, or its start's when
 * either side has no due date. Null when nothing can be compared.
 */
export function baselineShift(
  change: Pick<BaselineItemChange, 'startDays' | 'dueDays'>
): number | null {
  return change.dueDays ?? change.startDays
}

/** The plan's dates as a baseline reads them. */
export function planItemDates(
  tasks: readonly { id: string; startDate?: string | null; targetDate: string | null }[],
  milestones: readonly { id: string; targetDate: string | null }[]
): PlanItemDates[] {
  return [
    ...tasks.map((task) => ({
      kind: 'task' as const,
      itemId: task.id,
      start: date(task.startDate),
      due: date(task.targetDate)
    })),
    ...milestones.map((milestone) => ({
      kind: 'milestone' as const,
      itemId: milestone.id,
      start: null,
      due: date(milestone.targetDate)
    }))
  ]
}

/**
 * Compares a baseline with today's plan: each item's move in calendar days
 * (positive later), the items new since, and the ones gone. The one rule the
 * Timeline, the milestone cards and `GET /baselines/:id/compare` share.
 */
export function compareBaseline(
  baseline: Pick<BaselineWithEntries, 'id' | 'name' | 'savedAt' | 'entries'>,
  plan: readonly PlanItemDates[]
): BaselineComparison {
  const key = (kind: BaselineItemKind, id: string) => `${kind}:${id}`
  const current = new Map(plan.map((item) => [key(item.kind, item.itemId), item]))
  const inBaseline = new Set<string>()
  const changes: BaselineItemChange[] = []
  const gone: BaselineComparison['gone'] = []
  for (const entry of baseline.entries) {
    const id = key(entry.kind, entry.itemId)
    inBaseline.add(id)
    const now = current.get(id)
    if (!now) {
      gone.push({ kind: entry.kind, itemId: entry.itemId })
      continue
    }
    const was = { start: date(entry.start), due: date(entry.due) }
    const is = { start: now.start, due: now.due }
    changes.push({
      kind: entry.kind,
      itemId: entry.itemId,
      baseline: was,
      current: is,
      startDays: shift(was.start, is.start),
      dueDays: shift(was.due, is.due)
    })
  }
  const added = plan
    .filter((item) => !inBaseline.has(key(item.kind, item.itemId)))
    .map((item) => ({ kind: item.kind, itemId: item.itemId }))
  const summary = { later: 0, earlier: 0, unchanged: 0, added: 0 }
  for (const change of changes) {
    if (change.kind !== 'task') continue
    const days = baselineShift(change)
    if (days === null || days === 0) summary.unchanged += 1
    else if (days > 0) summary.later += 1
    else summary.earlier += 1
  }
  summary.added = added.filter((item) => item.kind === 'task').length
  return {
    baselineId: baseline.id,
    name: baseline.name,
    savedAt: baseline.savedAt,
    changes,
    added,
    gone,
    summary
  }
}

/** A name as a baseline takes it: trimmed, 1 to 80 characters; null when it is not one. */
export function baselineName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name.length > 0 && name.length <= MAX_BASELINE_NAME ? name : null
}
