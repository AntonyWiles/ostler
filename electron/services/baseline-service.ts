import type Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import { isIsoDate } from '@shared/dates'
import { Refusal } from '@shared/refusal'
import {
  MAX_BASELINES,
  MAX_BASELINE_NAME,
  baselineName,
  compareBaseline,
  planItemDates,
  type Baseline,
  type BaselineComparison,
  type BaselineEntry,
  type BaselineWithEntries,
  type PlanItemDates
} from '@shared/planning/baselines'

interface BaselineRow {
  id: string
  project_id: string
  name: string
  saved_at: number
  task_count: number
  milestone_count: number
}

interface EntryRow {
  kind: 'task' | 'milestone'
  item_id: string
  start_date: string | null
  due_date: string | null
}

/** A baseline as the project file carries it: entries by the ids the caller has mapped. */
export interface StoredBaseline {
  name: string
  savedAt: number
  entries: BaselineEntry[]
}

const SELECT_BASELINES = `
  SELECT b.*,
    (SELECT COUNT(*) FROM planning_baseline_entries e WHERE e.baseline_id = b.id AND e.kind = 'task') AS task_count,
    (SELECT COUNT(*) FROM planning_baseline_entries e WHERE e.baseline_id = b.id AND e.kind = 'milestone') AS milestone_count
  FROM planning_baselines b`

/** Live tasks (not archived, not in the bin) and milestones (not archived): what a baseline copies. */
const LIVE_TASKS = `SELECT id, start_date, target_date FROM planning_work_items
  WHERE project_id = ? AND archived_at IS NULL AND deleted_at IS NULL ORDER BY created_at, rowid`
const LIVE_MILESTONES = `SELECT id, target_date FROM planning_milestones
  WHERE project_id = ? AND status <> 'archived' ORDER BY created_at, rowid`

const INSERT_ENTRY = `INSERT INTO planning_baseline_entries
  (baseline_id, project_id, kind, item_id, start_date, due_date) VALUES (?, ?, ?, ?, ?, ?)`

/**
 * Baselines (N7.4, N52). The desktop app and the automation API both read and
 * write through here, on the planning connection. Saving copies every live
 * task's and milestone's dates in one transaction with one prepared insert;
 * nothing later changes a baseline's entries, and deleting a task or
 * milestone keeps them.
 */
export class BaselineService {
  constructor(
    private readonly db: Database.Database,
    private readonly getProjectIds: () => string[],
    private readonly changed: (projectId: string) => void = () => {},
    private readonly now: () => number = Date.now
  ) {}

  /** The project's baselines, newest first, without their entries. */
  list(projectId: string): Baseline[] {
    this.requireProject(projectId)
    const rows = this.db
      .prepare(`${SELECT_BASELINES} WHERE b.project_id = ? ORDER BY b.saved_at DESC, b.rowid DESC`)
      .all(projectId) as BaselineRow[]
    return rows.map(toBaseline)
  }

  /** A baseline with every entry. */
  get(projectId: string, baselineId: unknown): BaselineWithEntries {
    this.requireProject(projectId)
    if (typeof baselineId !== 'string') throw new Refusal('Baseline not found')
    const row = this.db
      .prepare(`${SELECT_BASELINES} WHERE b.id = ? AND b.project_id = ?`)
      .get(baselineId, projectId) as BaselineRow | undefined
    if (!row) throw new Refusal('Baseline not found')
    const entries = this.db
      .prepare(
        `SELECT kind, item_id, start_date, due_date FROM planning_baseline_entries
         WHERE baseline_id = ? ORDER BY rowid`
      )
      .all(row.id) as EntryRow[]
    return {
      ...toBaseline(row),
      entries: entries.map((entry) => ({
        kind: entry.kind,
        itemId: entry.item_id,
        start: entry.start_date,
        due: entry.due_date
      }))
    }
  }

  /**
   * Saves a baseline of every live task's and milestone's dates. At the
   * limit of ten, `replaceId` names the one to delete to make room, in the
   * same transaction; without it the save is refused.
   */
  create(projectId: string, input: unknown): Baseline {
    this.requireProject(projectId)
    const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    for (const key of Object.keys(value)) {
      if (key !== 'name' && key !== 'replaceId') throw new Refusal(`A baseline has no field ${key}`)
    }
    const name = requireName(value.name)
    const replaceId = value.replaceId
    if (replaceId !== undefined && replaceId !== null) this.get(projectId, replaceId)
    const id = uuidv4()
    this.db.transaction(() => {
      if (typeof replaceId === 'string')
        this.db.prepare('DELETE FROM planning_baselines WHERE id = ?').run(replaceId)
      if (this.count(projectId) >= MAX_BASELINES)
        throw new Refusal(
          `A project keeps at most ${MAX_BASELINES} baselines: name one to delete in replaceId`
        )
      this.db
        .prepare(
          'INSERT INTO planning_baselines (id, project_id, name, saved_at) VALUES (?, ?, ?, ?)'
        )
        .run(id, projectId, name, this.now())
      const insert = this.db.prepare(INSERT_ENTRY)
      const tasks = this.db.prepare(LIVE_TASKS).all(projectId) as {
        id: string
        start_date: string | null
        target_date: string | null
      }[]
      for (const task of tasks)
        insert.run(id, projectId, 'task', task.id, day(task.start_date), day(task.target_date))
      const milestones = this.db.prepare(LIVE_MILESTONES).all(projectId) as {
        id: string
        target_date: string | null
      }[]
      for (const milestone of milestones)
        insert.run(id, projectId, 'milestone', milestone.id, null, day(milestone.target_date))
    })()
    this.changed(projectId)
    return this.get(projectId, id)
  }

  /** Renames a baseline; the baseline as it was and is. */
  rename(
    projectId: string,
    baselineId: unknown,
    input: unknown
  ): { before: Baseline; after: Baseline } {
    const before = this.get(projectId, baselineId)
    const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
    for (const key of Object.keys(value)) {
      if (key !== 'name') throw new Refusal(`Renaming a baseline has no field ${key}`)
    }
    const name = requireName(value.name)
    this.db.prepare('UPDATE planning_baselines SET name = ? WHERE id = ?').run(name, before.id)
    this.changed(projectId)
    return { before: withoutEntries(before), after: withoutEntries(this.get(projectId, before.id)) }
  }

  /** Deletes a baseline and its entries; `restore` with what it returns puts it back (Undo). */
  delete(projectId: string, baselineId: unknown): BaselineWithEntries {
    const baseline = this.get(projectId, baselineId)
    this.db.prepare('DELETE FROM planning_baselines WHERE id = ?').run(baseline.id)
    this.changed(projectId)
    return baseline
  }

  /** Undo of delete: the same baseline, id, time and entries. Refused at the limit. */
  restore(projectId: string, value: unknown): Baseline {
    this.requireProject(projectId)
    const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
    if (typeof raw.id !== 'string' || !raw.id) throw new Refusal('Baseline not found')
    const exists = this.db.prepare('SELECT 1 FROM planning_baselines WHERE id = ?').get(raw.id)
    if (exists) return this.get(projectId, raw.id)
    const name = requireName(raw.name)
    const savedAt =
      typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : this.now()
    const entries = parseEntries(raw.entries)
    this.db.transaction(() => {
      if (this.count(projectId) >= MAX_BASELINES)
        throw new Refusal(`A project keeps at most ${MAX_BASELINES} baselines`)
      this.insertBaseline(raw.id as string, projectId, { name, savedAt, entries })
    })()
    this.changed(projectId)
    return this.get(projectId, raw.id)
  }

  /** How today's plan compares with a baseline (`compareBaseline`, the one rule). */
  compare(projectId: string, baselineId: unknown): BaselineComparison {
    const baseline = this.get(projectId, baselineId)
    return compareBaseline(baseline, this.planDates(projectId))
  }

  /** Writes baselines from a project file into a new project, newest ten. Entry ids are already mapped. */
  importBaselines(projectId: string, baselines: StoredBaseline[]): void {
    const kept = [...baselines].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_BASELINES)
    this.db.transaction(() => {
      for (const baseline of kept) this.insertBaseline(uuidv4(), projectId, baseline)
    })()
  }

  /** Today's live plan, as `compareBaseline` reads it. */
  private planDates(projectId: string): PlanItemDates[] {
    const tasks = this.db.prepare(LIVE_TASKS).all(projectId) as {
      id: string
      start_date: string | null
      target_date: string | null
    }[]
    const milestones = this.db.prepare(LIVE_MILESTONES).all(projectId) as {
      id: string
      target_date: string | null
    }[]
    return planItemDates(
      tasks.map((task) => ({
        id: task.id,
        startDate: task.start_date,
        targetDate: task.target_date
      })),
      milestones.map((milestone) => ({ id: milestone.id, targetDate: milestone.target_date }))
    )
  }

  private insertBaseline(id: string, projectId: string, baseline: StoredBaseline): void {
    this.db
      .prepare(
        'INSERT INTO planning_baselines (id, project_id, name, saved_at) VALUES (?, ?, ?, ?)'
      )
      .run(id, projectId, baseline.name, baseline.savedAt)
    const insert = this.db.prepare(INSERT_ENTRY.replace('INSERT INTO', 'INSERT OR IGNORE INTO'))
    for (const entry of baseline.entries)
      insert.run(id, projectId, entry.kind, entry.itemId, day(entry.start), day(entry.due))
  }

  private count(projectId: string): number {
    return (
      this.db
        .prepare('SELECT COUNT(*) AS n FROM planning_baselines WHERE project_id = ?')
        .get(projectId) as { n: number }
    ).n
  }

  private requireProject(projectId: unknown): string {
    if (typeof projectId !== 'string' || !this.getProjectIds().includes(projectId)) {
      throw new Refusal('Project not found')
    }
    return projectId
  }
}

function requireName(value: unknown): string {
  const name = baselineName(value)
  if (name === null) throw new Refusal(`name must be text, 1 to ${MAX_BASELINE_NAME} characters`)
  return name
}

function day(value: string | null | undefined): string | null {
  return value && isIsoDate(value) ? value : null
}

/** Entries handed back for Undo, made safe: anything malformed is left out. */
function parseEntries(value: unknown): BaselineEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): BaselineEntry[] => {
    if (!raw || typeof raw !== 'object') return []
    const entry = raw as Record<string, unknown>
    if ((entry.kind !== 'task' && entry.kind !== 'milestone') || typeof entry.itemId !== 'string')
      return []
    return [
      {
        kind: entry.kind,
        itemId: entry.itemId,
        start: entry.kind === 'task' && typeof entry.start === 'string' ? day(entry.start) : null,
        due: typeof entry.due === 'string' ? day(entry.due) : null
      }
    ]
  })
}

function withoutEntries(baseline: BaselineWithEntries): Baseline {
  return {
    id: baseline.id,
    projectId: baseline.projectId,
    name: baseline.name,
    savedAt: baseline.savedAt,
    taskCount: baseline.taskCount,
    milestoneCount: baseline.milestoneCount
  }
}

function toBaseline(row: BaselineRow): Baseline {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    savedAt: row.saved_at,
    taskCount: row.task_count,
    milestoneCount: row.milestone_count
  }
}
