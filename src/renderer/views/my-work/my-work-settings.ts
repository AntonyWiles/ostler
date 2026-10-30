import { EMPTY_TASK_FILTER, normalizeTaskFilter, type TaskFilter } from '@shared/task-filter'
import { isMyWorkColumnId, isMyWorkGroupBy, type MyWorkGroupBy } from '@shared/planning/my-work'
import type { SortKey } from '../../ui'

/**
 * What My work remembers (R3.1): its person, project, grouping, sort and
 * filters. A per-viewer convenience in localStorage, as `last-view.ts`
 * remembers views, not data: when storage is unavailable My work opens on Me,
 * grouped by due date.
 */
export interface MyWorkSettings {
  /** Null for Me, whoever Me is now. */
  personId: string | null
  /** Null for every project. */
  projectId: string | null
  groupBy: MyWorkGroupBy
  sort: SortKey[]
  filter: TaskFilter
  hideDone: boolean
}

export const MY_WORK_SETTINGS_KEY = 'ostler.myWork'

export function defaultMyWorkSettings(): MyWorkSettings {
  return {
    personId: null,
    projectId: null,
    groupBy: 'due',
    sort: [],
    filter: EMPTY_TASK_FILTER,
    hideDone: true
  }
}

/** Stored settings made safe: anything unknown falls back to its default. */
export function normalizeMyWorkSettings(value: unknown): MyWorkSettings {
  const fallback = defaultMyWorkSettings()
  if (!value || typeof value !== 'object') return fallback
  const raw = value as Record<string, unknown>
  const id = (entry: unknown) => (typeof entry === 'string' && entry ? entry : null)
  const sort = (Array.isArray(raw.sort) ? raw.sort : []).flatMap((entry) => {
    const key = entry as Partial<SortKey> | null
    return key &&
      isMyWorkColumnId(key.columnId) &&
      (key.direction === 'asc' || key.direction === 'desc')
      ? [{ columnId: key.columnId, direction: key.direction }]
      : []
  })
  return {
    personId: id(raw.personId),
    projectId: id(raw.projectId),
    groupBy: isMyWorkGroupBy(raw.groupBy) ? raw.groupBy : fallback.groupBy,
    sort,
    filter: raw.filter === undefined ? fallback.filter : normalizeTaskFilter(raw.filter),
    hideDone: typeof raw.hideDone === 'boolean' ? raw.hideDone : fallback.hideDone
  }
}

export function readMyWorkSettings(): MyWorkSettings {
  try {
    const stored = localStorage.getItem(MY_WORK_SETTINGS_KEY)
    return normalizeMyWorkSettings(stored ? JSON.parse(stored) : null)
  } catch {
    return defaultMyWorkSettings()
  }
}

export function writeMyWorkSettings(settings: MyWorkSettings): void {
  try {
    localStorage.setItem(MY_WORK_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // ignore -- see readMyWorkSettings
  }
}
