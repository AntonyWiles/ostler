import type Database from 'better-sqlite3'
import type {
  MyDayAddResult,
  MyDayLeftOver,
  MyDayPlacement,
  MyDayTask,
  PlanningActor,
  WatchedProject
} from '@shared/ostler-api'
import { MAX_MY_DAY_TASKS } from '@shared/ostler-api/home-types'
import { isIsoDate } from '@shared/dates'
import { Refusal } from '@shared/refusal'
import { hiddenReason } from '@shared/planning/show-from'
import { MAX_ORDER_KEY_LENGTH, orderKeyBetween, spacedOrderKeys } from '@shared/planning/order-key'
import { availableNowSql, homeTaskColumns, toHomeTask, type HomeTaskRow } from './home-task-row'
import type { PlanningService } from './planning-service'

/**
 * My day (N1.4, decision N12): the tasks a person picked for a day, in their
 * order, stored as one row per day and task in `my_day_entries`. The app's
 * IPC and the automation API both come here, so the list reads and changes
 * the same way from every surface. Its order keys are its own: moving a task
 * in My day never changes its place on the Board (D31).
 */

/** A task leaves My day when it leaves Home: archived (Won't do too), in the bin, or hidden. */
const LIVE_TASK = `w.archived_at IS NULL AND w.deleted_at IS NULL AND ${availableNowSql('w')}`

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

/**
 * One day's list across `projects`, in order, in one query, with each task's
 * Home fields. Done tasks stay (ticked) until the day ends; archived, deleted
 * and hidden tasks are left out, and their entries are not an error.
 */
export function queryMyDay(
  db: Database.Database,
  projects: readonly WatchedProject[],
  day: string
): MyDayTask[] {
  if (projects.length === 0) return []
  const byId = new Map(projects.map((project) => [project.id, project]))
  const rows = db
    .prepare(
      `SELECT ${homeTaskColumns('w')}
       FROM my_day_entries e JOIN planning_work_items w ON w.id = e.work_item_id
       WHERE e.day = ? AND e.project_id IN (${placeholders(projects.length)}) AND ${LIVE_TASK}
       ORDER BY e.order_key, e.added_at`
    )
    .all(day, ...projects.map((project) => project.id), day) as HomeTaskRow[]
  return rows.map((row) => toHomeTask(row, byId.get(row.project_id)!))
}

/**
 * The next morning's offer: the unfinished entries of the last day before
 * `today` that had a list (yesterday, or earlier when there was none since),
 * leaving out those let go and those already in today's list. Null when
 * there is nothing to offer. Nothing moves until the person chooses.
 */
export function queryLeftOver(
  db: Database.Database,
  projects: readonly WatchedProject[],
  today: string
): MyDayLeftOver | null {
  if (projects.length === 0) return null
  const ids = projects.map((project) => project.id)
  const last = db
    .prepare(
      `SELECT MAX(day) AS day FROM my_day_entries
       WHERE day < ? AND project_id IN (${placeholders(ids.length)})`
    )
    .get(today, ...ids) as { day: string | null }
  if (!last.day) return null
  const byId = new Map(projects.map((project) => [project.id, project]))
  const rows = db
    .prepare(
      `SELECT ${homeTaskColumns('w')}
       FROM my_day_entries e JOIN planning_work_items w ON w.id = e.work_item_id
       WHERE e.day = ? AND e.project_id IN (${placeholders(ids.length)})
         AND e.released_at IS NULL AND w.status <> 'done' AND ${LIVE_TASK}
         AND NOT EXISTS (SELECT 1 FROM my_day_entries t
                         WHERE t.day = ? AND t.work_item_id = e.work_item_id)
       ORDER BY e.order_key, e.added_at`
    )
    .all(last.day, ...ids, today, today) as HomeTaskRow[]
  if (rows.length === 0) return null
  return { date: last.day, tasks: rows.map((row) => toHomeTask(row, byId.get(row.project_id)!)) }
}

export interface MyDayServiceDependencies {
  db: Database.Database
  planning: PlanningService
  /** Every project; the service keeps the enabled ones. */
  getProjects(): WatchedProject[]
}

/** A placement from a caller, checked: a date, and at most one neighbour. */
export function myDayPlacement(raw: unknown): MyDayPlacement {
  if (!raw || typeof raw !== 'object') throw new Refusal('Send a date for My day')
  const input = raw as Record<string, unknown>
  if (!isIsoDate(input.date)) throw new Refusal('date must use YYYY-MM-DD')
  const neighbour = (value: unknown, name: string): string | null => {
    if (value === undefined || value === null) return null
    if (typeof value !== 'string' || !value || value.length > 100)
      throw new Refusal(`${name} must be a task id`)
    return value
  }
  const beforeId = neighbour(input.beforeId, 'beforeId')
  const afterId = neighbour(input.afterId, 'afterId')
  if (beforeId && afterId) throw new Refusal('Send beforeId or afterId, not both')
  return { date: input.date, beforeId, afterId }
}

export class MyDayService {
  constructor(private readonly deps: MyDayServiceDependencies) {}

  private enabledProjects(projectId?: string): WatchedProject[] {
    const enabled = this.deps.getProjects().filter((project) => project.enabled)
    if (projectId === undefined) return enabled
    const project = enabled.find((candidate) => candidate.id === projectId)
    if (!project) throw new Refusal('Project not found or disabled')
    return [project]
  }

  /** One day's list, across every enabled project or only `projectId`'s tasks. */
  list(date: string, projectId?: string): MyDayTask[] {
    if (!isIsoDate(date)) throw new Refusal('date must use YYYY-MM-DD')
    return queryMyDay(this.deps.db, this.enabledProjects(projectId), date)
  }

  /** The keys of a day's entries in order, leaving out `skipId`. */
  private keys(date: string, skipId: string): { id: string; key: string; projectId: string }[] {
    return this.deps.db
      .prepare(
        `SELECT work_item_id AS id, order_key AS key, project_id AS projectId FROM my_day_entries
         WHERE day = ? AND work_item_id <> ? ORDER BY order_key, added_at`
      )
      .all(date, skipId) as { id: string; key: string; projectId: string }[]
  }

  /**
   * The key for a task placed at the end, or before or after another entry
   * of the same day. Keys that grew too long are spaced out again first.
   */
  private placeKey(placement: MyDayPlacement, workItemId: string, projectId?: string): string {
    let entries = this.keys(placement.date, workItemId)
    const neighbourId = placement.beforeId ?? placement.afterId ?? null
    let index = neighbourId ? entries.findIndex((entry) => entry.id === neighbourId) : -1
    if (neighbourId && (index === -1 || (projectId && entries[index].projectId !== projectId)))
      throw new Refusal('That task is not in My day for that date')
    const between = (): [string | null, string | null] => {
      if (!neighbourId) return [entries.at(-1)?.key ?? null, null]
      return placement.beforeId
        ? [entries[index - 1]?.key ?? null, entries[index].key]
        : [entries[index].key, entries[index + 1]?.key ?? null]
    }
    let key = orderKeyBetween(...between())
    if (key.length > MAX_ORDER_KEY_LENGTH) {
      const spaced = spacedOrderKeys(entries.length)
      const update = this.deps.db.prepare(
        'UPDATE my_day_entries SET order_key = ? WHERE day = ? AND work_item_id = ?'
      )
      entries.forEach((entry, i) => update.run(spaced[i], placement.date, entry.id))
      entries = entries.map((entry, i) => ({ ...entry, key: spaced[i] }))
      index = neighbourId ? entries.findIndex((entry) => entry.id === neighbourId) : -1
      key = orderKeyBetween(...between())
    }
    return key
  }

  /** The task, checked: it exists, is live, and its project is enabled (and `projectId` when named). */
  private task(workItemId: string, projectId?: string) {
    if (typeof workItemId !== 'string' || !workItemId) throw new Refusal('Send a task id')
    const item = this.deps.planning.getWorkItem(workItemId)
    this.enabledProjects(projectId ?? item.projectId)
    if (projectId !== undefined && item.projectId !== projectId)
      throw new Refusal('Task not found in this project')
    if (item.archivedAt || item.deletedAt) throw new Refusal('An archived task cannot join My day')
    return item
  }

  /**
   * Adds a task to a day's list, at the end or before or after another
   * entry. A task already there stays where it is. A hidden task (in
   * Someday, or shown from a later day) is brought back first, through the
   * normal update path, and the result says so.
   */
  add(
    workItemId: string,
    placement: MyDayPlacement,
    actor: PlanningActor,
    projectId?: string,
    now = Date.now()
  ): MyDayAddResult {
    const item = this.task(workItemId, projectId)
    const db = this.deps.db
    const result = db.transaction((): MyDayAddResult => {
      const existing = db
        .prepare('SELECT 1 FROM my_day_entries WHERE day = ? AND work_item_id = ?')
        .get(placement.date, item.id)
      if (existing)
        return { workItemId: item.id, date: placement.date, broughtBack: null, already: true }
      const count = db
        .prepare('SELECT COUNT(*) AS n FROM my_day_entries WHERE day = ?')
        .get(placement.date) as { n: number }
      if (count.n >= MAX_MY_DAY_TASKS)
        throw new Refusal(`My day holds at most ${MAX_MY_DAY_TASKS} tasks`)
      // A capture in To triage is accepted first (N4.3a); My day never accepts it.
      if (item.inTriage) throw new Refusal('Accept it from To triage first')
      const hidden = hiddenReason(
        { someday: item.someday ?? false, showFrom: item.showFrom ?? null },
        placement.date
      )
      // Both may hide it: Someday, and a show-from date after the day.
      if (item.someday) this.deps.planning.updateWorkItem(item.id, { someday: false }, actor)
      if (item.showFrom && item.showFrom > placement.date)
        this.deps.planning.updateWorkItem(item.id, { showFrom: null }, actor)
      db.prepare(
        `INSERT INTO my_day_entries (day, work_item_id, project_id, order_key, added_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        placement.date,
        item.id,
        item.projectId,
        this.placeKey(placement, item.id, projectId),
        now
      )
      return {
        workItemId: item.id,
        date: placement.date,
        broughtBack: hidden && hidden.kind !== 'triage' ? hidden.kind : null,
        already: false
      }
    })()
    if (!result.already) this.deps.planning.markChanged(item.projectId)
    return result
  }

  /** Moves a task within a day's list. Its place on the Board does not change. */
  move(workItemId: string, placement: MyDayPlacement, projectId?: string): void {
    const item = this.task(workItemId, projectId)
    const db = this.deps.db
    db.transaction(() => {
      const existing = db
        .prepare('SELECT 1 FROM my_day_entries WHERE day = ? AND work_item_id = ?')
        .get(placement.date, item.id)
      if (!existing) throw new Refusal('That task is not in My day for that date')
      db.prepare('UPDATE my_day_entries SET order_key = ? WHERE day = ? AND work_item_id = ?').run(
        this.placeKey(placement, item.id, projectId),
        placement.date,
        item.id
      )
    })()
    this.deps.planning.markChanged(item.projectId)
  }

  /**
   * Removes a task from a day's list; whether it was there. The task itself
   * does not change. A task id from another project (or none) removes nothing.
   */
  remove(workItemId: string, date: string, projectId?: string): boolean {
    if (!isIsoDate(date)) throw new Refusal('date must use YYYY-MM-DD')
    if (typeof workItemId !== 'string' || !workItemId) throw new Refusal('Send a task id')
    const ids = this.enabledProjects(projectId).map((project) => project.id)
    if (ids.length === 0) return false
    const result = this.deps.db
      .prepare(
        `DELETE FROM my_day_entries WHERE day = ? AND work_item_id = ?
           AND project_id IN (${placeholders(ids.length)})`
      )
      .run(date, workItemId, ...ids)
    if (result.changes > 0) this.deps.planning.markChanged(projectId ?? ids[0])
    return result.changes > 0
  }

  /**
   * Start my day: the day's list becomes exactly these tasks, in this order.
   * Tasks no longer picked leave it; hidden tasks are brought back.
   */
  start(date: string, workItemIds: unknown, actor: PlanningActor, now = Date.now()): MyDayTask[] {
    if (!isIsoDate(date)) throw new Refusal('date must use YYYY-MM-DD')
    if (!Array.isArray(workItemIds) || workItemIds.length > MAX_MY_DAY_TASKS)
      throw new Refusal(`Pick at most ${MAX_MY_DAY_TASKS} tasks`)
    const ids = [...new Set(workItemIds as string[])]
    const db = this.deps.db
    db.transaction(() => {
      const items = ids.map((id) => this.task(id))
      const projects = this.enabledProjects().map((project) => project.id)
      if (projects.length > 0)
        db.prepare(
          `DELETE FROM my_day_entries WHERE day = ? AND project_id IN (${placeholders(projects.length)})`
        ).run(date, ...projects)
      for (const item of items) this.add(item.id, { date }, actor, undefined, now)
      if (projects.length > 0) this.deps.planning.markChanged(projects[0])
    })()
    return this.list(date)
  }

  /**
   * Let them go: the next morning's offer of `date`'s unfinished tasks is
   * declined. The entries stay as that day's history, marked, and are not
   * offered again. Only `workItemIds` when named.
   */
  release(date: string, workItemIds?: string[], now = Date.now()): number {
    if (!isIsoDate(date)) throw new Refusal('date must use YYYY-MM-DD')
    if (workItemIds !== undefined && (!Array.isArray(workItemIds) || workItemIds.length > 500))
      throw new Refusal('Send a list of tasks')
    const ids = this.enabledProjects().map((project) => project.id)
    if (ids.length === 0 || workItemIds?.length === 0) return 0
    const only = workItemIds ? ` AND work_item_id IN (${placeholders(workItemIds.length)})` : ''
    const changes = this.deps.db
      .prepare(
        `UPDATE my_day_entries SET released_at = ?
         WHERE day = ? AND released_at IS NULL
           AND project_id IN (${placeholders(ids.length)})${only}`
      )
      .run(now, date, ...ids, ...(workItemIds ?? [])).changes
    if (changes > 0) this.deps.planning.markChanged(ids[0])
    return changes
  }
}
