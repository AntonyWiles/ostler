import { useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import type { MenuContext, RendererProject } from '@shared/ostler-api'
import { isPrintableView } from '@shared/print-route'
import { useOstler } from '../context/OstlerContext'
import { useFeatures, viewContext } from '../navigation/features'
import { readLastView, readRecentProjects } from '../navigation/last-view'
import { parseAppPath } from '../navigation/paths'
import {
  GLOBAL_VIEWS,
  PROJECT_VIEWS,
  allProjectViews,
  projectViewToOpen,
  findProjectView,
  projectViews
} from '../navigation/registry'
import { projectViewKeys } from '../navigation/shortcuts'
import { useTitleWorkstream } from './title-workstream'

export interface WhereAmI {
  /** The open project, if any. */
  project: RendererProject | null
  /** The workstream the open project view is scoped to, by name, if any. */
  workstream?: string | null
  /** The open project's view, or the global page, as the glossary names it. */
  label: string | null
}

/**
 * Where the person is, from the path and the registry (P8.2): the title bar
 * shows it, and main hears it as the menu context, so the menu's Go list and
 * enabled items follow, and deep links are checked against the registry's
 * views. One source for both.
 */
export function useWhereAmI(): WhereAmI {
  const location = useLocation()
  const { projects } = useOstler()
  const features = useFeatures()
  const here = parseAppPath(location.pathname)
  const projectId = here && 'projectId' in here ? here.projectId : null
  const project = projectId ? (projects.find((entry) => entry.id === projectId) ?? null) : null
  const workstream = useTitleWorkstream()

  const { label, context } = useMemo(() => {
    const viewIds = PROJECT_VIEWS.map((view) => view.id)
    const recentProjectIds = readRecentProjects()
    if (!project || !here) {
      const page = here ? GLOBAL_VIEWS.find((view) => view.id === here.kind) : undefined
      const context: MenuContext = {
        project: null,
        views: [],
        viewIds,
        printable: false,
        recentProjectIds
      }
      return { label: page?.label ?? null, context }
    }
    const ctx = viewContext(features, project)
    const routeView = here.kind === 'project' ? here.view : null
    const viewId = projectViewToOpen(routeView, readLastView(project.id), ctx)
    const tabs = projectViews(ctx, 'tab')
    const context: MenuContext = {
      project: { id: project.id, name: project.name },
      views: allProjectViews(ctx).map((view) => {
        const keys = projectViewKeys(tabs.findIndex((tab) => tab.id === view.id))
        return keys ? { id: view.id, label: view.label, keys } : { id: view.id, label: view.label }
      }),
      viewIds,
      printable: isPrintableView(viewId),
      recentProjectIds
    }
    return { label: findProjectView(viewId)?.label ?? null, context }
  }, [project, here?.kind, here && 'view' in here ? here.view : null, features])

  const contextKey = JSON.stringify(context)
  useEffect(() => {
    void window.ostlerAPI.setMenuContext?.(context)
  }, [contextKey])

  return { project, workstream: project ? workstream : null, label }
}
