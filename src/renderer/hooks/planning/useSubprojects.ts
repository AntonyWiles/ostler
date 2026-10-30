import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PlanningSubproject } from '@shared/ostler-api'
import { SUBPROJECT_PARAM } from '../../navigation/paths'
import { isSubprojectScoped, type ProjectViewId } from '../../navigation/registry'
import { useOptionalSearchParams } from '../useOptionalSearchParams'

/**
 * A project's sub-projects (shown as workstreams) and the one a view is
 * scoped to. `subprojects` is all of them, archived ones included, in order;
 * `subprojectScope` is the one named by the address's `sub` parameter, or null
 * when there is none, it names nothing in this project, or `view` is one that shows the whole
 * project (`isSubprojectScoped`). Nothing else in the
 * workspace depends on this: a project without sub-projects gets an empty list.
 */
export function useSubprojects(projectId: string, view?: ProjectViewId) {
  const [loaded, setLoaded] = useState<{ projectId: string; list: PlanningSubproject[] } | null>(
    null
  )
  const [params] = useOptionalSearchParams()

  const load = useCallback(async () => {
    if (!projectId || typeof window.ostlerAPI?.listSubprojects !== 'function') return
    const result = await window.ostlerAPI.listSubprojects(projectId)
    if (result.ok) setLoaded({ projectId, list: result.value })
  }, [projectId])

  useEffect(() => {
    let active = true
    const run = () => {
      if (active) void load()
    }
    run()
    const unsubscribe =
      typeof window.ostlerAPI?.onProjectStateChange === 'function'
        ? window.ostlerAPI.onProjectStateChange((update) => {
            if (update.projectId === projectId && update.field === 'planning') run()
          })
        : () => {}
    return () => {
      active = false
      unsubscribe()
    }
  }, [load, projectId])

  const subprojects = useMemo(
    () => (loaded?.projectId === projectId ? loaded.list : []),
    [loaded, projectId]
  )
  const scopeId =
    view === undefined || isSubprojectScoped(view) ? params.get(SUBPROJECT_PARAM) : null
  const subprojectScope = useMemo(
    () => (scopeId ? (subprojects.find((sub) => sub.id === scopeId) ?? null) : null),
    [subprojects, scopeId]
  )
  return { subprojects, subprojectScope, reloadSubprojects: load }
}
