import type { TimeEntry } from '../ostler-api/time-types'
import { addDays, parseIsoDate, toIsoDate } from '../dates'

/**
 * Timesheet arithmetic (R2.3, D35), shared by the Timesheet view, its CSV
 * export and the reports. An entry belongs to the local day it started on;
 * days and weeks are built from local dates (`dates.ts`), never by slicing
 * ISO strings in UTC, so a daylight-saving change or midnight cannot move an
 * entry to another day.
 */

/** An entry's length so far: its duration, or the time since a running timer started. */
export function entrySeconds(
  entry: Pick<TimeEntry, 'startedAt' | 'durationSeconds'>,
  now: number
): number {
  if (entry.durationSeconds !== null) return entry.durationSeconds
  return Math.max(0, Math.floor((now - entry.startedAt) / 1000))
}

/** The local day (`YYYY-MM-DD`) an entry belongs to: the day it started. */
export function entryDay(entry: Pick<TimeEntry, 'startedAt'>): string {
  return toIsoDate(new Date(entry.startedAt))
}

/** The first day (`YYYY-MM-DD`) of the week holding `date`; weeks start on Monday by default. */
export function weekStart(date: Date, firstDay = 1): string {
  const offset = (date.getDay() - firstDay + 7) % 7
  return toIsoDate(addDays(date, -offset))
}

/** The seven days of the week starting on `start`. */
export function weekDays(start: string): string[] {
  const first = parseIsoDate(start) ?? new Date()
  return Array.from({ length: 7 }, (_, index) => toIsoDate(addDays(first, index)))
}

/** `[from, to)` in epoch milliseconds for local days `first` to `last`, inclusive. */
export function dayRange(first: string, last: string): { from: number; to: number } {
  const from = parseIsoDate(first) ?? new Date()
  const end = parseIsoDate(last) ?? from
  return { from: from.getTime(), to: addDays(end, 1).getTime() }
}

export interface TimesheetTotals {
  total: number
  byDay: Record<string, number>
  byProject: Record<string, number>
  byTask: Record<string, number>
  /** Keyed by person id, `''` for nobody. */
  byPerson: Record<string, number>
}

/** Seconds by local day, project, task and person. */
export function timesheetTotals(entries: readonly TimeEntry[], now: number): TimesheetTotals {
  const totals: TimesheetTotals = { total: 0, byDay: {}, byProject: {}, byTask: {}, byPerson: {} }
  const add = (map: Record<string, number>, key: string, seconds: number) => {
    map[key] = (map[key] ?? 0) + seconds
  }
  for (const entry of entries) {
    const seconds = entrySeconds(entry, now)
    totals.total += seconds
    add(totals.byDay, entryDay(entry), seconds)
    add(totals.byProject, entry.projectId, seconds)
    add(totals.byTask, entry.workItemId, seconds)
    add(totals.byPerson, entry.personId ?? '', seconds)
  }
  return totals
}

/** Entries grouped by local day, each day's entries in start order. */
export function entriesByDay(entries: readonly TimeEntry[]): Map<string, TimeEntry[]> {
  const days = new Map<string, TimeEntry[]>()
  for (const entry of [...entries].sort((a, b) => a.startedAt - b.startedAt)) {
    const day = entryDay(entry)
    days.set(day, [...(days.get(day) ?? []), entry])
  }
  return days
}
