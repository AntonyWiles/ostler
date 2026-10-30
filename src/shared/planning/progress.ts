import type {
  FinishedTask,
  HomeProgress,
  ProgressWeek,
  ProgressWeekStart,
  YearFinishedProject,
  YearInReview,
  YearMonth,
  YearProject
} from '../ostler-api/progress-types'
import { PROGRESS_WEEKS, YEAR_TOP_PROJECTS } from '../ostler-api/progress-types'
import { compareIsoDates, isoDaysBetween, isoWeekday, shiftIsoDate, toIsoDate } from '../dates'

/**
 * Progress and your year (N3.6, decision N30), as pure code. Which tasks
 * count is decided once, in SQL (`queryFinishedTasks` in
 * `electron/services/progress-service.ts`); everything here turns that one
 * list into Home's card, Your year and the automation API's numbers, so the
 * three always agree. Weeks start on the person's week start, as the
 * Calendar's do, and every day is a local date.
 */

/** The longest stretch a streak looks back over. */
export const STREAK_LIMIT_DAYS = 366

/** The local date of a time in milliseconds. */
export function localDay(at: number): string {
  return toIsoDate(new Date(at))
}

/** The first day of the week holding `date`, for a week starting on `weekStart`. */
export function weekStartOf(date: string, weekStart: ProgressWeekStart): string {
  return shiftIsoDate(date, -((isoWeekday(date) - weekStart + 7) % 7))
}

/** Whether `value` is a weekday number, 0 (Sunday) to 6. */
export function isProgressWeekStart(value: unknown): value is ProgressWeekStart {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
}

/** Tasks finished in each week from the week of `from` to the week of `to`, the oldest first. */
export function progressWeeks(
  finished: readonly FinishedTask[],
  from: string,
  to: string,
  weekStart: ProgressWeekStart
): ProgressWeek[] {
  const first = weekStartOf(from, weekStart)
  const last = weekStartOf(to, weekStart)
  const weeks: ProgressWeek[] = []
  const index = new Map<string, ProgressWeek>()
  for (let at = first; compareIsoDates(at, last) <= 0; at = shiftIsoDate(at, 7)) {
    const week = { weekStart: at, count: 0 }
    weeks.push(week)
    index.set(at, week)
  }
  for (const task of finished) {
    const day = localDay(task.at)
    if (compareIsoDates(day, from) < 0 || compareIsoDates(day, to) > 0) continue
    const week = index.get(weekStartOf(day, weekStart))
    if (week) week.count++
  }
  return weeks
}

/**
 * Days in a row, back from `today`, with at least one task finished. A day
 * with a finish counts, whatever day it is (a Saturday's finish counts too).
 * A day that is not a working day (a weekend, a day off) with nothing
 * finished is skipped: it neither counts nor breaks the streak. A working day
 * with nothing finished ends it, except today: a today with nothing yet does
 * not break it, the day is not over.
 */
export function workingDayStreak(
  finishedDays: ReadonlySet<string>,
  today: string,
  isWorkingDay: (date: string) => boolean
): number {
  let streak = 0
  for (let back = 0; back < STREAK_LIMIT_DAYS; back++) {
    const date = shiftIsoDate(today, -back)
    if (finishedDays.has(date)) streak++
    else if (back > 0 && isWorkingDay(date)) break
  }
  return streak
}

/** Home's progress card from the finished tasks of the last year or so. */
export function homeProgress(
  finished: readonly FinishedTask[],
  today: string,
  weekStart: ProgressWeekStart,
  isWorkingDay: (date: string) => boolean
): HomeProgress {
  const from = shiftIsoDate(weekStartOf(today, weekStart), -7 * (PROGRESS_WEEKS - 1))
  const weeks = progressWeeks(finished, from, today, weekStart)
  const days = new Set(finished.map((task) => localDay(task.at)))
  return {
    thisWeek: weeks[weeks.length - 1]?.count ?? 0,
    weeks,
    streak: workingDayStreak(days, today, isWorkingDay)
  }
}

/** The first day of the window Home's card reads: the start of the streak's look back. */
export function homeProgressFrom(today: string, weekStart: ProgressWeekStart): string {
  const weeksFrom = shiftIsoDate(weekStartOf(today, weekStart), -7 * (PROGRESS_WEEKS - 1))
  const streakFrom = shiftIsoDate(today, -(STREAK_LIMIT_DAYS - 1))
  return compareIsoDates(weeksFrom, streakFrom) < 0 ? weeksFrom : streakFrom
}

/** What Your year is built from; the service reads it in a few queries. */
export interface YearInput {
  year: number
  years: number[]
  weekStart: ProgressWeekStart
  /** Tasks finished in the year (from the one rule). */
  finished: readonly FinishedTask[]
  /** Milestones completed in the year. */
  milestones: readonly { projectId: string; at: number; approximate: boolean }[]
  projectNames: ReadonlyMap<string, string>
  /** Projects with no open tasks left, with the time their last task was finished. */
  doneProjects: readonly { projectId: string; lastAt: number }[]
  /** Finished time entries that started in the year, or empty. */
  time: readonly { projectId: string; startedAt: number; seconds: number }[]
}

function yearOf(at: number): number {
  return new Date(at).getFullYear()
}

function monthOf(at: number): number {
  return new Date(at).getMonth() + 1
}

/** Your year's numbers. */
export function buildYearInReview(input: YearInput): YearInReview {
  const name = (projectId: string) => input.projectNames.get(projectId) ?? ''
  const finished = input.finished.filter((task) => yearOf(task.at) === input.year)
  const milestones = input.milestones.filter((milestone) => yearOf(milestone.at) === input.year)
  const months: YearMonth[] = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    tasks: 0,
    milestones: 0,
    approximate: false
  }))
  for (const task of finished) months[monthOf(task.at) - 1].tasks++
  for (const milestone of milestones) {
    const month = months[monthOf(milestone.at) - 1]
    month.milestones++
    if (milestone.approximate) month.approximate = true
  }

  // The busiest week: the year's own days only, so a week across New Year counts its part.
  const first = `${String(input.year).padStart(4, '0')}-01-01`
  const last = `${String(input.year).padStart(4, '0')}-12-31`
  let busiestWeek: ProgressWeek | null = null
  for (const week of progressWeeks(finished, first, last, input.weekStart)) {
    if (week.count > 0 && (!busiestWeek || week.count > busiestWeek.count)) busiestWeek = week
  }

  const perProject = new Map<string, number>()
  for (const task of finished)
    perProject.set(task.projectId, (perProject.get(task.projectId) ?? 0) + 1)
  const topProjects: YearProject[] = [...perProject.entries()]
    .map(([projectId, count]) => ({ projectId, projectName: name(projectId), count }))
    .sort((a, b) => b.count - a.count || a.projectName.localeCompare(b.projectName))
    .slice(0, YEAR_TOP_PROJECTS)

  const projectsFinished: YearFinishedProject[] = input.doneProjects
    .filter((project) => yearOf(project.lastAt) === input.year)
    .map((project) => ({
      projectId: project.projectId,
      projectName: name(project.projectId),
      finishedOn: localDay(project.lastAt)
    }))
    .sort((a, b) => compareIsoDates(a.finishedOn, b.finishedOn))

  const entries = input.time.filter((entry) => yearOf(entry.startedAt) === input.year)
  let time: YearInReview['time'] = null
  if (entries.length > 0) {
    const byMonth = Array.from({ length: 12 }, () => 0)
    const byProject = new Map<string, number>()
    for (const entry of entries) {
      byMonth[monthOf(entry.startedAt) - 1] += entry.seconds
      byProject.set(entry.projectId, (byProject.get(entry.projectId) ?? 0) + entry.seconds)
    }
    time = {
      byMonth,
      byProject: [...byProject.entries()]
        .map(([projectId, seconds]) => ({ projectId, projectName: name(projectId), seconds }))
        .sort((a, b) => b.seconds - a.seconds || a.projectName.localeCompare(b.projectName)),
      totalSeconds: byMonth.reduce((sum, seconds) => sum + seconds, 0)
    }
  }

  return {
    year: input.year,
    years: input.years,
    totalTasks: finished.length,
    totalMilestones: milestones.length,
    months,
    busiestWeek,
    projectsFinished,
    topProjects,
    time
  }
}

/** The days from `from` to `to`, inclusive; 0 when `to` is before `from`. */
export function daysSpanned(from: string, to: string): number {
  return compareIsoDates(from, to) > 0 ? 0 : isoDaysBetween(from, to) + 1
}
