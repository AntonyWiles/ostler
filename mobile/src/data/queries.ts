/**
 * The phone's read-only questions to its database: the project list, a project's status, its tasks
 * by status, My day and one task. Plain functions over anything shaped like a database (the phone's
 * op-sqlite adapter, or better-sqlite3 in the desktop tests), so they import no React Native code.
 *
 * The SQL means what the desktop's means (`planning-service.ts`, `my-day-service.ts`): archived
 * tasks, the recycle bin, won't-do tasks and To triage are left out where the desktop leaves them
 * out. The status figures come from the desktop's own `buildProjectReport`, so they cannot drift.
 */
import type {
  PlanningComment,
  PlanningMilestone,
  PlanningPriority,
  PlanningStatusTransition,
  PlanningWorkItem,
  PlanningWorkItemStatus,
  ReportKeyNumbers,
  ShareRole
} from '@shared/ostler-api'
import { commentPermissions, type CommentPermissions } from '@shared/comment-permissions'
import { actorDisplayName } from '@shared/actor-name'
import type { ActorKind } from '@shared/ostler-api/activity-types'
import { normalisedDependencyLink } from '@shared/planning/dependency-links'
import { TASK_STATUSES } from '@shared/task-labels'
import { buildProjectReport, localIsoDate } from '../../../electron/services/report-builder'

/** What these queries need of a database; `OstlerDatabase` and better-sqlite3 both fit. */
export interface QueryDb {
  prepare(sql: string): {
    all(...args: unknown[]): unknown[]
    get(...args: unknown[]): unknown
  }
}

/** The personal space's pseudo-project: it holds no tasks and is never listed. */
const PERSONAL_PROJECT_ID = '~personal'

/** A task is counted (as the reports count it): not in the bin, not won't do, not in triage. */
const KEPT = 'deleted_at IS NULL AND resolution IS NULL AND in_triage = 0'
/** The Board's tasks: kept, and not archived. */
const BOARD = `${KEPT} AND archived_at IS NULL`

export interface ProjectSummary {
  id: string
  /** Always null: no database keeps a `projects` table (migration 0002); see project-display.ts. */
  name: string | null
  color: string | null
  taskCount: number
  openCount: number
  doneCount: number
}

interface CountRow {
  project_id: string
  total: number
  done: number
}

/** Every project the database holds tasks or milestones for, with its task counts. */
export function projects(db: QueryDb): ProjectSummary[] {
  const counts = db
    .prepare(
      `SELECT project_id, COUNT(*) AS total, SUM(status = 'done') AS done
       FROM planning_work_items WHERE ${BOARD} GROUP BY project_id`
    )
    .all() as CountRow[]
  // Migration 0002 drops the `projects` table, so names and colours come from elsewhere
  // (project-display.ts); the planning tables say which projects exist, and a joined share
  // names one that has nothing in it yet, so its first task can be added here.
  const known = db
    .prepare(
      `SELECT project_id FROM planning_work_items WHERE deleted_at IS NULL
       UNION SELECT project_id FROM planning_milestones
       UNION SELECT project_id FROM sync_shares WHERE kind = 'project'`
    )
    .all() as { project_id: string | null }[]
  const totals = new Map(counts.map((row) => [row.project_id, row]))
  const ids = new Set(
    known.map((row) => row.project_id).filter((id): id is string => typeof id === 'string')
  )
  ids.delete(PERSONAL_PROJECT_ID)
  return [...ids]
    .map((id) => {
      const count = totals.get(id)
      const total = count?.total ?? 0
      const done = count?.done ?? 0
      return {
        id,
        name: null,
        color: null,
        taskCount: total,
        openCount: total - done,
        doneCount: done
      }
    })
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
}

// ─── Tasks ──────────────────────────────────────────────────────────────

export interface TaskSummary {
  id: string
  projectId: string
  title: string
  status: PlanningWorkItemStatus
  priority: PlanningPriority
  targetDate: string | null
  assigneeId: string | null
}

interface TaskSummaryRow {
  id: string
  project_id: string
  title: string
  status: PlanningWorkItemStatus
  priority: PlanningPriority
  target_date: string | null
  assignee_id: string | null
}

const SUMMARY_COLUMNS = 'id, project_id, title, status, priority, target_date, assignee_id'

function toSummary(row: TaskSummaryRow): TaskSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    targetDate: row.target_date,
    assigneeId: row.assignee_id
  }
}

/** A project's Board tasks grouped by status, in the Board's column order and the Board's task order. */
export function tasksByStatus(
  db: QueryDb,
  projectId: string
): Record<PlanningWorkItemStatus, TaskSummary[]> {
  const rows = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM planning_work_items
       WHERE project_id = ? AND ${BOARD} ORDER BY order_key`
    )
    .all(projectId) as TaskSummaryRow[]
  const groups = Object.fromEntries(
    TASK_STATUSES.map((status) => [status, [] as TaskSummary[]])
  ) as Record<PlanningWorkItemStatus, TaskSummary[]>
  for (const row of rows) groups[row.status]?.push(toSummary(row))
  return groups
}

/**
 * One day's My day list across every project, in order. As the desktop's `queryMyDay`: done tasks
 * stay (ticked), archived, deleted, hidden (Someday, shown-from a later day) and triage tasks do not.
 */
export function myDay(db: QueryDb, today: string): TaskSummary[] {
  const rows = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS.split(', ')
        .map((column) => `w.${column}`)
        .join(', ')}
       FROM my_day_entries e JOIN planning_work_items w ON w.id = e.work_item_id
       WHERE e.day = ? AND w.archived_at IS NULL AND w.deleted_at IS NULL
         AND w.in_triage = 0 AND w.someday = 0 AND (w.show_from IS NULL OR w.show_from <= ?)
       ORDER BY e.order_key, e.added_at`
    )
    .all(today, today) as TaskSummaryRow[]
  return rows.map(toSummary)
}

export interface ChecklistLine {
  text: string
  checked: boolean
}

export interface TaskComment {
  id: string
  body: string
  createdAt: number
  /** Who wrote it, named as the desktop's history names them. */
  author: string
  /** True for a person's comment; false for an agent, automation or rule. */
  byPerson: boolean
  /** Changed after it was written. */
  edited: boolean
  /** Pinned to the top of the task's comments. */
  pinned: boolean
  /** What this phone's person may do with it (`commentPermissions`, as on the PC). */
  can: CommentPermissions
}

export interface TaskDetail extends TaskSummary {
  description: string
  labels: string[]
  startDate: string | null
  estimate: number | null
  milestoneId: string | null
  milestoneName: string | null
  assigneeName: string | null
  archived: boolean
  /** Closed as won't do (it is archived too). */
  wontDo: boolean
  /** Set aside in Someday. */
  someday: boolean
  /** A capture still waiting in To triage. */
  inTriage: boolean
  /** Linked to agent work, which cannot go to the recycle bin. */
  agentLinked: boolean
  checklist: ChecklistLine[]
  /** The task this one is a subtask of. */
  parent: { id: string; title: string } | null
  /** Its own subtasks that are not archived or in the bin, by phase, then in the project's order. */
  subtasks: TaskSummary[]
  /** The tasks it waits on, in the order they were linked. */
  waitingOn: TaskSummary[]
  /** The tasks that wait on it. */
  waitedOnBy: TaskSummary[]
  /** Its reminders still to come, soonest first. */
  reminders: TaskReminder[]
  comments: TaskComment[]
  createdAt: number
  updatedAt: number
}

interface TaskRow extends TaskSummaryRow {
  description: string
  labels: string
  start_date: string | null
  estimate: number | null
  milestone_id: string | null
  archived_at: number | null
  resolution?: PlanningWorkItem['resolution']
  someday?: number
  in_triage?: number
  linked_harness_task_id: string | null
  parent_work_item_id: string | null
  acceptance_criteria: string
  created_at: number
  updated_at: number
}

function stringList(json: string | null | undefined): string[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

/** One task with what its screen shows; null when it is gone (or in the recycle bin). */
export function task(db: QueryDb, id: string): TaskDetail | null {
  const row = db
    .prepare('SELECT * FROM planning_work_items WHERE id = ? AND deleted_at IS NULL')
    .get(id) as TaskRow | undefined
  if (!row) return null
  const named = (sql: string, key: string | null): string | null =>
    key === null ? null : ((db.prepare(sql).get(key) as { name: string } | undefined)?.name ?? null)
  const criteria = stringList(row.acceptance_criteria)
  const checked = new Set(
    (
      db
        .prepare('SELECT criterion_text FROM planning_checklist_checks WHERE work_item_id = ?')
        .all(id) as { criterion_text: string }[]
    ).map((check) => check.criterion_text)
  )
  const comments = db
    .prepare(
      `SELECT c.id, c.body, c.created_at, c.updated_at, c.pinned_at, c.author_kind,
              c.author_person_id, c.rule_name, p.name AS author_name
       FROM planning_comments c LEFT JOIN people p ON p.id = c.author_person_id
       WHERE c.work_item_id = ? AND c.deleted_at IS NULL
       ORDER BY c.pinned_at IS NULL, c.pinned_at, c.created_at`
    )
    .all(id) as {
    id: string
    body: string
    created_at: number
    updated_at: number
    pinned_at: number | null
    author_kind: ActorKind
    author_person_id: string | null
    rule_name: string | null
    author_name: string | null
  }[]
  const role = shareRole(db, row.project_id)
  const me = mePerson(db)
  return {
    ...toSummary(row),
    description: row.description,
    labels: stringList(row.labels),
    startDate: row.start_date,
    estimate: row.estimate,
    milestoneId: row.milestone_id,
    milestoneName: named('SELECT name FROM planning_milestones WHERE id = ?', row.milestone_id),
    assigneeName: named('SELECT name FROM people WHERE id = ?', row.assignee_id),
    archived: row.archived_at !== null,
    wontDo: row.resolution === 'wont-do',
    someday: Boolean(row.someday),
    inTriage: Boolean(row.in_triage),
    agentLinked: row.linked_harness_task_id !== null,
    checklist: criteria.map((text) => ({ text, checked: checked.has(text) })),
    parent:
      row.parent_work_item_id === null
        ? null
        : ((db
            .prepare(
              'SELECT id, title FROM planning_work_items WHERE id = ? AND deleted_at IS NULL'
            )
            .get(row.parent_work_item_id) as { id: string; title: string } | undefined) ?? null),
    subtasks: (
      db
        .prepare(
          `SELECT ${SUMMARY_COLUMNS} FROM planning_work_items
           WHERE parent_work_item_id = ? AND deleted_at IS NULL AND archived_at IS NULL
           ORDER BY subtask_phase_number, order_key`
        )
        .all(id) as TaskSummaryRow[]
    ).map(toSummary),
    waitingOn: (
      db
        .prepare(
          `SELECT ${SUMMARY_COLUMNS.split(', ')
            .map((column) => `item.${column}`)
            .join(', ')}
           FROM planning_dependencies dependency
           JOIN planning_work_items item ON item.id = dependency.depends_on_id
           WHERE dependency.work_item_id = ? AND item.deleted_at IS NULL
           ORDER BY dependency.rowid`
        )
        .all(id) as TaskSummaryRow[]
    ).map(toSummary),
    reminders: (
      db
        .prepare(
          `SELECT id, remind_at, kind, keep_reminding FROM reminders
           WHERE work_item_id = ? AND delivered_at IS NULL AND stopped_at IS NULL
           ORDER BY remind_at`
        )
        .all(id) as { id: string; remind_at: number; kind: string; keep_reminding: number }[]
    ).map((reminder) => ({
      id: reminder.id,
      remindAt: reminder.remind_at,
      due: reminder.kind === 'due',
      keepReminding: Boolean(reminder.keep_reminding)
    })),
    waitedOnBy: (
      db
        .prepare(
          `SELECT ${SUMMARY_COLUMNS.split(', ')
            .map((column) => `item.${column}`)
            .join(', ')}
           FROM planning_dependencies dependency
           JOIN planning_work_items item ON item.id = dependency.work_item_id
           WHERE dependency.depends_on_id = ? AND item.deleted_at IS NULL
           ORDER BY item.order_key`
        )
        .all(id) as TaskSummaryRow[]
    ).map(toSummary),
    comments: comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      createdAt: comment.created_at,
      author: actorDisplayName(comment.author_kind, comment.author_name, comment.rule_name),
      byPerson: comment.author_kind === 'human' && !comment.rule_name,
      edited: comment.updated_at > comment.created_at,
      pinned: comment.pinned_at !== null,
      can: commentPermissions(
        role,
        {
          authorKind: comment.author_kind as PlanningComment['authorKind'],
          authorPersonId: comment.author_person_id
        },
        me
      )
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// ─── Project status ─────────────────────────────────────────────────────

/** What `buildProjectReport` reads, less the range and the clock. */
export interface ProjectReportInputs {
  projectId: string
  items: PlanningWorkItem[]
  history: PlanningStatusTransition[]
  milestones: PlanningMilestone[]
  people: { id: string; name: string }[]
}

interface FullItemRow extends TaskRow {
  milestone_id: string | null
  column_id?: string | null
  origin: PlanningWorkItem['origin']
  linked_harness_task_id: string | null
  auto_queue: number
  parent_work_item_id: string | null
  task_code: string
  phase_code: string
  phase_name: string
  subtask_phase_number: number | null
  subtask_phase_name: string
  verification_status: PlanningWorkItem['verificationStatus']
  verified_by: PlanningWorkItem['verifiedBy']
  verified_at: number | null
  verification_notes: string
  deleted_at: number | null
  order_key?: string
  iteration_id?: string | null
  type_id?: string | null
  subproject_id?: string | null
  resolution?: PlanningWorkItem['resolution']
  show_from?: string | null
  someday?: number
  impact?: number | null
  effort?: number | null
  in_triage?: number
  number?: number | null
}

interface MilestoneRow {
  id: string
  project_id: string
  goal_id: string | null
  subproject_id?: string | null
  name: string
  outcome: string
  target_date: string | null
  success_criteria: string
  status: PlanningMilestone['status']
  created_at: number
  updated_at: number
}

/**
 * The inputs for one project's report, read the way `listKeptWorkItemsForReports`,
 * `listProjectStatusTransitions` and `listMilestones` read them. Fields the status figures do not
 * read (custom fields, GitHub links, scheduled queues) are left at their empty values.
 */
export function projectReportInputs(db: QueryDb, projectId: string): ProjectReportInputs {
  const rows = db
    .prepare(
      `SELECT * FROM planning_work_items WHERE project_id = ? AND ${KEPT} ORDER BY order_key`
    )
    .all(projectId) as FullItemRow[]
  const linkRows = db
    .prepare(
      `SELECT dependency.work_item_id, dependency.depends_on_id, dependency.type, dependency.lag_days
       FROM planning_dependencies dependency
       JOIN planning_work_items item ON item.id = dependency.work_item_id
       WHERE item.project_id = ? ORDER BY dependency.rowid`
    )
    .all(projectId) as {
    work_item_id: string
    depends_on_id: string
    type: string
    lag_days: number
  }[]
  const links = new Map<string, ReturnType<typeof normalisedDependencyLink>[]>()
  for (const link of linkRows) {
    const list = links.get(link.work_item_id) ?? []
    list.push(
      normalisedDependencyLink({ id: link.depends_on_id, type: link.type, lagDays: link.lag_days })
    )
    links.set(link.work_item_id, list)
  }
  const checkRows = db
    .prepare(
      'SELECT work_item_id, criterion_text FROM planning_checklist_checks WHERE project_id = ?'
    )
    .all(projectId) as { work_item_id: string; criterion_text: string }[]
  const checks = new Map<string, Set<string>>()
  for (const check of checkRows) {
    const set = checks.get(check.work_item_id) ?? new Set<string>()
    set.add(check.criterion_text)
    checks.set(check.work_item_id, set)
  }
  const items: PlanningWorkItem[] = rows.map((row) => {
    const criteria = stringList(row.acceptance_criteria)
    const dependencyLinks = links.get(row.id) ?? []
    return {
      id: row.id,
      projectId: row.project_id,
      milestoneId: row.milestone_id,
      title: row.title,
      description: row.description,
      status: row.status,
      columnId: row.column_id ?? null,
      priority: row.priority,
      labels: stringList(row.labels),
      acceptanceCriteria: criteria,
      dependencyIds: dependencyLinks.map((link) => link.id),
      dependencyLinks,
      targetDate: row.target_date,
      startDate: row.start_date,
      assigneeId: row.assignee_id,
      estimate: row.estimate,
      checkedCriteria: criteria.filter((text) => checks.get(row.id)?.has(text)),
      origin: row.origin,
      linkedHarnessTaskId: row.linked_harness_task_id,
      autoQueue: Boolean(row.auto_queue),
      number: row.number ?? null,
      parentWorkItemId: row.parent_work_item_id,
      taskCode: row.task_code,
      phaseCode: row.phase_code,
      phaseName: row.phase_name,
      subtaskPhaseNumber: row.subtask_phase_number,
      subtaskPhaseName: row.subtask_phase_name,
      verificationStatus: row.verification_status,
      verifiedBy: row.verified_by,
      verifiedAt: row.verified_at,
      verificationNotes: row.verification_notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at ?? null,
      deletedAt: row.deleted_at ?? null,
      orderKey: row.order_key ?? '',
      iterationId: row.iteration_id ?? null,
      typeId: row.type_id ?? null,
      subprojectId: row.subproject_id ?? null,
      resolution: row.resolution ?? null,
      showFrom: row.show_from ?? null,
      someday: Boolean(row.someday),
      impact: row.impact ?? null,
      effort: row.effort ?? null,
      inTriage: Boolean(row.in_triage)
    }
  })
  const history = db
    .prepare(
      `SELECT history.work_item_id AS workItemId, history.from_status AS "from", history.to_status AS "to", history.at
       FROM planning_status_history history
       JOIN planning_work_items item ON item.id = history.work_item_id
       WHERE item.project_id = ? AND item.deleted_at IS NULL AND item.resolution IS NULL
         AND item.in_triage = 0
       ORDER BY history.at, history.sequence`
    )
    .all(projectId) as PlanningStatusTransition[]
  const milestoneRows = db
    .prepare('SELECT * FROM planning_milestones WHERE project_id = ? ORDER BY updated_at DESC')
    .all(projectId) as MilestoneRow[]
  const milestones: PlanningMilestone[] = milestoneRows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    goalId: row.goal_id,
    subprojectId: row.subproject_id ?? null,
    name: row.name,
    outcome: row.outcome,
    targetDate: row.target_date,
    successCriteria: stringList(row.success_criteria),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }))
  const people = db.prepare('SELECT id, name FROM people').all() as { id: string; name: string }[]
  return { projectId, items, history, milestones, people }
}

/** The open milestone with the soonest date: the desktop's `nextMilestone` (portfolio-aggregation). */
export function nextMilestone(
  milestones: readonly PlanningMilestone[]
): { id: string; name: string; targetDate: string } | null {
  let next: { id: string; name: string; targetDate: string } | null = null
  for (const milestone of milestones) {
    if (milestone.status !== 'planned' && milestone.status !== 'active') continue
    if (!milestone.targetDate) continue
    if (next === null || milestone.targetDate < next.targetDate) {
      next = { id: milestone.id, name: milestone.name, targetDate: milestone.targetDate }
    }
  }
  return next
}

export interface ProjectOverview {
  /** The desktop Overview's key numbers for its default range (the last 30 days). */
  keyNumbers: Pick<ReportKeyNumbers, 'open' | 'doneInRange' | 'overdueNow' | 'dueNext7Days'>
  nextMilestone: { id: string; name: string; targetDate: string } | null
}

/** The status figures of the desktop Overview for one project, from `buildProjectReport`. */
export function projectOverview(db: QueryDb, projectId: string, now = Date.now()): ProjectOverview {
  const inputs = projectReportInputs(db, projectId)
  const report = buildProjectReport({
    projectId,
    range: '30d',
    items: inputs.items,
    history: inputs.history,
    milestones: inputs.milestones,
    people: inputs.people,
    estimateUnit: 'points',
    now
  })
  const { open, doneInRange, overdueNow, dueNext7Days } = report.keyNumbers
  return {
    keyNumbers: { open, doneInRange, overdueNow, dueNext7Days },
    nextMilestone: nextMilestone(inputs.milestones)
  }
}

/** Today's local date, `YYYY-MM-DD`, as every date in Ostler is. */
export function today(now = Date.now()): string {
  return localIsoDate(now)
}

// ─── What the edit controls offer ───────────────────────────────────────

export interface PersonChoice {
  id: string
  name: string
}

/**
 * The people a task of this project can be given to: the address book and the project's own
 * people, not archived (`PlanningService.assigneeId`'s rule). The PC's own Me does not travel,
 * so it is not on the phone.
 */
export function assignablePeople(db: QueryDb, projectId: string): PersonChoice[] {
  return db
    .prepare(
      `SELECT id, name FROM people
       WHERE archived_at IS NULL AND (project_id IS NULL OR project_id = ?)
       ORDER BY name COLLATE NOCASE, id`
    )
    .all(projectId) as PersonChoice[]
}

export interface TaskReminder {
  id: string
  remindAt: number
  /** Planned from the due date by the PC, rather than set by a person. */
  due: boolean
  keepReminding: boolean
}

/** A project's archived tasks (won't do ones too), the most recently archived first. */
export function archivedTasks(db: QueryDb, projectId: string): TaskSummary[] {
  return (
    db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM planning_work_items
         WHERE project_id = ? AND deleted_at IS NULL AND archived_at IS NOT NULL
         ORDER BY archived_at DESC, order_key`
      )
      .all(projectId) as TaskSummaryRow[]
  ).map(toSummary)
}

/** A project's tasks in the recycle bin, the most recently binned first. */
export function binnedTasks(db: QueryDb, projectId: string): TaskSummary[] {
  return (
    db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM planning_work_items
         WHERE project_id = ? AND deleted_at IS NOT NULL
         ORDER BY deleted_at DESC, order_key`
      )
      .all(projectId) as TaskSummaryRow[]
  ).map(toSummary)
}

/** This phone's role in a shared project, or null for a project that is not shared. */
export function shareRole(db: QueryDb, projectId: string): ShareRole | null {
  const row = db.prepare('SELECT my_role FROM sync_shares WHERE project_id = ?').get(projectId) as
    { my_role: ShareRole | null } | undefined
  return row?.my_role ?? null
}

/** The person this phone is signed in as, when it knows. */
function mePerson(db: QueryDb): string | null {
  const row = db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
    { id: string } | undefined
  return row?.id ?? null
}

/**
 * The tasks a task could wait on: the project's live tasks, not itself or ones it waits on
 * already, whose title holds `filter`; for a subtask, only its siblings in the same phase.
 */
export function dependencyChoices(
  db: QueryDb,
  taskId: string,
  filter: string,
  limit = 30
): TaskSummary[] {
  const self = db
    .prepare(
      'SELECT project_id, parent_work_item_id, subtask_phase_number FROM planning_work_items WHERE id = ?'
    )
    .get(taskId) as
    | {
        project_id: string
        parent_work_item_id: string | null
        subtask_phase_number: number | null
      }
    | undefined
  if (!self) return []
  const words = filter.trim().toLowerCase()
  const rows = db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, parent_work_item_id, subtask_phase_number FROM planning_work_items
       WHERE project_id = ? AND deleted_at IS NULL AND archived_at IS NULL AND id <> ?
         AND id NOT IN (SELECT depends_on_id FROM planning_dependencies WHERE work_item_id = ?)
       ORDER BY status = 'done', order_key`
    )
    .all(self.project_id, taskId, taskId) as (TaskSummaryRow & {
    parent_work_item_id: string | null
    subtask_phase_number: number | null
  })[]
  return rows
    .filter(
      (row) =>
        self.parent_work_item_id === null ||
        (row.parent_work_item_id === self.parent_work_item_id &&
          row.subtask_phase_number === self.subtask_phase_number)
    )
    .filter((row) => !words || row.title.toLowerCase().includes(words))
    .slice(0, limit)
    .map(toSummary)
}

export interface MilestoneChoice {
  id: string
  name: string
}

/** The milestones a task of the project can go in, soonest target first, then by name. */
export function milestoneChoices(db: QueryDb, projectId: string): MilestoneChoice[] {
  return db
    .prepare(
      `SELECT id, name FROM planning_milestones WHERE project_id = ?
       ORDER BY target_date IS NULL, target_date, name COLLATE NOCASE, id`
    )
    .all(projectId) as MilestoneChoice[]
}

/**
 * The labels the project's kept tasks use, by name (`PlanningService.listProjectLabels`, without
 * colours), so a label is picked rather than typed again.
 */
export function projectLabels(db: QueryDb, projectId: string): string[] {
  const rows = db
    .prepare(
      `SELECT labels FROM planning_work_items
       WHERE project_id = ? AND deleted_at IS NULL AND labels <> '[]'`
    )
    .all(projectId) as { labels: string }[]
  const names = new Set<string>()
  for (const row of rows) for (const label of stringList(row.labels)) names.add(label)
  return [...names].sort((a, b) => a.localeCompare(b))
}
