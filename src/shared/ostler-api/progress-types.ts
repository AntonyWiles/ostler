/**
 * Progress and your year (N3.6, decision N30): what the person finished,
 * read from status history. Nothing here is a score: counts of tasks and
 * milestones finished, and days in a row with something finished.
 */

/** Weekday numbers as the Calendar uses them: 0 is Sunday, 6 is Saturday. */
export type ProgressWeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** One task that counts as finished, at its latest move to Done. */
export interface FinishedTask {
  taskId: string
  projectId: string
  /** The latest move to Done, in milliseconds. */
  at: number
}

/** Tasks finished in the week starting on `weekStart` (a local date, `YYYY-MM-DD`). */
export interface ProgressWeek {
  weekStart: string
  count: number
}

/** Home's progress card (N3.6): this week, eight weeks of bars, and the streak. */
export interface HomeProgress {
  /** Tasks finished this week (the last of `weeks`). */
  thisWeek: number
  /** The last eight weeks, the oldest first; the last is this week. */
  weeks: ProgressWeek[]
  /**
   * Days in a row, back from today, with at least one task finished. A day
   * with a finish counts whatever day it is; a day that is not one of Me's
   * working days (a weekend, Me's or everyone's day off) with nothing
   * finished is skipped; a working day with nothing
   * finished ends it, except today, which does not break it before it ends.
   */
  streak: number
}

/** The query Home's card asks with: the renderer's local date and week start. */
export interface HomeProgressQuery {
  today: string
  weekStart: ProgressWeekStart
}

/** One month of Your year: `month` is 1 to 12. */
export interface YearMonth {
  month: number
  tasks: number
  milestones: number
  /** Some milestone's completion time this month is a guess (it was complete before Ostler kept one). */
  approximate: boolean
}

export interface YearProject {
  projectId: string
  projectName: string
  /** Tasks finished in the year. */
  count: number
}

/** A project with no open tasks left whose last task was finished in the year. */
export interface YearFinishedProject {
  projectId: string
  projectName: string
  /** The local date its last task was finished, `YYYY-MM-DD`. */
  finishedOn: string
}

export interface YearTime {
  /** Seconds tracked in each month, January first (twelve numbers). */
  byMonth: number[]
  /** Seconds tracked per project, the most first. */
  byProject: { projectId: string; projectName: string; seconds: number }[]
  totalSeconds: number
}

/** Your year (N3.6): a calendar year of finished work. */
export interface YearInReview {
  year: number
  /** Years with finished work (and this year), the newest first: the years the page offers. */
  years: number[]
  totalTasks: number
  totalMilestones: number
  /** January to December. */
  months: YearMonth[]
  /** The week with the most tasks finished, or null when none were. */
  busiestWeek: ProgressWeek | null
  projectsFinished: YearFinishedProject[]
  /** The projects with the most tasks finished, at most five, the most first. */
  topProjects: YearProject[]
  /** Time tracked (R2.3), or null when no time was tracked that year. */
  time: YearTime | null
}

export interface YearInReviewQuery {
  year: number
  weekStart: ProgressWeekStart
}

/** Print or save Your year (N3.6). */
export interface YearInReviewPrintRequest {
  year: number
  weekStart: ProgressWeekStart
  output: 'pdf' | 'printer'
}

/** Most projects Your year lists among those with the most finished. */
export const YEAR_TOP_PROJECTS = 5

/** Weeks of bars on Home's progress card. */
export const PROGRESS_WEEKS = 8
