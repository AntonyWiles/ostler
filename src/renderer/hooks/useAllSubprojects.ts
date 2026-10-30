import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PlanningSubproject } from '@shared/ostler-api'
import { projectAndSubprojectName } from '@shared/subproject-label'

/**
 * The sub-projects (shown as workstreams) of every project in `projectIds`,
 * archived ones included, for surfaces that mix several projects. They are
 * planning data: each project's list is read over IPC and read again when that
 * project's planning data change. A project with none has no entry.
 */
export function useAllSubprojects(projectIds: readonly string[]): {
  /** Every project's sub-projects, in order. */
  byProject: ReadonlyMap<string, PlanningSubproject[]>
  /** A sub-project by its ID, or undefined for none or one not loaded yet. */
  subprojectById: (subprojectId: string | null | undefined) => PlanningSubproject | undefined
  /** "Project › Workstream" for a task, or just the project's name. */
  labelFor: (projectName: string, subprojectId: string | null | undefined) => string
} {
  const [lists, setLists] = useState<Record<string, PlanningSubproject[]>>({})
  const key = projectIds.join('\n')

  const reload = useCallback(async (projectId: string) => {
    if (typeof window.ostlerAPI?.listSubprojects !== 'function') return
    const result = await window.ostlerAPI.listSubprojects(projectId)
    if (!result.ok) return
    setLists((current) => ({ ...current, [projectId]: result.value }))
  }, [])

  useEffect(() => {
    for (const id of key ? key.split('\n') : []) void reload(id)
  }, [key, reload])

  useEffect(() => {
    if (typeof window.ostlerAPI?.onProjectStateChange !== 'function') return
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'planning') void reload(update.projectId)
    })
  }, [reload])

  const byProject = useMemo(() => {
    const known = new Set(key ? key.split('\n') : [])
    return new Map(Object.entries(lists).filter(([id, list]) => known.has(id) && list.length > 0))
  }, [lists, key])

  const byId = useMemo(() => {
    const map = new Map<string, PlanningSubproject>()
    for (const list of byProject.values()) for (const sub of list) map.set(sub.id, sub)
    return map
  }, [byProject])

  const subprojectById = useCallback(
    (subprojectId: string | null | undefined) =>
      subprojectId ? byId.get(subprojectId) : undefined,
    [byId]
  )
  const labelFor = useCallback(
    (projectName: string, subprojectId: string | null | undefined) =>
      projectAndSubprojectName(projectName, subprojectById(subprojectId)?.name ?? null),
    [subprojectById]
  )

  return { byProject, subprojectById, labelFor }
}
