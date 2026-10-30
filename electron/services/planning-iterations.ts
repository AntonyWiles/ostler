import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  CreatePlanningIterationInput,
  PlanningActor,
  PlanningIteration,
  PlanningIterationCarryOver,
  PlanningIterationDeletion,
  PlanningIterationFinish,
  PlanningIterationStatus,
  PlanningIterationSummary,
  UpdatePlanningIterationInput
} from '@shared/ostler-api'
import { compareIsoDates, isIsoDate } from '@shared/dates'
import {
  MAX_ITERATION_GOAL_LENGTH,
  MAX_ITERATION_NAME_LENGTH,
  nextIteration,
  overlappingIteration,
  sortIterations
} from '@shared/planning/iterations'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'

interface IterationRow {
  id: string
  project_id: string
  name: string
  start_date: string
  end_date: string
  goal: string
  status: PlanningIterationStatus
  summary: string | null
  finished_at: number | null
  created_at: number
  updated_at: number
}

interface MemberRow {
  id: string
  status: string
  estimate: number | null
  archived_at: number | null
}

/** What the iterations need from the planning service around them. */
export interface PlanningIterationsHost {
  requireProject(projectId: string): void
  changed(projectId: string): void
  /** Records a task's move between iterations in its history (the burn-down reads it). */
  recordMove(
    task: { id: string; projectId: string },
    from: string | null,
    to: string | null,
    actor: PlanningActor,
    at: number
  ): void
  /** Keeps the search index in step with a task whose row changed. */
  reindexTask(taskId: string): void
}

/**
 * Iterations (R6.1, D44), stored. The planning service owns this, so the
 * app, the project file and the automation API share one set of rules: a
 * project's iterations never overlap, one at a time is active, only an
 * active one finishes, and a finished one keeps its summary. Deleting one
 * takes its tasks out of it and nothing else; `restore` puts both back.
 */
export class PlanningIterations {
  constructor(
    private readonly db: Database.Database,
    private readonly host: PlanningIterationsHost
  ) {}

  /** A project's iterations, oldest first. */
  list(projectId: string): PlanningIteration[] {
    this.host.requireProject(projectId)
    return this.rows(projectId)
  }

  get(iterationId: string): PlanningIteration {
    const row = this.db
      .prepare('SELECT * FROM planning_iterations WHERE id = ?')
      .get(iterationId) as IterationRow | undefined
    if (!row) throw new Refusal(t('errors:planningIterations.notFound'))
    this.host.requireProject(row.project_id)
    return toIteration(row)
  }

  /** Refuses an id that is not one of this project's iterations. */
  requireInProject(iterationId: string, projectId: string): PlanningIteration {
    if (typeof iterationId !== 'string' || iterationId.length === 0)
      throw new Refusal(t('errors:planningIterations.notFound'))
    const iteration = this.get(iterationId)
    if (iteration.projectId !== projectId)
      throw new Refusal(t('errors:planningIterations.otherProject'))
    return iteration
  }

  create(
    projectId: string,
    input: CreatePlanningIterationInput,
    now = Date.now()
  ): PlanningIteration {
    this.host.requireProject(projectId)
    const iteration: PlanningIteration = {
      id: uuidv4(),
      projectId,
      name: requiredName(input?.name),
      ...dates(input?.startDate, input?.endDate),
      goal: goalText(input?.goal),
      status: 'planned',
      summary: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now
    }
    this.refuseOverlap(iteration)
    this.insert(iteration)
    this.host.changed(projectId)
    return iteration
  }

  update(
    iterationId: string,
    updates: UpdatePlanningIterationInput,
    now = Date.now()
  ): PlanningIteration {
    const current = this.get(iterationId)
    const input = updates ?? {}
    const range =
      input.startDate === undefined && input.endDate === undefined
        ? { startDate: current.startDate, endDate: current.endDate }
        : dates(input.startDate ?? current.startDate, input.endDate ?? current.endDate)
    const iteration: PlanningIteration = {
      ...current,
      ...range,
      name: input.name === undefined ? current.name : requiredName(input.name),
      goal: input.goal === undefined ? current.goal : goalText(input.goal),
      updatedAt: now
    }
    this.refuseOverlap(iteration)
    this.db
      .prepare(
        `UPDATE planning_iterations SET name = ?, start_date = ?, end_date = ?, goal = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        iteration.name,
        iteration.startDate,
        iteration.endDate,
        iteration.goal,
        now,
        iteration.id
      )
    this.host.changed(iteration.projectId)
    return iteration
  }

  /** Makes a planned iteration the active one; refused while another is active. */
  start(iterationId: string, now = Date.now()): PlanningIteration {
    const current = this.get(iterationId)
    if (current.status === 'active') return current
    if (current.status === 'finished') throw new Refusal(t('errors:planningIterations.finished'))
    const active = this.rows(current.projectId).find((iteration) => iteration.status === 'active')
    if (active)
      throw new Refusal(t('errors:planningIterations.anotherActive', { name: active.name }))
    this.db
      .prepare("UPDATE planning_iterations SET status = 'active', updated_at = ? WHERE id = ?")
      .run(now, iterationId)
    this.host.changed(current.projectId)
    return { ...current, status: 'active', updatedAt: now }
  }

  /**
   * Finishes the active iteration. Its unfinished tasks (live, not Done) go
   * to the next planned iteration or out of any, as the person chose; Done
   * and archived tasks stay in it. The summary is kept on the iteration.
   */
  finish(
    iterationId: string,
    carryOver: PlanningIterationCarryOver,
    actor: PlanningActor,
    now = Date.now()
  ): PlanningIterationFinish {
    const current = this.get(iterationId)
    if (carryOver !== 'next' && carryOver !== 'none')
      throw new Refusal(t('errors:planningIterations.carryOverInvalid'))
    if (current.status !== 'active') throw new Refusal(t('errors:planningIterations.notActive'))
    const next = carryOver === 'next' ? nextIteration(this.rows(current.projectId), current) : null
    if (carryOver === 'next' && !next) throw new Refusal(t('errors:planningIterations.noNext'))
    const members = this.members(iterationId)
    const done = members.filter((task) => task.status === 'done')
    // Archived tasks are history: they stay where they were.
    const carried = members.filter((task) => task.status !== 'done' && task.archived_at === null)
    const summary: PlanningIterationSummary = {
      doneCount: done.length,
      doneEstimate: total(done),
      carriedCount: carried.length,
      carriedEstimate: total(carried),
      carryOver,
      carriedToIterationId: next?.id ?? null
    }
    const target = next?.id ?? null
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE planning_iterations SET status = 'finished', summary = ?, finished_at = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(JSON.stringify(summary), now, now, iterationId)
      const move = this.db.prepare(
        'UPDATE planning_work_items SET iteration_id = ?, updated_at = ? WHERE id = ?'
      )
      for (const task of carried) {
        move.run(target, now, task.id)
        this.host.recordMove(
          { id: task.id, projectId: current.projectId },
          iterationId,
          target,
          actor,
          now
        )
        this.host.reindexTask(task.id)
      }
    })()
    this.host.changed(current.projectId)
    return {
      iteration: { ...current, status: 'finished', summary, finishedAt: now, updatedAt: now },
      movedTaskIds: carried.map((task) => task.id)
    }
  }

  /** Deletes an iteration; its tasks keep everything but the iteration. */
  delete(iterationId: string): PlanningIterationDeletion {
    const iteration = this.get(iterationId)
    const taskIds = (
      this.db
        .prepare('SELECT id FROM planning_work_items WHERE iteration_id = ?')
        .all(iterationId) as { id: string }[]
    ).map((row) => row.id)
    this.db.transaction(() => {
      // Not an edit: `updated_at` stays, so Undo leaves the tasks as they were.
      this.db
        .prepare('UPDATE planning_work_items SET iteration_id = NULL WHERE iteration_id = ?')
        .run(iterationId)
      this.db.prepare('DELETE FROM planning_iterations WHERE id = ?').run(iterationId)
    })()
    this.host.changed(iteration.projectId)
    return { iteration, taskIds }
  }

  /** Undo for `delete`: the iteration as it was, and its tasks back in it where they still have none. */
  restore(deletion: PlanningIterationDeletion): PlanningIteration {
    const iteration = deletion?.iteration
    if (!iteration || typeof iteration.id !== 'string')
      throw new Refusal(t('errors:planningIterations.notFound'))
    this.host.requireProject(iteration.projectId)
    if (this.db.prepare('SELECT 1 FROM planning_iterations WHERE id = ?').get(iteration.id))
      throw new Refusal(t('errors:planningIterations.alreadyRestored'))
    const restored: PlanningIteration = {
      ...iteration,
      name: requiredName(iteration.name),
      ...dates(iteration.startDate, iteration.endDate),
      goal: goalText(iteration.goal),
      status: (['planned', 'active', 'finished'] as const).includes(iteration.status)
        ? iteration.status
        : 'planned'
    }
    this.refuseOverlap(restored)
    if (
      restored.status === 'active' &&
      this.rows(restored.projectId).some((other) => other.status === 'active')
    )
      restored.status = 'planned'
    const taskIds = Array.isArray(deletion.taskIds)
      ? deletion.taskIds.filter((id) => typeof id === 'string')
      : []
    this.db.transaction(() => {
      this.insert(restored)
      const put = this.db.prepare(
        'UPDATE planning_work_items SET iteration_id = ? WHERE id = ? AND project_id = ? AND iteration_id IS NULL'
      )
      for (const id of taskIds) put.run(restored.id, id, restored.projectId)
    })()
    this.host.changed(restored.projectId)
    return restored
  }

  /**
   * Writes an iteration from a project file (P5.8) as it was, with a new id,
   * after the same checks as `create`. The caller maps the file's ref to it.
   */
  importIteration(
    projectId: string,
    input: CreatePlanningIterationInput & {
      status?: PlanningIterationStatus
      summary?: PlanningIterationSummary | null
    },
    now = Date.now()
  ): PlanningIteration {
    const iteration = this.create(projectId, input, now)
    const status = input.status === 'active' || input.status === 'finished' ? input.status : null
    if (!status) return iteration
    if (status === 'active') return this.start(iteration.id, now)
    const summary = input.summary ?? null
    this.db
      .prepare(
        "UPDATE planning_iterations SET status = 'finished', summary = ?, finished_at = ? WHERE id = ?"
      )
      .run(summary ? JSON.stringify(summary) : null, now, iteration.id)
    return { ...iteration, status: 'finished', summary, finishedAt: now }
  }

  /** When each task last joined an iteration, from its change history: the burn-down's scope. */
  joinedAt(projectId: string, iterationId: string): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT work_item_id AS id, MAX(at) AS at FROM planning_field_changes
         WHERE project_id = ? AND field = 'iteration' AND to_value = ?
         GROUP BY work_item_id`
      )
      .all(projectId, JSON.stringify(iterationId)) as { id: string; at: number }[]
    return new Map(rows.map((row) => [row.id, row.at]))
  }

  /** A cheap fingerprint of a project's iterations, for the report cache. */
  fingerprint(projectId: string): unknown {
    return this.db
      .prepare(
        'SELECT COUNT(*) AS count, MAX(updated_at) AS updated FROM planning_iterations WHERE project_id = ?'
      )
      .get(projectId)
  }

  private rows(projectId: string): PlanningIteration[] {
    const rows = this.db
      .prepare('SELECT * FROM planning_iterations WHERE project_id = ?')
      .all(projectId) as IterationRow[]
    return sortIterations(rows.map(toIteration))
  }

  private members(iterationId: string): MemberRow[] {
    return this.db
      .prepare(
        `SELECT id, status, estimate, archived_at FROM planning_work_items
         WHERE iteration_id = ? AND deleted_at IS NULL ORDER BY order_key`
      )
      .all(iterationId) as MemberRow[]
  }

  private refuseOverlap(iteration: PlanningIteration): void {
    const other = overlappingIteration(this.rows(iteration.projectId), iteration)
    if (other) throw new Refusal(t('errors:planningIterations.overlaps', { name: other.name }))
  }

  private insert(iteration: PlanningIteration): void {
    this.db
      .prepare(
        `INSERT INTO planning_iterations
           (id, project_id, name, start_date, end_date, goal, status, summary, finished_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        iteration.id,
        iteration.projectId,
        iteration.name,
        iteration.startDate,
        iteration.endDate,
        iteration.goal,
        iteration.status,
        iteration.summary ? JSON.stringify(iteration.summary) : null,
        iteration.finishedAt,
        iteration.createdAt,
        iteration.updatedAt
      )
  }
}

function total(tasks: MemberRow[]): number {
  return Math.round(tasks.reduce((sum, task) => sum + (task.estimate ?? 0), 0) * 100) / 100
}

function requiredName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) throw new Refusal(t('errors:planningIterations.nameRequired'))
  if (name.length > MAX_ITERATION_NAME_LENGTH)
    throw new Refusal(
      t('errors:planningIterations.nameTooLong', { max: MAX_ITERATION_NAME_LENGTH })
    )
  return name
}

function goalText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Refusal(t('errors:planningIterations.goalInvalid'))
  const goal = value.trim()
  if (goal.length > MAX_ITERATION_GOAL_LENGTH)
    throw new Refusal(
      t('errors:planningIterations.goalTooLong', { max: MAX_ITERATION_GOAL_LENGTH })
    )
  return goal
}

function dates(startDate: unknown, endDate: unknown): { startDate: string; endDate: string } {
  if (!isIsoDate(startDate) || !isIsoDate(endDate))
    throw new Refusal(t('errors:planningIterations.datesRequired'))
  if (compareIsoDates(endDate, startDate) < 0)
    throw new Refusal(t('errors:planningIterations.endBeforeStart'))
  return { startDate, endDate }
}

function toIteration(row: IterationRow): PlanningIteration {
  let summary: PlanningIterationSummary | null = null
  if (row.summary) {
    try {
      summary = JSON.parse(row.summary) as PlanningIterationSummary
    } catch {
      summary = null
    }
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    goal: row.goal,
    status: row.status,
    summary,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
