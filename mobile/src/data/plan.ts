/**
 * A project's planning views on the phone, beyond its Board: To triage and Someday tasks, its
 * milestones (with how far along each is), its decisions, and its sign-offs, which the person
 * named as approver answers here as on the PC (`SignOffService.approve` / `sendBack`).
 *
 * A sign-off sent back from the phone records the answer only; taking the item out of Done is
 * left to the person, as the phone has no copy of the PC's reopen rules for milestones.
 *
 * Plain functions over anything shaped like a database, so this file imports no React Native code.
 */
import type { PlanningMilestoneStatus, SignOffKind, SignOffState } from '@shared/ostler-api'
import { capabilitiesOf } from '@shared/share-roles'
import { todayIsoDate } from '@shared/dates'
import { v4 as uuidv4 } from 'uuid'
import {
  optionalText,
  requiredText,
  targetDate
} from '../../../electron/services/planning-work-item-input'
import { guarded, type EditDb } from './edits'
import { shareRole, type QueryDb, type TaskSummary } from './queries'

const SUMMARY_COLUMNS = 'id, project_id, title, status, priority, target_date, assignee_id'

interface TaskSummaryRow {
  id: string
  project_id: string
  title: string
  status: TaskSummary['status']
  priority: TaskSummary['priority']
  target_date: string | null
  assignee_id: string | null
}

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

function listTasks(db: QueryDb, projectId: string, where: string, order: string): TaskSummary[] {
  return (
    db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM planning_work_items
         WHERE project_id = ? AND deleted_at IS NULL AND archived_at IS NULL
           AND resolution IS NULL AND ${where}
         ORDER BY ${order}`
      )
      .all(projectId) as TaskSummaryRow[]
  ).map(toSummary)
}

/** The tasks waiting in a project's To triage, the oldest capture first. */
export function triageTasks(db: QueryDb, projectId: string): TaskSummary[] {
  return listTasks(db, projectId, 'in_triage = 1', 'created_at, order_key')
}

/** A project's Someday tasks (hidden from the Board), in the Board's order. */
export function somedayTasks(db: QueryDb, projectId: string): TaskSummary[] {
  return listTasks(db, projectId, 'in_triage = 0 AND someday = 1', 'order_key')
}

export interface MilestoneSummary {
  id: string
  name: string
  outcome: string
  status: PlanningMilestoneStatus
  targetDate: string | null
  /** Its kept tasks (not binned, not won't do, not in triage) and how many of them are done. */
  total: number
  done: number
}

/** A project's milestones that are not archived: open ones by date (undated last), then complete. */
export function milestones(db: QueryDb, projectId: string): MilestoneSummary[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.name, m.outcome, m.status, m.target_date,
              COUNT(w.id) AS total,
              COALESCE(SUM(CASE WHEN w.status = 'done' THEN 1 ELSE 0 END), 0) AS done
       FROM planning_milestones m
       LEFT JOIN planning_work_items w ON w.milestone_id = m.id
         AND w.deleted_at IS NULL AND w.resolution IS NULL AND w.in_triage = 0
       WHERE m.project_id = ? AND m.status <> 'archived'
       GROUP BY m.id
       ORDER BY CASE WHEN m.status = 'complete' THEN 1 ELSE 0 END,
                m.target_date IS NULL, m.target_date, m.name`
    )
    .all(projectId) as {
    id: string
    name: string
    outcome: string
    status: PlanningMilestoneStatus
    target_date: string | null
    total: number
    done: number
  }[]
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    outcome: row.outcome,
    status: row.status,
    targetDate: row.target_date,
    total: Number(row.total),
    done: Number(row.done)
  }))
}

/** A milestone's kept tasks, in the Board's order (done ones too). */
export function milestoneTasks(db: QueryDb, milestoneId: string): TaskSummary[] {
  return (
    db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM planning_work_items
         WHERE milestone_id = ? AND deleted_at IS NULL AND resolution IS NULL AND in_triage = 0
         ORDER BY CASE WHEN status = 'done' THEN 1 ELSE 0 END, order_key`
      )
      .all(milestoneId) as TaskSummaryRow[]
  ).map(toSummary)
}

export interface DecisionSummary {
  id: string
  title: string
  decision: string
  context: string
  alternatives: string
  consequences: string
  date: string
}

/** A project's decisions, the newest first. */
export function decisions(db: QueryDb, projectId: string): DecisionSummary[] {
  const rows = db
    .prepare(
      `SELECT id, title, decision, context, alternatives_considered, consequences, date
       FROM planning_decisions WHERE project_id = ? ORDER BY date DESC, created_at DESC`
    )
    .all(projectId) as {
    id: string
    title: string
    decision: string
    context: string
    alternatives_considered: string
    consequences: string
    date: string
  }[]
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    decision: row.decision,
    context: row.context,
    alternatives: row.alternatives_considered,
    consequences: row.consequences,
    date: row.date
  }))
}

export interface SignOffSummary {
  id: string
  itemKind: SignOffKind
  itemId: string
  /** The task's, milestone's or decision's name; empty when it is no longer on the phone. */
  itemTitle: string
  approverName: string
  state: SignOffState
  note: string
  requestedAt: number
  /** Whether this phone's person is the approver and may answer it now. */
  canAnswer: boolean
}

function meId(db: QueryDb): string | null {
  const row = db.prepare('SELECT id FROM people WHERE is_me = 1').get() as
    { id: string } | undefined
  return row?.id ?? null
}

/** A project's sign-offs: waiting ones first, then answered ones, the newest first. */
export function signOffs(db: QueryDb, projectId: string): SignOffSummary[] {
  const me = meId(db)
  const mayAnswer = capabilitiesOf(shareRole(db, projectId)).answerSignOffs
  const rows = db
    .prepare(
      `SELECT s.id, s.item_kind, s.item_id, s.approver_person_id, s.state, s.note, s.requested_at,
              COALESCE(p.name, '') AS approver_name,
              COALESCE(w.title, m.name, d.title, '') AS item_title
       FROM planning_sign_offs s
       LEFT JOIN people p ON p.id = s.approver_person_id
       LEFT JOIN planning_work_items w ON s.item_kind = 'task' AND w.id = s.item_id
       LEFT JOIN planning_milestones m ON s.item_kind = 'milestone' AND m.id = s.item_id
       LEFT JOIN planning_decisions d ON s.item_kind = 'decision' AND d.id = s.item_id
       WHERE s.project_id = ?
       ORDER BY CASE WHEN s.state = 'waiting' THEN 0 ELSE 1 END, s.requested_at DESC`
    )
    .all(projectId) as {
    id: string
    item_kind: SignOffKind
    item_id: string
    approver_person_id: string
    state: SignOffState
    note: string
    requested_at: number
    approver_name: string
    item_title: string
  }[]
  return rows.map((row) => ({
    id: row.id,
    itemKind: row.item_kind,
    itemId: row.item_id,
    itemTitle: row.item_title,
    approverName: row.approver_name,
    state: row.state,
    note: row.note,
    requestedAt: row.requested_at,
    canAnswer: row.state === 'waiting' && mayAnswer && me !== null && row.approver_person_id === me
  }))
}

/** Why a sign-off answer was refused. */
export class SignOffRefused extends Error {
  constructor(readonly reason: 'not-found' | 'not-yours' | 'answered' | 'note-too-long') {
    super(reason)
  }
}

const MAX_NOTE = 2000

/** Answers a sign-off asked of this phone's person: approve, or send back with a note. */
export function answerSignOff(
  db: EditDb & QueryDb,
  id: string,
  answer: 'approved' | 'changes',
  note = '',
  now = Date.now()
): void {
  const row = db
    .prepare('SELECT project_id, approver_person_id, state FROM planning_sign_offs WHERE id = ?')
    .get(id) as { project_id: string; approver_person_id: string; state: SignOffState } | undefined
  if (!row) throw new SignOffRefused('not-found')
  const me = meId(db)
  if (me === null || row.approver_person_id !== me) throw new SignOffRefused('not-yours')
  if (!capabilitiesOf(shareRole(db, row.project_id)).answerSignOffs)
    throw new SignOffRefused('not-yours')
  if (row.state !== 'waiting') throw new SignOffRefused('answered')
  const text = answer === 'changes' ? note.trim() : ''
  if (text.length > MAX_NOTE) throw new SignOffRefused('note-too-long')
  db.prepare(
    'UPDATE planning_sign_offs SET state = ?, note = ?, answered_at = ?, updated_at = ? WHERE id = ?'
  ).run(answer, text, now, now, id)
}

export interface ProjectAttention {
  active: number
  overdue: number
  triage: number
  /** Sign-offs waiting for this phone's person. */
  signOffs: number
}

/** For each project, what wants a look: tasks in progress and overdue, triage and sign-offs. */
export function projectAttention(db: QueryDb, today: string): Map<string, ProjectAttention> {
  const result = new Map<string, ProjectAttention>()
  const entry = (projectId: string): ProjectAttention => {
    let found = result.get(projectId)
    if (!found) {
      found = { active: 0, overdue: 0, triage: 0, signOffs: 0 }
      result.set(projectId, found)
    }
    return found
  }
  const tasks = db
    .prepare(
      `SELECT project_id,
              SUM(CASE WHEN in_triage = 0 AND status = 'active' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN in_triage = 0 AND status <> 'done' AND target_date IS NOT NULL
                        AND target_date < ? THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN in_triage = 1 THEN 1 ELSE 0 END) AS triage
       FROM planning_work_items
       WHERE deleted_at IS NULL AND archived_at IS NULL AND resolution IS NULL
       GROUP BY project_id`
    )
    .all(today) as { project_id: string; active: number; overdue: number; triage: number }[]
  for (const row of tasks) {
    const found = entry(row.project_id)
    found.active = Number(row.active ?? 0)
    found.overdue = Number(row.overdue ?? 0)
    found.triage = Number(row.triage ?? 0)
  }
  const me = meId(db)
  if (me !== null) {
    const waiting = db
      .prepare(
        `SELECT project_id, COUNT(*) AS n FROM planning_sign_offs
         WHERE state = 'waiting' AND approver_person_id = ? GROUP BY project_id`
      )
      .all(me) as { project_id: string; n: number }[]
    for (const row of waiting) entry(row.project_id).signOffs = Number(row.n)
  }
  return result
}

/**
 * Adds a milestone to a project, as the PC's `createMilestone` does: planned, with no goal or
 * workstream, its text checked by the same rules. Returns its id.
 */
export function addMilestone(
  db: EditDb,
  projectId: string,
  input: { name: string; outcome?: string; targetDate?: string | null },
  now = Date.now()
): string {
  return guarded(() => {
    const id = uuidv4()
    db.prepare(
      `INSERT INTO planning_milestones
        (id, project_id, goal_id, name, outcome, target_date, success_criteria, status, created_at, updated_at, subproject_id)
       VALUES (?, ?, NULL, ?, ?, ?, '[]', 'planned', ?, ?, NULL)`
    ).run(
      id,
      projectId,
      requiredText(input.name, 'Milestone name', 160),
      optionalText(input.outcome, 'Milestone outcome', 4000),
      targetDate(input.targetDate ?? null),
      now,
      now
    )
    return id
  })
}

/**
 * Records a decision in a project, as the PC's `createDecision` does for a person: dated today
 * unless given a day, linked to no tasks. Returns its id.
 */
export function recordDecision(
  db: EditDb,
  projectId: string,
  input: {
    title: string
    decision: string
    context?: string
    alternatives?: string
    consequences?: string
    date?: string
  },
  now = Date.now()
): string {
  return guarded(() => {
    const id = uuidv4()
    db.prepare(
      `INSERT INTO planning_decisions
        (id, project_id, title, context, decision, alternatives_considered, consequences, date, linked_work_item_ids, origin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'human', ?, ?)`
    ).run(
      id,
      projectId,
      requiredText(input.title, 'Decision title', 200),
      optionalText(input.context, 'Decision context', 8000),
      requiredText(input.decision, 'Decision summary', 8000),
      optionalText(input.alternatives, 'Alternatives considered', 8000),
      optionalText(input.consequences, 'Consequences', 8000),
      targetDate(input.date) ?? todayIsoDate(),
      now,
      now
    )
    return id
  })
}

export interface GoalSummary {
  id: string
  title: string
  outcome: string
  status: string
  /** The measure, when the goal has one. */
  unit: string | null
  start: number | null
  target: number | null
  targetDate: string | null
  /** The latest check-in, when there is one. */
  latest: { date: string; value: number; note: string } | null
  milestoneCount: number
}

/** A project's goals with their latest check-in, open ones first. */
export function goals(db: QueryDb, projectId: string): GoalSummary[] {
  const rows = db
    .prepare(
      `SELECT g.id, g.title, g.outcome, g.status, g.measure_unit, g.measure_start_value,
              g.measure_target_value, g.measure_target_date,
              (SELECT COUNT(*) FROM planning_milestones m WHERE m.goal_id = g.id) AS milestones
       FROM planning_goals g WHERE g.project_id = ?
       ORDER BY CASE WHEN g.status <> 'active' THEN 1 ELSE 0 END,
                g.created_at`
    )
    .all(projectId) as {
    id: string
    title: string
    outcome: string
    status: string
    measure_unit: string | null
    measure_start_value: number | null
    measure_target_value: number | null
    measure_target_date: string | null
    milestones: number
  }[]
  const latest = db.prepare(
    'SELECT date, value, note FROM goal_check_ins WHERE goal_id = ? ORDER BY date DESC LIMIT 1'
  )
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    outcome: row.outcome,
    status: row.status,
    unit: row.measure_unit,
    start: row.measure_start_value,
    target: row.measure_target_value,
    targetDate: row.measure_target_date,
    latest:
      (latest.get(row.id) as { date: string; value: number; note: string } | undefined) ?? null,
    milestoneCount: Number(row.milestones)
  }))
}

/** Records today's reading of a goal's measure; one already on that day is replaced. */
export function recordGoalCheckIn(
  db: EditDb & QueryDb,
  goalId: string,
  value: number,
  date: string,
  note = '',
  now = Date.now()
): void {
  if (!Number.isFinite(value)) throw new Error('Enter a number')
  const goal = db.prepare('SELECT project_id FROM planning_goals WHERE id = ?').get(goalId) as
    { project_id: string } | undefined
  if (!goal) throw new Error('Goal not found')
  db.prepare(
    `INSERT INTO goal_check_ins
       (goal_id, project_id, date, value, note, recorded_at, recorded_by_kind, recorded_by_person_id)
     VALUES (?, ?, ?, ?, ?, ?, 'human', ?)
     ON CONFLICT (goal_id, date) DO UPDATE SET
       value = excluded.value, note = excluded.note, recorded_at = excluded.recorded_at,
       recorded_by_kind = excluded.recorded_by_kind,
       recorded_by_person_id = excluded.recorded_by_person_id`
  ).run(goalId, goal.project_id, date, value, note.slice(0, 500), now, meId(db))
}

// ─── Item links ─────────────────────────────────────────────────────────

export type LinkKind = 'task' | 'milestone' | 'decision' | 'library'

/** The current title of a linked item, or null when it is not on the phone (or was deleted). */
export function linkedItemTitle(db: QueryDb, kind: LinkKind, id: string): string | null {
  const sql =
    kind === 'task'
      ? 'SELECT title FROM planning_work_items WHERE id = ? AND deleted_at IS NULL'
      : kind === 'milestone'
        ? 'SELECT name AS title FROM planning_milestones WHERE id = ?'
        : kind === 'decision'
          ? 'SELECT title FROM planning_decisions WHERE id = ?'
          : kind === 'library'
            ? 'SELECT title FROM library_items WHERE id = ?'
            : null
  if (sql === null) return null
  const row = db.prepare(sql).get(id) as { title: string } | undefined
  return row?.title ?? null
}

export interface LinkTarget {
  kind: Exclude<LinkKind, 'library'>
  projectId: string
  id: string
  title: string
}

/** Items of a project a text can link to, whose title holds `filter`: tasks, milestones, decisions. */
export function linkTargets(
  db: QueryDb,
  projectId: string,
  filter: string,
  excludeId: string | null = null,
  limit = 12
): LinkTarget[] {
  const like = `%${filter.trim().replace(/[\%_]/g, (c) => `\${c}`)}%`
  const rows = db
    .prepare(
      `SELECT 'task' AS kind, id, title FROM planning_work_items
         WHERE project_id = ? AND deleted_at IS NULL AND title LIKE ? ESCAPE '\'
       UNION ALL
       SELECT 'milestone', id, name FROM planning_milestones
         WHERE project_id = ? AND name LIKE ? ESCAPE '\'
       UNION ALL
       SELECT 'decision', id, title FROM planning_decisions
         WHERE project_id = ? AND title LIKE ? ESCAPE '\'
       LIMIT ?`
    )
    .all(projectId, like, projectId, like, projectId, like, limit + 1) as {
    kind: LinkTarget['kind']
    id: string
    title: string
  }[]
  return rows
    .filter((row) => row.id !== excludeId)
    .slice(0, limit)
    .map((row) => ({ ...row, projectId }))
}

// ─── Row details for the task list ──────────────────────────────────────

export interface TaskRowDetails {
  labels: string[]
  /** Checklist lines ticked and in all; total 0 without a checklist. */
  checked: number
  checklist: number
  /** The assignee's initials, or null for nobody. */
  initials: string | null
  /** Open tasks it waits on. */
  waitingOn: number
  comments: number
}

function jsonList(text: string | null): string[] {
  try {
    const parsed = JSON.parse(text ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0][0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}

/** What each live task of a project shows on its row beyond its title, status and date. */
export function taskRowDetails(db: QueryDb, projectId: string): Map<string, TaskRowDetails> {
  const rows = db
    .prepare(
      `SELECT w.id, w.labels, w.acceptance_criteria, p.name AS assignee,
              (SELECT COUNT(*) FROM planning_checklist_checks c WHERE c.work_item_id = w.id) AS checked,
              (SELECT COUNT(*) FROM planning_dependencies d
                 JOIN planning_work_items o ON o.id = d.depends_on_id
                 WHERE d.work_item_id = w.id AND o.status <> 'done' AND o.deleted_at IS NULL
                   AND o.resolution IS NULL) AS waiting,
              (SELECT COUNT(*) FROM planning_comments m
                 WHERE m.work_item_id = w.id AND m.deleted_at IS NULL) AS comments
       FROM planning_work_items w LEFT JOIN people p ON p.id = w.assignee_id
       WHERE w.project_id = ? AND w.deleted_at IS NULL`
    )
    .all(projectId) as {
    id: string
    labels: string | null
    acceptance_criteria: string | null
    assignee: string | null
    checked: number
    waiting: number
    comments: number
  }[]
  const result = new Map<string, TaskRowDetails>()
  for (const row of rows) {
    const checklist = jsonList(row.acceptance_criteria).length
    result.set(row.id, {
      labels: jsonList(row.labels),
      checklist,
      checked: Math.min(Number(row.checked), checklist),
      initials: row.assignee ? initialsOf(row.assignee) : null,
      waitingOn: Number(row.waiting),
      comments: Number(row.comments)
    })
  }
  return result
}

const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const STATUS_RANK: Record<string, number> = {
  active: 0,
  review: 1,
  blocked: 2,
  ready: 3,
  backlog: 4,
  done: 5
}

/**
 * The order to tackle open tasks in: overdue first, then due within three days, then by
 * priority, then the soonest date, then work already under way before work not started.
 */
export function doFirstOrder<T extends TaskSummary>(tasks: T[], today: string): T[] {
  const soon = new Date(`${today}T00:00:00`)
  soon.setDate(soon.getDate() + 3)
  const soonIso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`
  const urgency = (task: T) =>
    task.targetDate === null ? 2 : task.targetDate < today ? 0 : task.targetDate <= soonIso ? 1 : 2
  return [...tasks].sort(
    (a, b) =>
      urgency(a) - urgency(b) ||
      (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
      (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999') ||
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
  )
}

/** Tasks by priority (critical first), keeping the given order within one priority. */
export function priorityOrder<T extends TaskSummary>(tasks: T[]): T[] {
  return [...tasks].sort(
    (a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
  )
}

/** Tasks by due date, soonest first, undated last. */
export function dueOrder<T extends TaskSummary>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999'))
}
