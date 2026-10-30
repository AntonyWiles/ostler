import type Database from 'better-sqlite3'
import type {
  FinishedTask,
  HomeProgress,
  HomeProgressQuery,
  Person,
  ProgressWeek,
  ProgressWeekStart,
  WatchedProject,
  YearInReview,
  YearInReviewQuery
} from '@shared/ostler-api'
import { isIsoDate, parseIsoDate, shiftIsoDate } from '@shared/dates'
import { Refusal } from '@shared/refusal'
import {
  buildYearInReview,
  daysSpanned,
  homeProgress,
  homeProgressFrom,
  isProgressWeekStart,
  progressWeeks
} from '@shared/planning/progress'
import { isOwnWorkingDay, myWorkingDays, type DayOffSpan } from '@shared/planning/working-days'
import type { TimeTracking } from './time-tracking'

/** The longest span `/progress` answers for, in days (about ten years). */
export const MAX_PROGRESS_DAYS = 3660

const EARLIEST_YEAR = 1970
const LATEST_YEAR = 9999

function placeholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ')
}

/** Local midnight at the start of `date`, in milliseconds. */
function startOfDay(date: string): number {
  return parseIsoDate(date)!.getTime()
}

/**
 * What counts as finished (N3.6, decision N30): the one rule. A task counts
 * at its latest move to Done, if it is still Done, assigned to Me or to
 * nobody, in one of `projectIds`, and not deleted or in the bin; an archived
 * task counts. A reopened task no longer counts, and a task finished again
 * counts once, at its last finish. Only moves in `[from, to)` (milliseconds)
 * are returned. Home's card, Your year and the automation API all read here.
 */
export function queryFinishedTasks(
  db: Database.Database,
  projectIds: readonly string[],
  meId: string | null,
  from: number,
  to: number
): FinishedTask[] {
  if (projectIds.length === 0 || to <= from) return []
  return db
    .prepare(
      `SELECT item.id AS taskId, item.project_id AS projectId, MAX(history.at) AS at
       FROM planning_work_items item
       JOIN planning_status_history history ON history.work_item_id = item.id
       WHERE item.project_id IN (${placeholders(projectIds)})
         AND item.deleted_at IS NULL AND item.status = 'done'
         AND (item.assignee_id IS NULL OR item.assignee_id = ?)
         AND history.to_status = 'done'
       GROUP BY item.id
       HAVING MAX(history.at) >= ? AND MAX(history.at) < ?
       ORDER BY at`
    )
    .all(...projectIds, meId ?? '', from, to) as FinishedTask[]
}

/**
 * Your year's time tracked (R2.3): finished entries by Me or by no one, as
 * for tasks; a running timer is not counted.
 */
export function trackedTime(
  time: Pick<TimeTracking, 'list'>,
  meId: () => string | null
): ProgressServiceDependencies['getTimeEntries'] {
  return (projectIds, from, to) => {
    const me = meId()
    return time
      .list({ from, to, projectIds: [...projectIds] }, projectIds)
      .filter(
        (entry) =>
          entry.durationSeconds !== null && (entry.personId === null || entry.personId === me)
      )
      .map((entry) => ({
        projectId: entry.projectId,
        startedAt: entry.startedAt,
        seconds: entry.durationSeconds!
      }))
  }
}

export interface ProgressServiceDependencies {
  db: Database.Database
  /** Every project; the service keeps the enabled ones. */
  getProjects(): WatchedProject[]
  getMe(): Person | null
  getDaysOff(): readonly DayOffSpan[]
  /** Finished time entries that started in `[from, to)` across `projectIds` (R2.3). */
  getTimeEntries(
    projectIds: readonly string[],
    from: number,
    to: number
  ): { projectId: string; startedAt: number; seconds: number }[]
  /** The time now, in milliseconds; the computer's clock by default. */
  now?(): number
}

/**
 * Progress and your year (N3.6): Home's progress card, Your year and the
 * automation API's `/progress` and `/year-in-review`, from the one rule
 * (`queryFinishedTasks`) and the pure code in `@shared/planning/progress`.
 * Read only. Home's card is one query; Your year a few, on its own page.
 */
export class ProgressService {
  constructor(private readonly deps: ProgressServiceDependencies) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private enabledIds(only?: readonly string[]): string[] {
    return this.deps
      .getProjects()
      .filter((project) => project.enabled && (!only || only.includes(project.id)))
      .map((project) => project.id)
  }

  private meId(): string | null {
    return this.deps.getMe()?.id ?? null
  }

  private weekStart(value: unknown): ProgressWeekStart {
    if (value === undefined) return 1
    if (!isProgressWeekStart(value))
      throw new Refusal('weekStart must be a weekday number, 0 (Sunday) to 6 (Saturday)')
    return value
  }

  /** Home's card: this week, eight weeks and the streak, in one query. */
  home(query: HomeProgressQuery): HomeProgress {
    if (!isIsoDate(query?.today)) throw new Refusal('today must use YYYY-MM-DD')
    const weekStart = this.weekStart(query.weekStart)
    const me = this.deps.getMe()
    const from = homeProgressFrom(query.today, weekStart)
    const finished = queryFinishedTasks(
      this.deps.db,
      this.enabledIds(),
      me?.id ?? null,
      startOfDay(from),
      startOfDay(shiftIsoDate(query.today, 1))
    )
    // The streak is Me's own: Me's working days and days off, and everyone's.
    const mine = myWorkingDays(me, this.deps.getDaysOff())
    return homeProgress(finished, query.today, weekStart, (date) => isOwnWorkingDay(date, mine))
  }

  /** `/progress`: tasks finished per week in one project, local days `from` to `to`. */
  weeks(projectId: string, from: unknown, to: unknown, weekStart?: unknown): ProgressWeek[] {
    if (!isIsoDate(from) || !isIsoDate(to))
      throw new Refusal('from and to must use YYYY-MM-DD, such as ?from=2026-01-01&to=2026-03-31')
    const span = daysSpanned(from, to)
    if (span === 0) throw new Refusal('to must not be before from')
    if (span > MAX_PROGRESS_DAYS) throw new Refusal('Ask for at most ten years at a time')
    const finished = queryFinishedTasks(
      this.deps.db,
      this.enabledIds([projectId]),
      this.meId(),
      startOfDay(from),
      startOfDay(shiftIsoDate(to, 1))
    )
    return progressWeeks(finished, from, to, this.weekStart(weekStart))
  }

  /** Your year, across the enabled projects, or only `projectIds` (the automation API's one). */
  year(query: YearInReviewQuery, projectIds?: readonly string[]): YearInReview {
    const year = query?.year
    if (!Number.isInteger(year) || year < EARLIEST_YEAR || year > LATEST_YEAR)
      throw new Refusal('year must be a year such as 2026')
    const weekStart = this.weekStart(query.weekStart)
    const ids = this.enabledIds(projectIds)
    const db = this.deps.db
    const from = new Date(year, 0, 1).getTime()
    const to = new Date(year + 1, 0, 1).getTime()
    const meId = this.meId()
    const finished = queryFinishedTasks(db, ids, meId, from, to)
    const scope = ids.length === 0 ? 'IN (NULL)' : `IN (${placeholders(ids)})`
    const milestones = (
      db
        .prepare(
          `SELECT project_id AS projectId, completed_at AS at, completed_approx AS approximate
           FROM planning_milestones
           WHERE project_id ${scope} AND status = 'complete'
             AND completed_at >= ? AND completed_at < ?`
        )
        .all(...ids, from, to) as { projectId: string; at: number; approximate: number }[]
    ).map((row) => ({ ...row, approximate: row.approximate === 1 }))
    // Finished projects: every task done (or archived, or in the bin), at
    // least one done, and the last of them finished this year.
    const doneProjects = db
      .prepare(
        `SELECT item.project_id AS projectId, MAX(history.at) AS lastAt
         FROM planning_work_items item
         JOIN planning_status_history history
           ON history.work_item_id = item.id AND history.to_status = 'done'
         WHERE item.project_id ${scope} AND item.deleted_at IS NULL AND item.status = 'done'
           AND NOT EXISTS (SELECT 1 FROM planning_work_items open
             WHERE open.project_id = item.project_id AND open.status <> 'done'
               AND open.deleted_at IS NULL AND open.archived_at IS NULL)
         GROUP BY item.project_id
         HAVING MAX(history.at) >= ? AND MAX(history.at) < ?`
      )
      .all(...ids, from, to) as { projectId: string; lastAt: number }[]
    const years = this.years(ids, meId)
    const projectNames = new Map(
      this.deps.getProjects().map((project) => [project.id, project.name])
    )
    return buildYearInReview({
      year,
      years,
      weekStart,
      finished,
      milestones,
      projectNames,
      doneProjects,
      time: ids.length === 0 ? [] : this.deps.getTimeEntries(ids, from, to)
    })
  }

  /** This year and every year with a finished task, the newest first. */
  private years(ids: readonly string[], meId: string | null): number[] {
    const thisYear = new Date(this.now()).getFullYear()
    const years = new Set<number>([thisYear])
    for (const task of queryFinishedTasks(this.deps.db, ids, meId, 0, this.now() + 1))
      years.add(new Date(task.at).getFullYear())
    return [...years].sort((a, b) => b - a)
  }
}
