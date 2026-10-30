import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PlanningSubproject } from '@shared/ostler-api'

/**
 * The live (unarchived) sub-projects, shown as workstreams, of each project
 * the sidebar lists, in order. A project with none has no entry. They are
 * planning data, so each project's list is read over IPC and read again when
 * that project's planning data change.
 */
export function useSidebarSubprojects(projectIds: readonly string[]): {
  byProject: ReadonlyMap<string, PlanningSubproject[]>
  reload: (projectId: string) => Promise<void>
} {
  const [lists, setLists] = useState<Record<string, PlanningSubproject[]>>({})
  const key = projectIds.join('\n')

  const reload = useCallback(async (projectId: string) => {
    if (typeof window.ostlerAPI?.listSubprojects !== 'function') return
    const result = await window.ostlerAPI.listSubprojects(projectId)
    if (!result.ok) return
    const live = result.value.filter((sub) => sub.archivedAt === null)
    setLists((current) => ({ ...current, [projectId]: live }))
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

  return { byProject, reload }
}
