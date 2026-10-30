import {
  MAX_COLUMN_NAME_LENGTH,
  MAX_CUSTOM_COLUMNS,
  type PlanningColumnSettings,
  type PlanningCustomColumn,
  type PlanningWorkItemStatus,
  type UpdatePlanningColumnSettingsInput
} from './ostler-api'
import { Refusal } from './refusal'
import { customColumnOf, TASK_STATUSES, TASK_STATUS_LABELS, taskColumnLabel } from './task-labels'

/*
 * A project's Board columns (R2.4, D34). The six statuses stay fixed; a
 * project renames columns (display only) and hides Ready, Blocked or In
 * review. It may add columns of its own (MOP-26), each counting as one of
 * the six. Main applies the refusals (planning-columns.ts); these are the
 * pure rules every surface shares. Labels come from `taskStatusLabel` and,
 * for a task, `taskColumnLabel`.
 */

/** The prefix of a custom column's key: a status is its own key. */
const CUSTOM_KEY = 'custom:'

/** A column's key on the Board: the status, or `custom:<id>` for a column of the project's own. */
export function columnKey(status: PlanningWorkItemStatus, columnId?: string | null): string {
  return columnId ? `${CUSTOM_KEY}${columnId}` : status
}

/** The custom column id in a key, or null for a status's key. */
export function columnIdOfKey(key: string): string | null {
  return key.startsWith(CUSTOM_KEY) ? key.slice(CUSTOM_KEY.length) : null
}

/** A project's own columns, in Board order. */
export function customColumns(
  columns?: Pick<PlanningColumnSettings, 'custom'> | null
): PlanningCustomColumn[] {
  return columns?.custom ?? []
}

/**
 * Every column a project has, in Board order: each status (hidden ones
 * included) followed by the columns of its own that count as it.
 */
export function orderedColumns(
  columns?: Pick<PlanningColumnSettings, 'custom'> | null
): { status: PlanningWorkItemStatus; custom: PlanningCustomColumn | null }[] {
  return TASK_STATUSES.flatMap((status) => [
    { status, custom: null },
    ...customColumns(columns)
      .filter((column) => column.countsAs === status)
      .map((custom) => ({ status, custom }))
  ])
}

/** The columns a project may hide. Backlog, In progress and Done always show. */
export const HIDEABLE_STATUSES: readonly PlanningWorkItemStatus[] = ['ready', 'blocked', 'review']

/** The columns agents use: shown while agents are on and the project has a folder. */
export const AGENT_STATUSES: readonly PlanningWorkItemStatus[] = ['ready', 'review']

/** The standard columns: no names, nothing hidden. */
export const STANDARD_COLUMNS: PlanningColumnSettings = Object.freeze({
  names: Object.freeze({}),
  hidden: Object.freeze([]) as unknown as PlanningWorkItemStatus[]
})

export function isStatusHidden(
  status: PlanningWorkItemStatus,
  columns?: Pick<PlanningColumnSettings, 'hidden'> | null
): boolean {
  return columns?.hidden.includes(status) ?? false
}

/**
 * The statuses a project shows, in Board order, for pickers, filters, quick
 * add and the plan grid. `keep` stays even when hidden (a task's own status),
 * so a picker never loses the value it shows.
 */
export function visibleStatuses(
  columns?: Pick<PlanningColumnSettings, 'hidden'> | null,
  keep?: PlanningWorkItemStatus | null
): PlanningWorkItemStatus[] {
  return TASK_STATUSES.filter((status) => status === keep || !isStatusHidden(status, columns))
}

/**
 * Settings checked and tidied: names trimmed (blank goes), hidden kept to
 * the hideable statuses in Board order. Refuses a name that is too long or
 * a status that cannot hide.
 */
export function applyColumnChange(
  current: PlanningColumnSettings,
  change: UpdatePlanningColumnSettingsInput
): PlanningColumnSettings {
  if (!change || typeof change !== 'object') throw new Refusal('Column settings must be an object')
  const names: Partial<Record<PlanningWorkItemStatus, string>> = { ...current.names }
  if (change.names !== undefined) {
    if (!change.names || typeof change.names !== 'object' || Array.isArray(change.names))
      throw new Refusal('names must be an object of status: name')
    for (const [key, value] of Object.entries(change.names)) {
      const status = key as PlanningWorkItemStatus
      if (!TASK_STATUSES.includes(status)) throw new Refusal(`Unknown status: ${key}`)
      if (value !== null && typeof value !== 'string')
        throw new Refusal(`The name for ${key} must be text, or null for the standard word`)
      const name = (value ?? '').replace(/\s+/g, ' ').trim()
      if (name.length > MAX_COLUMN_NAME_LENGTH)
        throw new Refusal(`A column name can be up to ${MAX_COLUMN_NAME_LENGTH} characters`)
      if (name && name !== TASK_STATUS_LABELS[status]) names[status] = name
      else delete names[status]
    }
  }
  let hidden = current.hidden
  if (change.hidden !== undefined) {
    if (!Array.isArray(change.hidden)) throw new Refusal('hidden must be a list of statuses')
    for (const status of change.hidden) {
      if (!HIDEABLE_STATUSES.includes(status))
        throw new Refusal(
          `Only ready, blocked and review can be hidden; ${String(status)} always shows`
        )
    }
    hidden = TASK_STATUSES.filter((status) => change.hidden!.includes(status))
  }
  const custom =
    change.custom === undefined
      ? customColumns(current)
      : applyCustomChange(customColumns(current), change.custom)
  return custom.length > 0 ? { names, hidden, custom } : { names, hidden }
}

/** A new custom column's id. */
function newColumnId(): string {
  return globalThis.crypto.randomUUID()
}

/**
 * The project's own columns after a change (MOP-26): names tidied and
 * checked, each counting as one of the six statuses, no two with the same
 * name, and at most `MAX_CUSTOM_COLUMNS`. A known id keeps its column; an
 * unknown or missing one makes a new column.
 */
function applyCustomChange(
  current: readonly PlanningCustomColumn[],
  change: NonNullable<UpdatePlanningColumnSettingsInput['custom']>
): PlanningCustomColumn[] {
  if (!Array.isArray(change)) throw new Refusal('custom must be a list of columns')
  if (change.length > MAX_CUSTOM_COLUMNS)
    throw new Refusal(`A project can have up to ${MAX_CUSTOM_COLUMNS} columns of its own`)
  const known = new Set(current.map((column) => column.id))
  const seen = new Set<string>()
  const result = change.map((column) => {
    if (!column || typeof column !== 'object') throw new Refusal('Each column must be an object')
    if (typeof column.name !== 'string') throw new Refusal('A column needs a name')
    const name = column.name.replace(/\s+/g, ' ').trim()
    if (!name) throw new Refusal('A column needs a name')
    if (name.length > MAX_COLUMN_NAME_LENGTH)
      throw new Refusal(`A column name can be up to ${MAX_COLUMN_NAME_LENGTH} characters`)
    if (!TASK_STATUSES.includes(column.countsAs))
      throw new Refusal(`Unknown status for "${name}" to count as: ${String(column.countsAs)}`)
    const lower = name.toLowerCase()
    const clashes =
      seen.has(lower) ||
      TASK_STATUSES.some((status) => TASK_STATUS_LABELS[status].toLowerCase() === lower)
    if (clashes) throw new Refusal(`There is already a column called "${name}"`)
    seen.add(lower)
    const id = typeof column.id === 'string' && known.has(column.id) ? column.id : newColumnId()
    known.delete(id)
    return { id, name, countsAs: column.countsAs, hidden: column.hidden === true }
  })
  // Board order: grouped by the status each counts as, in the order given.
  return TASK_STATUSES.flatMap((status) => result.filter((column) => column.countsAs === status))
}

/**
 * The status a word names, for import: the project's own column name, the
 * standard word or the status id, ignoring case. Null when none matches.
 */
export function statusFromColumnWord(
  word: string,
  columns?: Pick<PlanningColumnSettings, 'names' | 'custom'> | null
): PlanningWorkItemStatus | null {
  const text = word.trim().toLowerCase()
  if (!text) return null
  const custom = customColumnFromWord(word, columns)
  if (custom) return custom.countsAs
  for (const status of TASK_STATUSES)
    if (columns?.names[status]?.trim().toLowerCase() === text) return status
  for (const status of TASK_STATUSES)
    if (status === text || TASK_STATUS_LABELS[status].toLowerCase() === text) return status
  return null
}

/** The project's own column (MOP-26) a word names, ignoring case, or null. */
export function customColumnFromWord(
  word: string,
  columns?: Pick<PlanningColumnSettings, 'custom'> | null
): PlanningCustomColumn | null {
  const text = word.trim().toLowerCase()
  if (!text) return null
  return customColumns(columns).find((column) => column.name.toLowerCase() === text) ?? null
}

/** A column a task can be in: a status's own, or a column of the project's own (MOP-26). */
export interface ColumnPlace {
  /** `columnKey`: the status, or `custom:<id>`. */
  key: string
  status: PlanningWorkItemStatus
  columnId: string | null
}

/**
 * The column a task is in on the Board. `status` is the status it shows
 * when that is not its own (a queued agent's run): then it is that status's
 * own column.
 */
export function taskColumnKey(
  item: { status: PlanningWorkItemStatus; columnId?: string | null },
  columns?: Pick<PlanningColumnSettings, 'custom'> | null,
  status: PlanningWorkItemStatus = item.status
): string {
  if (status !== item.status) return status
  return columnKey(status, customColumnOf(item, columns)?.id)
}

/** The column a key names, or null for a custom column the project no longer has. */
export function placeOfKey(
  key: string,
  columns?: Pick<PlanningColumnSettings, 'custom'> | null
): ColumnPlace | null {
  const id = columnIdOfKey(key)
  if (id === null)
    return TASK_STATUSES.includes(key as PlanningWorkItemStatus)
      ? { key, status: key as PlanningWorkItemStatus, columnId: null }
      : null
  const column = customColumns(columns).find((candidate) => candidate.id === id)
  return column ? { key, status: column.countsAs, columnId: id } : null
}

/**
 * The columns to offer a task, in Board order (every status picker): those
 * the project shows, and `keep` (the task's own key) even when hidden.
 */
export function visibleColumnPlaces(
  columns?: Pick<PlanningColumnSettings, 'names' | 'hidden' | 'custom'> | null,
  keep?: string | null
): (ColumnPlace & { label: string })[] {
  return orderedColumns(columns).flatMap(({ status, custom }) => {
    const key = columnKey(status, custom?.id)
    const hidden = custom ? custom.hidden : isStatusHidden(status, columns)
    if (hidden && key !== keep) return []
    const columnId = custom?.id ?? null
    return [{ key, status, columnId, label: taskColumnLabel({ status, columnId }, columns) }]
  })
}

/** Ready and In review stay while agents are on and the project has a folder (D34). */
export function agentColumnsLocked(agentsOn: boolean, hasFolder: boolean): boolean {
  return agentsOn && hasFolder
}
