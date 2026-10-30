import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { PlanningColumnSettings, PlanningWorkItemStatus } from '@shared/ostler-api'
import {
  STANDARD_COLUMNS,
  taskColumnKey,
  visibleColumnPlaces,
  visibleStatuses,
  type ColumnPlace
} from '@shared/board-columns'
import { taskColumnLabel, taskStatusLabel } from '@shared/task-labels'

/** A task as the column helpers read it. */
type ColumnTask = { status: PlanningWorkItemStatus; columnId?: string | null }

/**
 * Every project's Board columns (R2.4, D34), read once for the whole app in
 * one call, so Home, the Inbox and search show each task with its own
 * project's words. Main pushes `columns` when a project's change, from the
 * app or the automation API, and they are read again.
 */
interface ColumnsState {
  byProject: Record<string, PlanningColumnSettings>
  /** Puts a project's settings in at once, after the app changed them. */
  set: (projectId: string, settings: PlanningColumnSettings) => void
}

const ColumnsContext = createContext<ColumnsState>({ byProject: {}, set: () => {} })

/** The project the surrounding screen belongs to: a status with no project given uses its words. */
const CurrentProjectContext = createContext<string | null>(null)

export function ColumnsProvider({ children }: { children: ReactNode }) {
  const [byProject, setByProject] = useState<Record<string, PlanningColumnSettings>>({})

  const refresh = useCallback(async () => {
    const result = await window.ostlerAPI.getPlanningColumnSettings?.()
    if (result?.ok) setByProject(result.value)
  }, [])

  useEffect(() => {
    void refresh()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'columns' || update.field === 'projects') void refresh()
    })
  }, [refresh])

  const set = useCallback((projectId: string, settings: PlanningColumnSettings) => {
    setByProject((current) => ({ ...current, [projectId]: settings }))
  }, [])

  const value = useMemo(() => ({ byProject, set }), [byProject, set])
  return <ColumnsContext.Provider value={value}>{children}</ColumnsContext.Provider>
}

/** Marks everything inside as one project's: its statuses use that project's words. */
export function ProjectColumnsScope({
  projectId,
  children
}: {
  projectId: string
  children: ReactNode
}) {
  return (
    <CurrentProjectContext.Provider value={projectId}>{children}</CurrentProjectContext.Provider>
  )
}

/** A project's column settings: the one given, else the surrounding project's, else standard. */
export function useProjectColumns(projectId?: string | null): PlanningColumnSettings {
  const { byProject } = useContext(ColumnsContext)
  const current = useContext(CurrentProjectContext)
  const id = projectId ?? current
  return (id ? byProject[id] : undefined) ?? STANDARD_COLUMNS
}

/** Every project's settings, for screens that list tasks from many projects. */
export function useAllProjectColumns(): ColumnsState {
  return useContext(ColumnsContext)
}

export interface StatusWords {
  columns: PlanningColumnSettings
  /** A status's word in this project. */
  label: (status: PlanningWorkItemStatus) => string
  /** The statuses to offer, in Board order; `keep` stays even when hidden. */
  visible: (keep?: PlanningWorkItemStatus | null) => PlanningWorkItemStatus[]
  /**
   * The columns to offer a task (MOP-26), in Board order: every status's own
   * and the project's own columns; `keep` (a column key) stays even when hidden.
   */
  places: (keep?: string | null) => (ColumnPlace & { label: string })[]
  /** The column a task is in, as a key: its status, or `custom:<id>`. */
  keyOf: (item: ColumnTask) => string
  /** A task's status word: its own column's name, or its status's word. */
  taskLabel: (item: ColumnTask) => string
}

/** A project's status words and the statuses it shows. */
export function useStatusWords(projectId?: string | null): StatusWords {
  const columns = useProjectColumns(projectId)
  return useMemo(
    () => ({
      columns,
      label: (status) => taskStatusLabel(status, columns),
      visible: (keep) => visibleStatuses(columns, keep),
      places: (keep) => visibleColumnPlaces(columns, keep),
      keyOf: (item) => taskColumnKey(item, columns),
      taskLabel: (item) => taskColumnLabel(item, columns)
    }),
    [columns]
  )
}

/** A task's status word for tasks of many projects (MOP-26): its column's name in its project. */
export function useTaskStatusLabel(): (item: ColumnTask & { projectId: string }) => string {
  const { byProject } = useContext(ColumnsContext)
  return useCallback((item) => taskColumnLabel(item, byProject[item.projectId]), [byProject])
}

/** Labels for tasks of many projects: each task's own project's words. */
export function useStatusLabelFor(): (
  status: PlanningWorkItemStatus,
  projectId: string | null | undefined
) => string {
  const { byProject } = useContext(ColumnsContext)
  return useCallback(
    (status, projectId) => taskStatusLabel(status, projectId ? byProject[projectId] : null),
    [byProject]
  )
}
