import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  ReportAtRisk,
  WatchedProject,
  WeeklyReview,
  WeeklyReviewDay,
  WeeklyReviewMilestone,
  WeeklyReviewRecord,
  WeeklyReviewStepCounts,
  WeeklyReviewStepId,
  WeeklyReviewTask
} from '@shared/ostler-api'
import { WEEKLY_REVIEW_STEPS } from '@shared/ostler-api'
import { isIsoDate, shiftIsoDate } from '@shared/dates'
import { matchesFilter, type TaskFilter } from '@shared/task-filter'
import {
  REVIEW_BLOCKED_DAYS,
  REVIEW_STALE_DAYS,
  REVIEW_UPCOMING_DAYS,
  weeklyReviewFilters
} from '@shared/planning/weekly-review'
import { filterable, homeTaskColumns, toHomeTask, type HomeTaskRow } from './home-task-row'

const DAY_MS = 86_400_000

export interface WeeklyReviewServiceDependencies {
  db: Database.Database
  /** Every project; the service keeps the enabled ones, as Home does. */
  getProjects(): WatchedProject[]
  getMeId(): string | null
  /** How many items wait in the Inbox. */
  inboxCount(): number
  /** A project's at-risk section from its report (`ReportService`), or null. */
  atRisk(project: WatchedProject): ReportAtRisk | null
  now?: () => number
}

type ReviewRow = HomeTaskRow & { since: number }

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(', ')
}

/** Open, live work in the enabled projects: what every step's SQL starts from. */
// A task in To triage (N4.3a) is in no step until it is accepted.
const LIVE = `item.archived_at IS NULL AND item.deleted_at IS NULL AND item.status <> 'done'
  AND item.in_triage = 0`

/**
 * The weekly review (N1.5, N13): each step's list across the enabled
 * projects in one query per step, narrowed by SQL and decided by the step's
 * filter (`weeklyReviewFilters`), and the finished reviews.
 */
export class WeeklyReviewService {
  private readonly now: () => number

  constructor(private readonly deps: WeeklyReviewServiceDependencies) {
    this.now = deps.now ?? Date.now
  }

  private enabledProjects(): WatchedProject[] {
    return this.deps.getProjects().filter((project) => project.enabled)
  }

  /** Every step's list. `today` is the renderer's local date, as Home's. */
  getReview({ today }: { today: string }): WeeklyReview {
    if (!isIsoDate(today)) throw new Error('today must use YYYY-MM-DD')
    const projects = this.enabledProjects()
    return {
      today,
      inboxCount: this.deps.inboxCount(),
      overdue: this.overdue(projects, today),
      blocked: this.blocked(projects, today),
      stale: this.stale(projects, today),
      someday: this.someday(projects, today),
      upcoming: this.upcoming(projects, today),
      milestones: this.milestonesAtRisk(projects)
    }
  }

  /** Runs one step's query and keeps the rows its filter matches. */
  private select(
    projects: WatchedProject[],
    today: string,
    filter: TaskFilter,
    since: string,
    where: string,
    params: unknown[],
    order: string
  ): WeeklyReviewTask[] {
    if (projects.length === 0) return []
    const byId = new Map(projects.map((project) => [project.id, project]))
    const context = { today, meId: this.deps.getMeId() }
    const rows = this.deps.db
      .prepare(
        `SELECT ${homeTaskColumns('item')}, ${since} AS since
         FROM planning_work_items item
         WHERE item.project_id IN (${placeholders(projects)})
           AND ${LIVE} AND ${where}
         ORDER BY ${order}`
      )
      .all(...projects.map((project) => project.id), ...params) as ReviewRow[]
    return rows
      .filter((row) => matchesFilter(filterable(row), filter, context))
      .map((row) => ({ ...toHomeTask(row, byId.get(row.project_id)!), since: row.since }))
  }

  /** Overdue, assigned to Me or nobody, the oldest due date first. */
  overdue(projects: WatchedProject[], today: string): WeeklyReviewTask[] {
    return this.select(
      projects,
      today,
      weeklyReviewFilters(today).overdue,
      'item.updated_at',
      'item.target_date IS NOT NULL AND item.target_date < ? AND item.someday = 0',
      [today],
      'item.target_date, item.title'
    )
  }

  /**
   * Blocked for more than three days, the longest first. A task's wait runs
   * from its last move to Blocked; one with no such move from when it was made.
   */
  blocked(projects: WatchedProject[], today: string): WeeklyReviewTask[] {
    const since = `COALESCE((SELECT MAX(history.at) FROM planning_status_history history
      WHERE history.work_item_id = item.id AND history.to_status = 'blocked'), item.created_at)`
    return this.select(
      projects,
      today,
      weeklyReviewFilters(today).blocked,
      since,
      `item.status = 'blocked' AND ${since} < ?`,
      [this.now() - REVIEW_BLOCKED_DAYS * DAY_MS],
      'since, item.title'
    )
  }

  /** Open tasks not updated for two weeks, the oldest first; Someday and hidden ones are left out. */
  stale(projects: WatchedProject[], today: string): WeeklyReviewTask[] {
    return this.select(
      projects,
      today,
      weeklyReviewFilters(today).stale,
      'item.updated_at',
      'item.someday = 0 AND item.updated_at < ?',
      [this.now() - (REVIEW_STALE_DAYS - 1) * DAY_MS],
      'item.updated_at, item.title'
    )
  }

  /** Every Someday task, the oldest first. */
  someday(projects: WatchedProject[], today: string): WeeklyReviewTask[] {
    return this.select(
      projects,
      today,
      weeklyReviewFilters(today).someday,
      'item.created_at',
      'item.someday = 1',
      [],
      'item.created_at, item.title'
    )
  }

  /** Tasks and milestones due today and in the 13 days after, by day. */
  upcoming(projects: WatchedProject[], today: string): WeeklyReviewDay[] {
    if (projects.length === 0) return []
    const last = shiftIsoDate(today, REVIEW_UPCOMING_DAYS - 1)
    const tasks = this.select(
      projects,
      today,
      weeklyReviewFilters(today).upcoming,
      'item.updated_at',
      'item.someday = 0 AND item.target_date >= ? AND item.target_date <= ?',
      [today, last],
      'item.target_date, item.title'
    )
    const byId = new Map(projects.map((project) => [project.id, project]))
    const milestones = this.deps.db
      .prepare(
        `SELECT id, project_id, name, target_date FROM planning_milestones
         WHERE project_id IN (${placeholders(projects)})
           AND status NOT IN ('complete', 'archived')
           AND target_date >= ? AND target_date <= ?
         ORDER BY target_date, name`
      )
      .all(...projects.map((project) => project.id), today, last) as {
      id: string
      project_id: string
      name: string
      target_date: string
    }[]
    const days = new Map<string, WeeklyReviewDay>()
    const day = (date: string) => {
      let entry = days.get(date)
      if (!entry) {
        entry = { date, tasks: [], milestones: [] }
        days.set(date, entry)
      }
      return entry
    }
    for (const task of tasks) day(task.targetDate!).tasks.push(task)
    for (const row of milestones) {
      const project = byId.get(row.project_id)!
      day(row.target_date).milestones.push({
        projectId: project.id,
        projectName: project.name,
        projectColor: project.color,
        milestoneId: row.id,
        name: row.name,
        targetDate: row.target_date,
        reason: ''
      })
    }
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
  }

  /** Each project's late and unforecast milestones, from its report's at-risk section. */
  milestonesAtRisk(projects: WatchedProject[]): WeeklyReviewMilestone[] {
    return projects.flatMap((project) => {
      const risk = this.deps.atRisk(project)
      if (!risk) return []
      const base = {
        projectId: project.id,
        projectName: project.name,
        projectColor: project.color
      }
      return [
        ...risk.lateMilestones.map((milestone) => ({
          ...base,
          milestoneId: milestone.milestoneId,
          name: milestone.name,
          targetDate: milestone.targetDate,
          reason: milestone.reason
        })),
        ...risk.unforecastMilestones.map((milestone) => ({
          ...base,
          milestoneId: milestone.milestoneId,
          name: milestone.name,
          targetDate: null,
          reason: milestone.reason
        }))
      ]
    })
  }

  /** Records a finished review with each step's counts. */
  finish(steps: WeeklyReviewRecord['steps']): WeeklyReviewRecord {
    const record: WeeklyReviewRecord = { id: uuidv4(), finishedAt: this.now(), steps }
    this.deps.db
      .prepare('INSERT INTO weekly_reviews (id, finished_at, steps) VALUES (?, ?, ?)')
      .run(record.id, record.finishedAt, JSON.stringify(steps))
    return record
  }

  /** The last finished review, or null when there is none yet. */
  last(): WeeklyReviewRecord | null {
    return lastWeeklyReview(this.deps.db)
  }
}

/** The last finished review in `db`, or null (also read by the automation API). */
export function lastWeeklyReview(db: Database.Database): WeeklyReviewRecord | null {
  const row = db
    .prepare('SELECT id, finished_at, steps FROM weekly_reviews ORDER BY finished_at DESC LIMIT 1')
    .get() as { id: string; finished_at: number; steps: string } | undefined
  if (!row) return null
  let steps: WeeklyReviewRecord['steps'] = {}
  try {
    steps = reviewSteps(JSON.parse(row.steps))
  } catch {
    // A damaged row still says when the review finished.
  }
  return { id: row.id, finishedAt: row.finished_at, steps }
}

/**
 * A review's step counts from the renderer, checked: only known steps, each
 * with whole numbers, `changed` no more than `shown`.
 */
export function reviewSteps(raw: unknown): WeeklyReviewRecord['steps'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Send each step’s counts')
  const steps: WeeklyReviewRecord['steps'] = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!WEEKLY_REVIEW_STEPS.includes(key as WeeklyReviewStepId))
      throw new Error(`Unknown review step: ${key}`)
    const counts = value as Partial<WeeklyReviewStepCounts> | null
    const whole = (n: unknown): n is number =>
      typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
    if (!counts || !whole(counts.shown) || !whole(counts.changed))
      throw new Error(`The ${key} step needs whole numbers for shown and changed`)
    steps[key as WeeklyReviewStepId] = {
      shown: counts.shown,
      changed: Math.min(counts.changed, counts.shown)
    }
  }
  return steps
}
