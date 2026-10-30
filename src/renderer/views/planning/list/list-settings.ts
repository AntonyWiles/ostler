import type { TaskViewSpec } from '../../../hooks/task-view-spec'
import {
  fieldColumnId,
  fieldIdOf,
  isListGroupBy,
  LIST_COLUMN_IDS,
  type ListColumnId,
  type ListColumnKey,
  type ListGroupBy
} from '@shared/planning/list'
import type { PlanningFieldDefinition } from '@shared/ostler-api'
import type { SortKey } from '../../../ui'

/**
 * The List view's own settings per project: which columns show, in what
 * order and how wide, the sort and the grouping. A per-viewer convenience in
 * localStorage, all projects under one key for the view. P5.7 turns these
 * into saved views: the shape is versioned so it can be read and migrated.
 */

export { LIST_COLUMN_IDS, type ListColumnId, type ListColumnKey } from '@shared/planning/list'

const DEFAULT_VISIBLE: readonly ListColumnId[] = ['title', 'status', 'assignee', 'due']

export interface ListColumnSetting {
  /** A built-in column, or a custom field's (`field:<id>`, R2.2). */
  id: ListColumnKey
  visible: boolean
  /** In px; null for the column's own width. */
  width: number | null
}

export interface ListViewSettings {
  /** Every column, in display order, shown or not. */
  columns: ListColumnSetting[]
  sort: SortKey[]
  groupBy: ListGroupBy
}

/** What is stored under `LIST_SETTINGS_KEY`. */
export interface StoredListSettings {
  version: 1
  projects: Record<string, ListViewSettings>
}

export const LIST_SETTINGS_KEY = 'ostler.viewSettings.list'

export function defaultListSettings(): ListViewSettings {
  return {
    columns: LIST_COLUMN_IDS.map((id) => ({
      id,
      visible: DEFAULT_VISIBLE.includes(id),
      width: null
    })),
    sort: [],
    groupBy: 'none'
  }
}

function isColumnId(value: unknown): value is ListColumnKey {
  return (
    (LIST_COLUMN_IDS as readonly unknown[]).includes(value) ||
    (typeof value === 'string' && fieldIdOf(value) !== null)
  )
}

/**
 * The settings for the project's fields as they are now (R2.2): a column for
 * a deleted field is dropped, and a new field gets a hidden column at the end.
 * Sorting and grouping by a deleted field are dropped too.
 */
export function withFieldColumns(
  settings: ListViewSettings,
  fields: readonly PlanningFieldDefinition[]
): ListViewSettings {
  const known = new Set(fields.map((field) => fieldColumnId(field.id)))
  const isKept = (id: string) => fieldIdOf(id) === null || known.has(id as `field:${string}`)
  const columns = settings.columns.filter((column) => isKept(column.id))
  for (const field of fields) {
    const id = fieldColumnId(field.id)
    if (!columns.some((column) => column.id === id))
      columns.push({ id, visible: false, width: null })
  }
  return {
    columns,
    sort: settings.sort.filter((key) => isKept(key.columnId)),
    groupBy: isKept(settings.groupBy) ? settings.groupBy : 'none'
  }
}

/**
 * Settings as stored, made safe: unknown columns dropped, missing ones added
 * at the end (shown if they show by default), the title always shown, and
 * sort keys only for known columns.
 */
export function normalizeListSettings(value: unknown): ListViewSettings {
  const fallback = defaultListSettings()
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Partial<Record<keyof ListViewSettings, unknown>>
  const seen = new Set<ListColumnKey>()
  const columns: ListColumnSetting[] = []
  for (const entry of Array.isArray(raw.columns) ? raw.columns : []) {
    const column = entry as Partial<ListColumnSetting>
    if (!isColumnId(column?.id) || seen.has(column.id)) continue
    seen.add(column.id)
    const width =
      typeof column.width === 'number' && Number.isFinite(column.width) && column.width > 0
        ? Math.round(column.width)
        : null
    columns.push({ id: column.id, visible: column.id === 'title' || !!column.visible, width })
  }
  for (const column of fallback.columns) {
    if (seen.has(column.id)) continue
    // The ID column (N9.8a) joins a List saved before it at the start, where it belongs.
    if (column.id === 'key') columns.unshift(column)
    else columns.push(column)
  }
  const sort = (Array.isArray(raw.sort) ? raw.sort : []).filter(
    (key): key is SortKey =>
      !!key &&
      isColumnId((key as SortKey).columnId) &&
      ((key as SortKey).direction === 'asc' || (key as SortKey).direction === 'desc')
  )
  return {
    columns,
    sort: sort.map(({ columnId, direction }) => ({ columnId, direction })),
    groupBy: isListGroupBy(raw.groupBy) ? raw.groupBy : fallback.groupBy
  }
}

/**
 * Whether a column shows: chosen, and for the ID column (N9.8a), only once
 * the project has a prefix to make IDs with. The List and its printout share it.
 */
export function isListColumnShown(
  column: ListColumnSetting,
  hasTaskIds: boolean,
  hasSubprojects = false
): boolean {
  return (
    column.visible &&
    (column.id !== 'key' || hasTaskIds) &&
    (column.id !== 'subproject' || hasSubprojects)
  )
}

/**
 * The List's state lives in its saved views (P5.7). `LIST_SETTINGS_KEY` is
 * where P5.3 kept it in localStorage; the first load moves it into the
 * project's default view.
 */
export const LIST_VIEW_SPEC: TaskViewSpec<ListViewSettings> = {
  normalize: normalizeListSettings,
  legacyKey: LIST_SETTINGS_KEY
}
