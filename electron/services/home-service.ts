import type Database from 'better-sqlite3'
import type {
  AssignedChecklistItemsQuery,
  HarnessSession,
  AssignedTask,
  HomeChecklistItem,
  AssignedTasksQuery,
  WorkloadTasksQuery,
  TeamOverviewQuery,
  TeamOverviewRow,
  Person,
  HomeDay,
  MyDayTask,
  MyWork,
  NeedsYouEntry,
  NeedsYouReviewer,
  PlanMyDayCandidates,
  PlanningPriority,
  TimelineOverviewProject,
  WatchedProject
} from '@shared/ostler-api'
import { isIsoDate, shiftIsoDate } from '@shared/dates'
import { isProjectInPlay } from '@shared/project-stages'
import { UPCOMING_DAYS } from '@shared/ostler-api'
import { matchesFilter, type TaskFilter } from '@shared/task-filter'
import { isNewToday } from '@shared/planning/show-from'
import { MY_DAY_HIGH_PRIORITY_LIMIT } from '@shared/planning/my-day'
import { queryAssignedTasks, queryWorkloadTasks } from './assigned-tasks'
import {
  availableNowSql,
  filterable,
  homeTaskColumns,
  toHomeTask,
  type HomeTaskRow
} from './home-task-row'
import { queryLeftOver, queryMyDay } from './my-day-service'
import { queryChecklistItems } from './home-checklist-items'
import { queryTimelineOverview } from './timeline-overview'
import { queryTeamOverview, sqlTeamOverviewDeps } from './team-overview'

/** What agents want from the person in one project, read from the harness. */
export interface AgentAttention {
  questions: { id: string; text: string; at: number; taskId: string | null }[]
  reviews: {
    id: string
    title: string
    at: number
    taskId: string | null
    /** Where its reviewer got to (N9.5b), when it was reviewed. */
    reviewer?: NeedsYouReviewer
  }[]
  /**
   * Plans waiting for approval (N9.3b): one per run, `id` the run's session.
   * Optional so callers that know of no plans can leave it out.
   */
  plans?: { id: string; title: string; version: number; at: number; taskId: string | null }[]
}

/**
 * The plans waiting for approval in one project's harness state (N9.3b), one
 * per run: Needs you, the Inbox and their notifications read this, so a plan
 * leaves them all as soon as it is decided.
 */
export function plansWaiting(
  sessions: readonly HarnessSession[],
  taskOf: (sessionId: string) => string | null
): NonNullable<AgentAttention['plans']> {
  return sessions
    .filter((session) => session.status !== 'done' && session.plan?.status === 'pending')
    .map((session) => ({
      id: session.id,
      title: session.title,
      version: session.plan!.version,
      at: Date.parse(session.plan!.submittedAt) || 0,
      taskId: taskOf(session.id)
    }))
}

export interface HomeServiceDependencies {
  db: Database.Database
  /** Every project; the service keeps the enabled ones. */
  getProjects(): WatchedProject[]
  getMeId(): string | null
  /** "Use AI agents" is on. */
  agentsOn(): boolean
  /** The harness's questions and reviews for a project with a folder, or null. */
  agentAttention(project: WatchedProject): AgentAttention | null
  /** The people in the address book and in projects, for the Team view. */
  getPeople?(): Person[]
}

/**
 * Home's lists as filters (P5.7), through the one `matchesFilter` every view
 * and the automation API use. Today: overdue, due today, in progress or shown
 * from today, assigned to Me or to nobody. Upcoming: due in the next seven
 * days and assigned to Me. Both leave out hidden tasks (N1.1a): in Someday,
 * or shown from a later day.
 */
export const HOME_TODAY_FILTERS: readonly TaskFilter[] = [
  {
    match: 'any',
    conditions: [
      { field: 'due', op: 'is', value: 'overdue' },
      { field: 'due', op: 'is', value: 'today' },
      { field: 'status', op: 'is', value: ['active'] },
      { field: 'showFrom', op: 'is', value: 'today' }
    ]
  },
  { match: 'all', conditions: [{ field: 'assignee', op: 'is', value: ['me', 'nobody'] }] },
  { match: 'all', conditions: [{ field: 'showFrom', op: 'is', value: 'shown' }] }
]

export const HOME_UPCOMING_FILTER: TaskFilter = {
  match: 'all',
  conditions: [
    { field: 'assignee', op: 'is', value: ['me'] },
    { field: 'due', op: 'is', value: 'next7Days' },
    { field: 'showFrom', op: 'is', value: 'shown' }
  ]
}

const PRIORITY_ORDER: Record<PlanningPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
}

/**
 * Home's cross-project queries (P5.6): one SQL query each across the enabled
 * projects, rather than one call per project from the renderer.
 */
export class HomeService {
  constructor(private readonly deps: HomeServiceDependencies) {}

  private enabledProjects(): WatchedProject[] {
    return this.deps.getProjects().filter((project) => project.enabled)
  }

  /**
   * The projects Today, Upcoming and My work read (N5.3, N38): enabled, and
   * Planning or Active. An On hold or Done project's tasks come back the
   * moment it moves back to Active.
   */
  private inPlayProjects(): WatchedProject[] {
    return this.deps.getProjects().filter(isProjectInPlay)
  }

  /**
   * Today: overdue, due today, in progress and shown from today, assigned to Me, or to nobody.
   * Upcoming: due in the next seven days and assigned to Me (an unassigned
   * task is not counted as mine there). Done, archived and deleted tasks are
   * left out. `today` is the renderer's local date, so Home and its clock agree.
   */
  getMyWork({ today }: { today: string }): MyWork {
    if (!isIsoDate(today)) throw new Error('today must use YYYY-MM-DD')
    const projects = this.inPlayProjects()
    if (projects.length === 0)
      return { today: [], todayItems: [], upcoming: [], myDay: [], leftOver: null }
    const { today: todayTasks, upcoming } = this.todayAndUpcoming(projects, today)
    // Dated checklist items (N2.2), in one query for both lists.
    const items = queryChecklistItems(this.deps.db, projects, {
      today,
      personId: this.deps.getMeId(),
      through: shiftIsoDate(today, UPCOMING_DAYS),
      nobodyThroughToday: true
    })
    return {
      today: todayTasks,
      todayItems: items.filter((item) => item.dueDate <= today),
      upcoming: withUpcomingItems(
        upcoming,
        items.filter((item) => item.dueDate > today)
      ),
      myDay: queryMyDay(this.deps.db, projects, today),
      leftOver: queryLeftOver(this.deps.db, projects, today)
    }
  }

  /**
   * What Plan my day offers (N1.4): today's list as it is, what was left from
   * the last list, Today's tasks, and a short list of open high and critical
   * tasks assigned to Me with no due date.
   */
  getPlanMyDay({ today }: { today: string }): PlanMyDayCandidates {
    if (!isIsoDate(today)) throw new Error('today must use YYYY-MM-DD')
    const projects = this.inPlayProjects()
    const meId = this.deps.getMeId()
    if (projects.length === 0) return { myDay: [], leftOver: null, today: [], highPriority: [] }
    const byId = new Map(projects.map((project) => [project.id, project]))
    const high =
      meId === null
        ? []
        : (this.deps.db
            .prepare(
              `SELECT ${homeTaskColumns()} FROM planning_work_items
               WHERE project_id IN (${projects.map(() => '?').join(', ')})
                 AND archived_at IS NULL AND deleted_at IS NULL AND status <> 'done'
                 AND ${availableNowSql()}
                 AND target_date IS NULL AND priority IN ('critical', 'high') AND assignee_id = ?
               ORDER BY CASE priority WHEN 'critical' THEN 0 ELSE 1 END, updated_at DESC
               LIMIT ?`
            )
            .all(
              ...projects.map((project) => project.id),
              today,
              meId,
              MY_DAY_HIGH_PRIORITY_LIMIT
            ) as HomeTaskRow[])
    return {
      myDay: queryMyDay(this.deps.db, projects, today),
      leftOver: queryLeftOver(this.deps.db, projects, today),
      today: this.todayAndUpcoming(projects, today).today,
      highPriority: high.map((row) => toHomeTask(row, byId.get(row.project_id)!))
    }
  }

  private todayAndUpcoming(
    projects: WatchedProject[],
    today: string
  ): { today: MyDayTask[]; upcoming: HomeDay[] } {
    const byId = new Map(projects.map((project) => [project.id, project]))
    const context = { today, meId: this.deps.getMeId() }
    // SQL narrows to open work that could be in either list; the filters decide.
    const rows = this.deps.db
      .prepare(
        `SELECT ${homeTaskColumns()}
         FROM planning_work_items
         WHERE project_id IN (${projects.map(() => '?').join(', ')})
           AND archived_at IS NULL AND deleted_at IS NULL AND status <> 'done' AND someday = 0
           AND in_triage = 0
           AND (status = 'active' OR (target_date IS NOT NULL AND target_date <= ?)
                OR show_from = ?)`
      )
      .all(
        ...projects.map((project) => project.id),
        shiftIsoDate(today, UPCOMING_DAYS),
        today
      ) as HomeTaskRow[]

    const todayTasks: MyDayTask[] = []
    const upcoming = new Map<string, MyDayTask[]>()
    for (const row of rows) {
      const candidate = filterable(row)
      const task = toHomeTask(row, byId.get(row.project_id)!)
      const due = row.target_date
      if (HOME_TODAY_FILTERS.every((filter) => matchesFilter(candidate, filter, context))) {
        const reason =
          due !== null && due < today
            ? 'overdue'
            : due === today
              ? 'today'
              : isNewToday(candidate, today)
                ? 'new-today'
                : 'in-progress'
        todayTasks.push({ ...task, reason })
      } else if (due !== null && matchesFilter(candidate, HOME_UPCOMING_FILTER, context)) {
        upcoming.set(due, [...(upcoming.get(due) ?? []), task])
      }
    }
    const reasonOrder = { overdue: 0, today: 1, 'new-today': 2, 'in-progress': 3 }
    todayTasks.sort(
      (a, b) =>
        reasonOrder[a.reason!] - reasonOrder[b.reason!] ||
        (a.targetDate ?? '').localeCompare(b.targetDate ?? '') ||
        PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
        a.title.localeCompare(b.title)
    )
    const days: HomeDay[] = [...upcoming.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, tasks]) => ({
        date,
        tasks: tasks.sort(
          (a, b) =>
            PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
            a.title.localeCompare(b.title)
        )
      }))
    return { today: todayTasks, upcoming: days }
  }

  /**
   * My work (R3.1): every live task assigned to one person across the enabled
   * projects, in one query (`assigned-tasks.ts`).
   */
  getAssignedTasks(query: AssignedTasksQuery): AssignedTask[] {
    if (!isIsoDate(query.today)) throw new Error('today must use YYYY-MM-DD')
    return queryAssignedTasks(this.deps.db, this.inPlayProjects(), query, this.deps.getMeId())
  }

  /** My work's dated checklist items for one person (N2.2), in one query. */
  getAssignedChecklistItems(query: AssignedChecklistItemsQuery): HomeChecklistItem[] {
    if (!isIsoDate(query.today)) throw new Error('today must use YYYY-MM-DD')
    const projects = this.inPlayProjects().filter(
      (project) => !query.projectId || project.id === query.projectId
    )
    return queryChecklistItems(this.deps.db, projects, {
      today: query.today,
      personId: query.personId,
      through: null,
      nobodyThroughToday: false
    })
  }

  /** Workload (R3.2): every unfinished task that can count up to `through`, in one query. */
  getWorkloadTasks(query: WorkloadTasksQuery): AssignedTask[] {
    if (!isIsoDate(query.through)) throw new Error('through must use YYYY-MM-DD')
    return queryWorkloadTasks(this.deps.db, this.enabledProjects(), query)
  }

  /** The Team view: one row per person across the enabled projects (team-leaders plan, D4). */
  getTeamOverview(query: TeamOverviewQuery): TeamOverviewRow[] {
    if (!isIsoDate(query.today)) throw new Error('today must use YYYY-MM-DD')
    return queryTeamOverview(
      this.deps.db,
      this.enabledProjects(),
      query,
      sqlTeamOverviewDeps(this.deps.db, () => this.deps.getPeople?.() ?? [])
    )
  }

  /** The Timeline across projects (N5.4): milestones and date spans, in one query. */
  getTimelineOverview(): TimelineOverviewProject[] {
    return queryTimelineOverview(this.deps.db, this.enabledProjects())
  }

  /**
   * Blocked tasks, and, while agents are on, agent questions and reviews
   * waiting, in the projects in play: like Today, Upcoming and My work, an On
   * hold or Done project is left out until it moves back to Active.
   */
  getNeedsYou(): NeedsYouEntry[] {
    const projects = this.inPlayProjects()
    if (projects.length === 0) return []
    const rows = this.deps.db
      .prepare(
        `SELECT id, project_id, title FROM planning_work_items
         WHERE project_id IN (${projects.map(() => '?').join(', ')})
           AND archived_at IS NULL AND deleted_at IS NULL AND status = 'blocked'
         ORDER BY updated_at DESC`
      )
      .all(...projects.map((project) => project.id)) as {
      id: string
      project_id: string
      title: string
    }[]
    const entries: NeedsYouEntry[] = rows.map((row) => ({
      key: `blocked:${row.id}`,
      kind: 'blocked',
      projectId: row.project_id,
      title: row.title,
      taskId: row.id
    }))
    if (!this.deps.agentsOn()) return entries
    for (const project of projects) {
      const attention = this.deps.agentAttention(project)
      if (!attention) continue
      for (const question of attention.questions) {
        entries.push({
          key: `question:${project.id}:${question.id}`,
          kind: 'question',
          projectId: project.id,
          title: question.text,
          taskId: question.taskId
        })
      }
      for (const plan of attention.plans ?? []) {
        entries.push({
          key: `plan:${project.id}:${plan.id}:${plan.version}`,
          kind: 'plan',
          projectId: project.id,
          title: plan.title,
          taskId: plan.taskId,
          sessionId: plan.id
        })
      }
      for (const review of attention.reviews) {
        entries.push({
          key: `review:${project.id}:${review.id}`,
          kind: 'review',
          projectId: project.id,
          title: review.title,
          taskId: review.taskId,
          ...(review.reviewer ? { reviewer: review.reviewer } : {})
        })
      }
    }
    return entries
  }
}

/** Upcoming's days with their checklist items (N2.2): a day may hold only items. */
function withUpcomingItems(days: HomeDay[], items: HomeChecklistItem[]): HomeDay[] {
  if (items.length === 0) return days
  const byDate = new Map(days.map((day) => [day.date, { ...day }]))
  for (const item of items) {
    const day = byDate.get(item.dueDate) ?? { date: item.dueDate, tasks: [] }
    day.items = [...(day.items ?? []), item]
    byDate.set(item.dueDate, day)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
