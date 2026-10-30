// ─── Days off (N3.2, decision N25) ──────────────────────────────────────────

/**
 * A day or a run of days nobody works (a bank holiday, `personId` null) or
 * one person is away (leave). Dates are local calendar dates, never instants.
 * Days off are shared by every project, as people are.
 */
export interface DayOff {
  id: string
  /** The person who is away, or null for everyone. */
  personId: string | null
  /** `YYYY-MM-DD`; a single day has the same first and last date. */
  firstDate: string
  lastDate: string
  /** "Christmas Day", "Leave". */
  name: string
  /** The calendar file it was imported from, by name, or null when added by hand. */
  sourceFile: string | null
  createdAt: number
  updatedAt: number
}

export interface CreateDayOffInput {
  personId?: string | null
  firstDate: string
  /** Leave out for a single day. */
  lastDate?: string
  name: string
}

export interface UpdateDayOffInput {
  personId?: string | null
  firstDate?: string
  lastDate?: string
  name?: string
}

/** Which days off to list: those overlapping `from` to `to`, for everyone and this person. */
export interface DaysOffQuery {
  from?: string
  to?: string
  /** Everyone's days off and this person's; leave out for all of them. */
  personId?: string
}

/** The range of other people's shared away days to read: those touching `from` to `through`. */
export interface SharedAwayQuery {
  from: string
  through: string
}

/** Dates a person has chosen to share as away with a project (never the day-off name). */
export interface SharedAwaySpan {
  personId: string
  firstDate: string
  lastDate: string
}

/** A holiday calendar file to read into days off. */
export interface DaysOffImportInput {
  /** The file's name, which the days remember so loading it again replaces them. */
  fileName: string
  /** The file's text (iCalendar). Untrusted data. */
  text: string
  /** The person the days are for, or null (left out) for everyone. */
  personId?: string | null
}

/** An event the import leaves out, and why. */
export interface DaysOffImportSkipped {
  name: string
  reason: 'timed' | 'repeat' | 'no-date'
}

/** What an import would do (or did). */
export interface DaysOffImportPreview {
  fileName: string
  personId: string | null
  /** The days off it adds, in date order. */
  days: Pick<DayOff, 'firstDate' | 'lastDate' | 'name'>[]
  /** How many days off from an earlier load of the same file it replaces. */
  replacedCount: number
  skipped: DaysOffImportSkipped[]
}

/** What an import did: the preview, the days off it added and the ones it replaced (for the undo). */
export interface DaysOffImportResult extends DaysOffImportPreview {
  added: DayOff[]
  replaced: DayOff[]
}

/** A file chosen in the open dialog: its name and text, read in main after a size check. */
export interface DaysOffFile {
  fileName: string
  text: string
}

/** The longest run one day off may cover, in days. */
export const MAX_DAY_OFF_SPAN_DAYS = 366
/** The longest name a day off may have. */
export const MAX_DAY_OFF_NAME = 80
