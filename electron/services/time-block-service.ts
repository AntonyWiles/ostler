import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type {
  CreateTimeBlockInput,
  PlanningWorkItemStatus,
  TimeBlock,
  TimeBlocksQuery,
  UpdateTimeBlockInput,
  WatchedProject
} from '@shared/ostler-api'
import { isIsoDate, isoDaysBetween } from '@shared/dates'
import { Refusal } from '@shared/refusal'
import {
  MAX_BLOCKS_PER_TASK,
  MAX_BLOCK_RANGE_DAYS,
  cutAtMidnight,
  defaultBlockLength,
  isBlockLength,
  isBlockStart
} from '@shared/planning/time-blocks'
import type { PlanningService } from './planning-service'

/**
 * Time blocks (N3.4a, decision N28): time put aside for a task, stored in
 * `planning_time_blocks`. The app's IPC and the automation API both come
 * here, so a block reads and changes the same way from every surface. A
 * block is a plan: nothing here touches time entries (R2.3), and the timer
 * never changes a block.
 */

interface TimeBlockRow {
  id: string
  project_id: string
  work_item_id: string
  day: string
  start_minute: number
  length_minutes: number
  created_at: number
  title: string
  status: PlanningWorkItemStatus
}

/** A binned or archived task hides its blocks; deleting it for good removes them. */
const LIVE_TASK = 'w.deleted_at IS NULL AND w.archived_at IS NULL'

const COLUMNS = `b.id, b.project_id, b.work_item_id, b.day, b.start_minute, b.length_minutes,
  b.created_at, w.title, w.status`

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function toBlock(row: TimeBlockRow): TimeBlock {
  return {
    id: row.id,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    date: row.day,
    startMinute: row.start_minute,
    lengthMinutes: row.length_minutes,
    createdAt: row.created_at,
    title: row.title,
    status: row.status
  }
}

/** Blocks in a range across `projects`, in time order, in one query. */
export function queryTimeBlocks(
  db: Database.Database,
  projectIds: readonly string[],
  from: string,
  to: string,
  workItemId?: string
): TimeBlock[] {
  if (projectIds.length === 0) return []
  const task = workItemId ? ' AND b.work_item_id = ?' : ''
  const rows = db
    .prepare(
      `SELECT ${COLUMNS}
       FROM planning_time_blocks b JOIN planning_work_items w ON w.id = b.work_item_id
       WHERE b.day >= ? AND b.day <= ? AND b.project_id IN (${placeholders(projectIds.length)})
         AND ${LIVE_TASK}${task}
       ORDER BY b.day, b.start_minute, b.created_at`
    )
    .all(from, to, ...projectIds, ...(workItemId ? [workItemId] : [])) as TimeBlockRow[]
  return rows.map(toBlock)
}

export interface TimeBlockServiceDependencies {
  db: Database.Database
  planning: PlanningService
  /** Every project; the service keeps the enabled ones. */
  getProjects(): WatchedProject[]
}

export class TimeBlockService {
  constructor(private readonly deps: TimeBlockServiceDependencies) {}

  private enabledProjects(projectId?: string): WatchedProject[] {
    const enabled = this.deps.getProjects().filter((project) => project.enabled)
    if (projectId === undefined) return enabled
    const project = enabled.find((candidate) => candidate.id === projectId)
    if (!project) throw new Refusal('Project not found or disabled')
    return [project]
  }

  /** Blocks from `from` to `to`, across every enabled project or one, in one query. */
  list(query: TimeBlocksQuery): TimeBlock[] {
    if (!query || typeof query !== 'object') throw new Refusal('Send a range of dates')
    if (!isIsoDate(query.from) || !isIsoDate(query.to))
      throw new Refusal('from and to must use YYYY-MM-DD')
    const days = isoDaysBetween(query.from, query.to)
    if (days < 0) throw new Refusal('to must not be before from')
    if (days > MAX_BLOCK_RANGE_DAYS)
      throw new Refusal(`Ask for at most ${MAX_BLOCK_RANGE_DAYS} days at a time`)
    if (query.workItemId !== undefined && typeof query.workItemId !== 'string')
      throw new Refusal('workItemId must be a task id')
    const ids = this.enabledProjects(query.projectId).map((project) => project.id)
    return queryTimeBlocks(this.deps.db, ids, query.from, query.to, query.workItemId)
  }

  /** One block, or a refusal when it is not there (or not in `projectId`). */
  get(blockId: string, projectId?: string): TimeBlock {
    if (typeof blockId !== 'string' || !blockId || blockId.length > 100)
      throw new Refusal('Send a time block id')
    const ids = this.enabledProjects(projectId).map((project) => project.id)
    const row =
      ids.length === 0
        ? undefined
        : (this.deps.db
            .prepare(
              `SELECT ${COLUMNS}
               FROM planning_time_blocks b JOIN planning_work_items w ON w.id = b.work_item_id
               WHERE b.id = ? AND b.project_id IN (${placeholders(ids.length)}) AND ${LIVE_TASK}`
            )
            .get(blockId, ...ids) as TimeBlockRow | undefined)
    if (!row) throw new Refusal('Time block not found')
    return toBlock(row)
  }

  /** The task, checked: it exists, is live, and its project is enabled (and `projectId` when named). */
  private task(workItemId: unknown, projectId?: string) {
    if (typeof workItemId !== 'string' || !workItemId) throw new Refusal('Send a task id')
    const item = this.deps.planning.getWorkItem(workItemId)
    const [project] = this.enabledProjects(projectId ?? item.projectId)
    if (item.projectId !== project.id) throw new Refusal('Task not found in this project')
    if (item.archivedAt || item.deletedAt)
      throw new Refusal('An archived task cannot have time blocked')
    return { item, project }
  }

  /**
   * Blocks time for a task. Without a length, the task's estimate in hours
   * (else an hour), cut at midnight. `id` and `createdAt` are for undo only.
   */
  create(
    input: CreateTimeBlockInput,
    projectId?: string,
    now = Date.now(),
    restore?: { id: string; createdAt: number }
  ): TimeBlock {
    if (!input || typeof input !== 'object') throw new Refusal('Send a time block')
    const { item, project } = this.task(input.workItemId, projectId)
    if (!isIsoDate(input.date)) throw new Refusal('date must use YYYY-MM-DD')
    if (!isBlockStart(input.startMinute))
      throw new Refusal('startMinute must be a quarter hour from 0 to 1425')
    const length =
      input.lengthMinutes === undefined || input.lengthMinutes === null
        ? defaultBlockLength(item.estimate, project.estimateUnit ?? 'points', input.startMinute)
        : input.lengthMinutes
    if (!isBlockLength(length, input.startMinute))
      throw new Refusal('lengthMinutes must be whole quarter hours that end by midnight')
    const db = this.deps.db
    const id = restore?.id ?? uuidv4()
    db.transaction(() => {
      const count = db
        .prepare('SELECT COUNT(*) AS n FROM planning_time_blocks WHERE work_item_id = ?')
        .get(item.id) as { n: number }
      if (count.n >= MAX_BLOCKS_PER_TASK)
        throw new Refusal(`A task holds at most ${MAX_BLOCKS_PER_TASK} time blocks`)
      if (restore && db.prepare('SELECT 1 FROM planning_time_blocks WHERE id = ?').get(id))
        throw new Refusal('That time block is already there')
      db.prepare(
        `INSERT INTO planning_time_blocks
           (id, project_id, work_item_id, day, start_minute, length_minutes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        item.projectId,
        item.id,
        input.date,
        input.startMinute,
        length,
        restore?.createdAt ?? now
      )
    })()
    this.deps.planning.markChanged(item.projectId)
    return this.get(id)
  }

  /**
   * Moves a block or changes its length. A move without a length keeps the
   * length, cut at midnight.
   */
  update(blockId: string, updates: UpdateTimeBlockInput, projectId?: string): TimeBlock {
    const current = this.get(blockId, projectId)
    if (!updates || typeof updates !== 'object') throw new Refusal('Send what to change')
    const date = updates.date ?? current.date
    const start = updates.startMinute ?? current.startMinute
    if (!isIsoDate(date)) throw new Refusal('date must use YYYY-MM-DD')
    if (!isBlockStart(start)) throw new Refusal('startMinute must be a quarter hour from 0 to 1425')
    const length =
      updates.lengthMinutes === undefined
        ? cutAtMidnight(start, current.lengthMinutes)
        : updates.lengthMinutes
    if (!isBlockLength(length, start))
      throw new Refusal('lengthMinutes must be whole quarter hours that end by midnight')
    this.deps.db
      .prepare(
        'UPDATE planning_time_blocks SET day = ?, start_minute = ?, length_minutes = ? WHERE id = ?'
      )
      .run(date, start, length, current.id)
    this.deps.planning.markChanged(current.projectId)
    return this.get(current.id)
  }

  /** Removes a block; returns it, for undo. The task does not change. */
  remove(blockId: string, projectId?: string): TimeBlock {
    const current = this.get(blockId, projectId)
    this.deps.db.prepare('DELETE FROM planning_time_blocks WHERE id = ?').run(current.id)
    this.deps.planning.markChanged(current.projectId)
    return current
  }

  /**
   * Removes several blocks in one transaction (undo of Fill my day, N3.4b);
   * returns those removed. A block already gone is skipped.
   */
  removeMany(blockIds: unknown, projectId?: string): TimeBlock[] {
    if (!Array.isArray(blockIds) || blockIds.length > MAX_BLOCKS_PER_TASK * 5)
      throw new Refusal('Send a list of time block ids')
    const removed: TimeBlock[] = []
    this.deps.db.transaction(() => {
      for (const blockId of blockIds) {
        let block: TimeBlock
        try {
          block = this.get(blockId as string, projectId)
        } catch {
          continue
        }
        this.deps.db.prepare('DELETE FROM planning_time_blocks WHERE id = ?').run(block.id)
        removed.push(block)
      }
    })()
    for (const id of new Set(removed.map((block) => block.projectId)))
      this.deps.planning.markChanged(id)
    return removed
  }

  /** Undo of Remove: the same block back, with its id. */
  restore(block: TimeBlock): TimeBlock {
    if (!block || typeof block !== 'object') throw new Refusal('Send a time block')
    if (typeof block.id !== 'string' || !block.id || block.id.length > 100)
      throw new Refusal('Send a time block id')
    return this.create(
      {
        workItemId: block.workItemId,
        date: block.date,
        startMinute: block.startMinute,
        lengthMinutes: block.lengthMinutes
      },
      undefined,
      Date.now(),
      {
        id: block.id,
        createdAt: Number.isFinite(block.createdAt) ? block.createdAt : Date.now()
      }
    )
  }
}
