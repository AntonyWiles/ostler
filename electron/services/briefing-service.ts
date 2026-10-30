import type Database from 'better-sqlite3'
import {
  BRIEFING_TITLES,
  type ActorKind,
  type Briefing,
  type BriefingActorKind,
  type BriefingByActor,
  type BriefingList,
  type BriefingProject,
  type BriefingTask,
  type WatchedProject
} from '@shared/ostler-api'
import { toIsoDate } from '@shared/dates'
import type { AgentAttention } from './home-service'

export interface BriefingServiceDependencies {
  db: Database.Database
  /** Every project; the service keeps the enabled ones. */
  getProjects(): WatchedProject[]
  /** "Use AI agents" is on: agent runs, reviews and questions are told only then. */
  agentsOn(): boolean
  /** The harness's questions and reviews waiting now, for a project with a folder. */
  agentAttention(project: WatchedProject): AgentAttention | null
}

export interface BriefingQuery {
  since: number
  until: number
  /** Only these projects (the automation API's own); every enabled project when absent. */
  projectIds?: string[]
}

/** A row that names a task, its project and, for the by-actor lists, who did it. */
interface TaskRow {
  id: string
  project_id: string
  title: string
}

interface ActorRow extends TaskRow {
  actor_kind: ActorKind | null
  person_name: string | null
  rule_name: string | null
  import_batch_id?: string | null
}

/** The longest span a briefing covers: a year. Older records are history, not a briefing. */
const MAX_SPAN_MS = 366 * 24 * 60 * 60 * 1000

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(', ')
}

function grouped<Row extends { project_id: string }>(rows: Row[]): Map<string, Row[]> {
  const out = new Map<string, Row[]>()
  for (const row of rows) out.set(row.project_id, [...(out.get(row.project_id) ?? []), row])
  return out
}

/** A count and the first titles; `distinct` lists each task once (comments, reminders). */
export function briefingList(tasks: BriefingTask[], distinct = false): BriefingList {
  const seen = new Set<string>()
  const shown: BriefingTask[] = []
  for (const task of tasks) {
    if (shown.length >= BRIEFING_TITLES) break
    if (distinct && task.id !== null) {
      if (seen.has(task.id)) continue
      seen.add(task.id)
    }
    shown.push(task)
  }
  return { count: tasks.length, tasks: shown }
}

/** Who a row's change was by, as the briefing counts it: an import is its own actor. */
function briefingActor(row: ActorRow): { actor: BriefingActorKind; name: string | null } {
  if (row.import_batch_id) return { actor: 'import', name: null }
  switch (row.actor_kind) {
    case 'agent':
      return { actor: 'agent', name: null }
    case 'rule':
      return { actor: 'rule', name: row.rule_name }
    case 'automation':
      return { actor: 'automation', name: null }
    case 'ostler-ai':
      return { actor: 'ostler-ai', name: null }
    case 'system':
      return { actor: 'system', name: null }
    default:
      return { actor: 'person', name: row.person_name }
  }
}

/** Rows counted by who did them, the biggest group first, each with its first titles. */
export function byActor(rows: ActorRow[]): BriefingByActor[] {
  const groups = new Map<
    string,
    { actor: BriefingActorKind; name: string | null; rows: ActorRow[] }
  >()
  for (const row of rows) {
    const who = briefingActor(row)
    const key = `${who.actor}|${who.name ?? ''}`
    const group = groups.get(key) ?? { ...who, rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.values()]
    .map((group) => ({
      actor: group.actor,
      name: group.name,
      ...briefingList(group.rows.map((row) => ({ id: row.id, title: row.title })))
    }))
    .sort((a, b) => b.count - a.count || (a.name ?? a.actor).localeCompare(b.name ?? b.actor))
}

function isEmpty(project: BriefingProject): boolean {
  return (
    project.finished.length === 0 &&
    project.added.length === 0 &&
    project.comments.count === 0 &&
    project.overdue.count === 0 &&
    project.reminders.count === 0 &&
    project.runsFinished.count === 0 &&
    project.runsInReview.count === 0 &&
    project.questions === 0
  )
}

/**
 * Since you were last here (N1.6, decision N14): what happened in a span,
 * per enabled project, from Ostler's own records. One query per source across
 * every project, never one per task; projects with nothing are left out.
 * Nothing here guesses: every count is a row in the database or the harness.
 */
export class BriefingService {
  constructor(private readonly deps: BriefingServiceDependencies) {}

  build({ since, until, projectIds }: BriefingQuery): Briefing {
    if (!Number.isSafeInteger(since) || !Number.isSafeInteger(until) || since < 0) {
      throw new Error('since must be a time in milliseconds')
    }
    if (since >= until) return { since, until, projects: [] }
    const from = Math.max(since, until - MAX_SPAN_MS)
    const projects = this.deps
      .getProjects()
      .filter((project) => project.enabled && (!projectIds || projectIds.includes(project.id)))
    if (projects.length === 0) return { since, until, projects: [] }
    const ids = projects.map((project) => project.id)
    const db = this.deps.db
    const scope = `IN (${placeholders(ids)})`

    // The last time each task moved to done, when that was in the span and it is still done.
    const finished = grouped(
      db
        .prepare(
          `SELECT item.id, item.project_id, item.title, history.actor_kind, history.rule_name,
                  person.name AS person_name
           FROM planning_status_history history
           JOIN planning_work_items item ON item.id = history.work_item_id
           LEFT JOIN people person ON person.id = history.actor_person_id
           WHERE item.project_id ${scope} AND item.deleted_at IS NULL AND item.status = 'done'
             AND history.to_status = 'done' AND history.at >= ? AND history.at < ?
             AND history.sequence = (SELECT MAX(last.sequence) FROM planning_status_history last
               WHERE last.work_item_id = history.work_item_id AND last.to_status = 'done')
           ORDER BY history.at DESC`
        )
        .all(...ids, from, until) as ActorRow[]
    )
    const added = grouped(
      db
        .prepare(
          `SELECT item.id, item.project_id, item.title, item.import_batch_id, created.actor_kind,
                  json_extract(created.metadata, '$.rule') AS rule_name, person.name AS person_name
           FROM planning_work_items item
           LEFT JOIN planning_field_changes created
             ON created.work_item_id = item.id AND created.field = 'created'
           LEFT JOIN people person ON person.id = created.actor_person_id
           WHERE item.project_id ${scope} AND item.deleted_at IS NULL
             AND item.created_at >= ? AND item.created_at < ?
           ORDER BY item.created_at DESC, item.rowid DESC`
        )
        .all(...ids, from, until) as ActorRow[]
    )
    const comments = grouped(
      db
        .prepare(
          `SELECT item.id, comment.project_id, item.title
           FROM planning_comments comment
           JOIN planning_work_items item ON item.id = comment.work_item_id
           WHERE comment.project_id ${scope} AND comment.deleted_at IS NULL
             AND item.deleted_at IS NULL AND comment.created_at >= ? AND comment.created_at < ?
           ORDER BY comment.created_at DESC`
        )
        .all(...ids, from, until) as TaskRow[]
    )
    // Due dates are local days: one that passed is from the first day away to yesterday.
    const overdue = grouped(
      db
        .prepare(
          `SELECT id, project_id, title FROM planning_work_items
           WHERE project_id ${scope} AND archived_at IS NULL AND deleted_at IS NULL
             AND in_triage = 0 AND status <> 'done' AND target_date IS NOT NULL
             AND target_date >= ? AND target_date < ?
           ORDER BY target_date, title`
        )
        .all(...ids, toIsoDate(new Date(from)), toIsoDate(new Date(until))) as TaskRow[]
    )
    const reminders = grouped(
      db
        .prepare(
          `SELECT item.id, reminder.project_id, item.title
           FROM reminders reminder
           JOIN planning_work_items item ON item.id = reminder.work_item_id
           WHERE reminder.project_id ${scope} AND item.deleted_at IS NULL
             AND reminder.delivered_at >= ? AND reminder.delivered_at < ?
           ORDER BY reminder.delivered_at DESC`
        )
        .all(...ids, from, until) as TaskRow[]
    )
    const agentsOn = this.deps.agentsOn()
    const runs = agentsOn
      ? grouped(
          db
            .prepare(
              `SELECT session_id AS id, project_id, title FROM agent_runs
               WHERE project_id ${scope} AND ended_at >= ? AND ended_at < ?
               ORDER BY ended_at DESC`
            )
            .all(...ids, from, until) as TaskRow[]
        )
      : new Map<string, TaskRow[]>()

    const tasks = (rows: TaskRow[] | undefined) =>
      (rows ?? []).map((row) => ({ id: row.id, title: row.title }))
    const briefed = projects
      .map((project): BriefingProject => {
        const attention = agentsOn ? this.deps.agentAttention(project) : null
        return {
          projectId: project.id,
          projectName: project.name,
          projectColor: project.color,
          finished: byActor(finished.get(project.id) ?? []),
          added: byActor(added.get(project.id) ?? []),
          comments: briefingList(tasks(comments.get(project.id)), true),
          overdue: briefingList(tasks(overdue.get(project.id))),
          reminders: briefingList(tasks(reminders.get(project.id)), true),
          // A run is shown by its title; it opens the project's Agents view, not a task.
          runsFinished: briefingList(
            (runs.get(project.id) ?? []).map((row) => ({ id: null, title: row.title }))
          ),
          runsInReview: briefingList(
            (attention?.reviews ?? []).map((review) => ({ id: review.taskId, title: review.title }))
          ),
          questions: attention?.questions.length ?? 0
        }
      })
      .filter((project) => !isEmpty(project))
    return { since, until, projects: briefed }
  }
}
