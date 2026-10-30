/**
 * Time tracking (R2.3, D33): time entries on tasks, and the one timer that
 * runs across Ostler. A running timer is an entry with no duration yet; its
 * elapsed time is always computed from `startedAt`, never counted in memory.
 */

/** Whether a timer or a person wrote the entry. */
export type TimeEntrySource = 'timer' | 'manual'

export interface TimeEntry {
  id: string
  projectId: string
  workItemId: string
  /** The task's title when the entry was read, for lists across projects. */
  workItemTitle: string
  /** Who the time belongs to (`Person.id`), or null. */
  personId: string | null
  /** When it started, epoch milliseconds. Belongs to the local day it started on. */
  startedAt: number
  /** Whole seconds, or null while the timer is running. */
  durationSeconds: number | null
  note: string
  source: TimeEntrySource
  /** Whether the time is charged for (N6.4, N47). */
  billable: boolean
  /** The billing it was marked billed in, or null. A billed entry is locked. */
  billingId: string | null
  createdAt: number
  updatedAt: number
}

export interface CreateTimeEntryInput {
  workItemId: string
  startedAt: number
  durationSeconds: number
  note?: string
  /** Defaults to Me. */
  personId?: string | null
  /** Defaults to the project's "New time is billable" (N6.4). */
  billable?: boolean
}

export interface UpdateTimeEntryInput {
  startedAt?: number
  durationSeconds?: number
  note?: string
  personId?: string | null
  billable?: boolean
}

/** Entries that started in `[from, to)`, epoch milliseconds, across projects. */
export interface TimeEntryQuery {
  from: number
  to: number
  projectIds?: string[]
  personId?: string | null
}

/**
 * The timer's state. `interrupted` is set when Ostler started and found a
 * timer that was running when it closed (D33): the person keeps it running
 * or stops it at `closedAt`.
 */
export interface TimerState {
  running: TimeEntry | null
  interrupted: { entryId: string; closedAt: number } | null
}

/** What starting a timer did: the new entry, and the one it stopped, if any (for undo). */
export interface TimerStart {
  started: TimeEntry
  stopped: TimeEntry | null
}

/** Logged seconds per task in a project, finished entries only. */
export type TimeTotals = Record<string, number>

/** At most this long for one entry: a week. */
export const MAX_TIME_ENTRY_SECONDS = 7 * 24 * 3600
export const MAX_TIME_NOTE_LENGTH = 500
