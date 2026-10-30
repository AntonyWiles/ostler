import type Database from 'better-sqlite3'
import { MAX_CUSTOM_COLUMNS } from '@shared/ostler-api'
import type {
  PlanningColumnSettings,
  PlanningCustomColumn,
  PlanningWorkItemStatus,
  UpdatePlanningColumnSettingsInput
} from '@shared/ostler-api'
import {
  AGENT_STATUSES,
  applyColumnChange,
  columnIdOfKey,
  columnKey,
  customColumns,
  HIDEABLE_STATUSES
} from '@shared/board-columns'
import { TASK_STATUSES, taskStatusLabel } from '@shared/task-labels'
import { Refusal } from '@shared/refusal'
import { t } from '@shared/i18n'

interface ColumnRow {
  project_id: string
  /** A status, or `custom:<id>` for a column of the project's own (MOP-26). */
  status: string
  name: string
  hidden: number
  counts_as: string | null
  position: number
}

const COLUMN_COLUMNS = 'project_id, status, name, hidden, counts_as, position'

/** Whether Ready and In review must stay: agents are on and the project has a folder (D34). */
export interface ColumnRules {
  agentsLocked: boolean
}

/**
 * A project's Board columns (R2.4, D34): its own names and hidden columns,
 * one row per project and status beside the WIP limits. Every surface (the
 * app, the automation API, project files) changes them here, so the
 * refusals are the same everywhere: a column holding live tasks cannot
 * hide, and Ready and In review cannot hide while agents need them.
 */
export class PlanningColumns {
  constructor(
    private readonly db: Database.Database,
    private readonly projectIds: () => string[],
    private readonly changedAny: (projectId: string) => void
  ) {}

  private listener: ((projectId: string) => void) | null = null

  /** Called after a project's columns change, from any surface. */
  setChangedListener(listener: ((projectId: string) => void) | null): void {
    this.listener = listener
  }

  private changed(projectId: string): void {
    this.changedAny(projectId)
    try {
      this.listener?.(projectId)
    } catch (error) {
      console.error('Column settings change listener failed:', error)
    }
  }

  get(projectId: string): PlanningColumnSettings {
    if (!this.projectIds().includes(projectId)) throw new Refusal('Project not found')
    return this.read(projectId)
  }

  /** Every project's settings that differ from the standard ones, in one query. */
  all(): Record<string, PlanningColumnSettings> {
    const known = new Set(this.projectIds())
    const rows = this.db
      .prepare(`SELECT ${COLUMN_COLUMNS} FROM planning_column_settings`)
      .all() as ColumnRow[]
    const result: Record<string, PlanningColumnSettings> = {}
    for (const row of rows) {
      if (!known.has(row.project_id)) continue
      result[row.project_id] ??= { names: {}, hidden: [] }
      addRow(result[row.project_id], row)
    }
    for (const settings of Object.values(result)) sortHidden(settings)
    return result
  }

  /** A person's or the API's change, with D34's refusals. */
  update(
    projectId: string,
    change: UpdatePlanningColumnSettingsInput,
    rules: ColumnRules
  ): PlanningColumnSettings {
    const current = this.get(projectId)
    const next = applyColumnChange(current, change)
    this.checkCustomChange(projectId, current, next)
    for (const status of next.hidden) {
      if (current.hidden.includes(status)) continue
      if (rules.agentsLocked && AGENT_STATUSES.includes(status))
        throw new Refusal(
          t('errors:planningService.columnNeededByAgents', {
            column: taskStatusLabel(status, current)
          })
        )
      const count = this.liveTaskCount(projectId, status)
      if (count > 0)
        throw new Refusal(
          t('errors:planningService.columnHasTasks', {
            column: taskStatusLabel(status, current),
            count
          })
        )
    }
    this.write(projectId, next)
    return next
  }

  /**
   * Settings from a project file or template: names as given, and each
   * hidden column only where it could be hidden now (no live tasks in it,
   * not needed by agents). Never refuses, so a file always imports.
   */
  adopt(
    projectId: string,
    settings: UpdatePlanningColumnSettingsInput,
    rules: ColumnRules
  ): PlanningColumnSettings {
    const wanted = applyColumnChange({ names: {}, hidden: [] }, settings)
    const hidden = wanted.hidden.filter(
      (status) =>
        !(rules.agentsLocked && AGENT_STATUSES.includes(status)) &&
        this.liveTaskCount(projectId, status) === 0
    )
    // The project's own columns stay: a file brings its own in with `bringIn`.
    const custom = customColumns(this.read(projectId))
    const next: PlanningColumnSettings =
      custom.length > 0 ? { names: wanted.names, hidden, custom } : { names: wanted.names, hidden }
    this.write(projectId, next)
    return next
  }

  /**
   * A project file's own columns (MOP-26), before its tasks: each joins the
   * project's, or is the one already there with its name and status. Never
   * refuses: a column that cannot come (its name taken by one counting as
   * another status, or no room) is null, and its tasks go to their status's
   * own column. Returns each column's id, in the order given.
   */
  bringIn(
    projectId: string,
    columns: readonly { name: string; countsAs: PlanningWorkItemStatus; hidden?: boolean }[]
  ): (string | null)[] {
    if (columns.length === 0) return []
    const current = this.read(projectId)
    const custom = [...customColumns(current)]
    const ids = columns.map((column) => {
      const lower = column.name.toLowerCase()
      const same = custom.find((other) => other.name.toLowerCase() === lower)
      if (same) return same.countsAs === column.countsAs ? same.id : null
      if (custom.length >= MAX_CUSTOM_COLUMNS) return null
      const added = {
        id: globalThis.crypto.randomUUID(),
        name: column.name,
        countsAs: column.countsAs,
        hidden: column.hidden === true
      }
      custom.push(added)
      return added.id
    })
    if (custom.length > customColumns(current).length)
      this.write(projectId, {
        ...current,
        custom: TASK_STATUSES.flatMap((status) =>
          custom.filter((column) => column.countsAs === status)
        )
      })
    return ids
  }

  /**
   * The refusals for a change to the project's own columns (MOP-26): a column
   * holding live tasks cannot hide or count as another status (its tasks
   * would change status unseen). A deleted column's tasks go back to the
   * column of the status it counted as, in `write`.
   */
  private checkCustomChange(
    projectId: string,
    current: PlanningColumnSettings,
    next: PlanningColumnSettings
  ): void {
    for (const column of customColumns(next)) {
      const before = customColumns(current).find((old) => old.id === column.id)
      if (!before) continue
      const count = () => this.liveTasksInColumn(projectId, column.id)
      if (before.countsAs !== column.countsAs && count() > 0)
        throw new Refusal(
          t('errors:planningService.customColumnHasTasks', { column: before.name, count: count() })
        )
      if (column.hidden && !before.hidden && count() > 0)
        throw new Refusal(
          t('errors:planningService.columnHasTasks', { column: before.name, count: count() })
        )
    }
  }

  /**
   * Shows Ready and In review again where they are hidden: agents were
   * turned on, or a folder was linked while they are on. Returns the
   * statuses it showed.
   */
  showAgentColumns(projectId: string): PlanningWorkItemStatus[] {
    const current = this.read(projectId)
    const shown = current.hidden.filter((status) => AGENT_STATUSES.includes(status))
    if (shown.length === 0) return []
    this.write(projectId, {
      names: current.names,
      hidden: current.hidden.filter((status) => !shown.includes(status)),
      ...(current.custom ? { custom: current.custom } : {})
    })
    return shown
  }

  /** A project's settings, unchecked: for readers inside the planning service. */
  read(projectId: string): PlanningColumnSettings {
    const rows = this.db
      .prepare(`SELECT ${COLUMN_COLUMNS} FROM planning_column_settings WHERE project_id = ?`)
      .all(projectId) as ColumnRow[]
    const settings: PlanningColumnSettings = { names: {}, hidden: [] }
    for (const row of rows) addRow(settings, row)
    return sortHidden(settings)
  }

  private write(projectId: string, settings: PlanningColumnSettings): void {
    const now = Date.now()
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM planning_column_settings WHERE project_id = ?').run(projectId)
      const insert = this.db.prepare(
        'INSERT INTO planning_column_settings (project_id, status, name, hidden, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      for (const status of TASK_STATUSES) {
        const name = settings.names[status] ?? ''
        const hidden = settings.hidden.includes(status)
        if (name || hidden) insert.run(projectId, status, name, hidden ? 1 : 0, now)
      }
      const custom = customColumns(settings)
      const insertCustom = this.db.prepare(
        'INSERT INTO planning_column_settings (project_id, status, name, hidden, counts_as, position, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      custom.forEach((column, position) =>
        insertCustom.run(
          projectId,
          columnKey(column.countsAs, column.id),
          column.name,
          column.hidden ? 1 : 0,
          column.countsAs,
          position,
          now
        )
      )
      // A deleted column's tasks are back in the column of their status.
      const kept = custom.map((column) => column.id)
      this.db
        .prepare(
          `UPDATE planning_work_items SET column_id = NULL
           WHERE project_id = ? AND column_id IS NOT NULL
             AND column_id NOT IN (SELECT value FROM json_each(?))`
        )
        .run(projectId, JSON.stringify(kept))
    })()
    this.changed(projectId)
  }

  /** Live tasks in a custom column that still counts as their status. */
  private liveTasksInColumn(projectId: string, columnId: string): number {
    return (
      this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM planning_work_items AS item
           JOIN planning_column_settings AS col
             ON col.project_id = item.project_id AND col.status = 'custom:' || item.column_id
           WHERE item.project_id = ? AND item.column_id = ? AND col.counts_as = item.status
             AND item.archived_at IS NULL AND item.deleted_at IS NULL`
        )
        .get(projectId, columnId) as { count: number }
    ).count
  }

  /** Live tasks: neither archived nor in the recycle bin. */
  private liveTaskCount(projectId: string, status: PlanningWorkItemStatus): number {
    return (
      this.db
        .prepare(
          'SELECT COUNT(*) AS count FROM planning_work_items WHERE project_id = ? AND status = ? AND archived_at IS NULL AND deleted_at IS NULL'
        )
        .get(projectId, status) as { count: number }
    ).count
  }
}

/** Custom columns as read, with their place, until `sortHidden` puts them in order. */
const placed = new WeakMap<PlanningCustomColumn, number>()

function addRow(settings: PlanningColumnSettings, row: ColumnRow): void {
  const id = columnIdOfKey(row.status)
  if (id !== null) {
    const countsAs = row.counts_as as PlanningWorkItemStatus
    if (!row.name || !TASK_STATUSES.includes(countsAs)) return
    const column = { id, name: row.name, countsAs, hidden: Boolean(row.hidden) }
    placed.set(column, row.position)
    ;(settings.custom ??= []).push(column)
    return
  }
  const status = row.status as PlanningWorkItemStatus
  if (!TASK_STATUSES.includes(status)) return
  if (row.name) settings.names[status] = row.name
  if (row.hidden && HIDEABLE_STATUSES.includes(status)) settings.hidden.push(status)
}

/** Hidden statuses in Board order, and the custom columns in theirs. */
function sortHidden(settings: PlanningColumnSettings): PlanningColumnSettings {
  settings.hidden = TASK_STATUSES.filter((status) => settings.hidden.includes(status))
  if (settings.custom) {
    const position = (column: PlanningCustomColumn) => placed.get(column) ?? 0
    settings.custom = TASK_STATUSES.flatMap((status) =>
      settings
        .custom!.filter((column) => column.countsAs === status)
        .sort((a, b) => position(a) - position(b))
    )
  }
  return settings
}
