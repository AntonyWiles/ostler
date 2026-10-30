import type {
  CreateSavedViewInput,
  SavedView,
  SavedViewConfig,
  SavedViewType,
  SearchOptions,
  UpdateSavedViewInput,
  WatchedProject
} from '@shared/ostler-api'
import type { PlanningService } from '../services/planning-service'
import { handleApi } from './handle-ipc'

export interface SearchHandlerDependencies {
  planningService: PlanningService
  /** Resolves an enabled project or throws: the access check. */
  getProject(projectId: string): WatchedProject
}

/**
 * Search and saved views (P5.7). Search reads every project; a saved view's
 * calls resolve its project first, as every planning call does.
 */
export function registerSearchHandlers({
  planningService,
  getProject
}: SearchHandlerDependencies): void {
  const views = planningService.views
  const ownView = (viewId: string): SavedView => {
    const view = views.get(viewId)
    if (view.projectId) getProject(view.projectId)
    return view
  }

  handleApi('search', async (_event, query: string, options?: SearchOptions) => {
    if (typeof query !== 'string') throw new Error('Search for some text')
    const safe: SearchOptions = options && typeof options === 'object' ? options : {}
    if (safe.projectId !== undefined) getProject(safe.projectId)
    return planningService.search.search(query, {
      projectId: safe.projectId,
      types: Array.isArray(safe.types) ? safe.types : undefined,
      limit: typeof safe.limit === 'number' ? safe.limit : undefined,
      includeArchived: safe.includeArchived === true
    })
  })
  handleApi('listSavedViews', async (_event, projectId?: string) => {
    if (projectId === undefined || projectId === null) return views.list()
    getProject(projectId)
    return views.list(projectId)
  })
  handleApi(
    'createSavedView',
    async (_event, projectId: string | null, input: CreateSavedViewInput) => {
      if (projectId !== null) getProject(projectId)
      return views.create(projectId, input)
    }
  )
  handleApi('updateSavedView', async (_event, viewId: string, updates: UpdateSavedViewInput) => {
    ownView(viewId)
    return views.update(viewId, updates)
  })
  handleApi('deleteSavedView', async (_event, viewId: string) => {
    ownView(viewId)
    return views.delete(viewId)
  })
  handleApi('restoreSavedView', async (_event, view: SavedView) => {
    if (view && typeof view.projectId === 'string') getProject(view.projectId)
    return views.restore(view)
  })
  handleApi(
    'getDefaultSavedView',
    async (_event, projectId: string | null, viewType: SavedViewType) => {
      if (projectId !== null) getProject(projectId)
      return views.getDefault(projectId, viewType)
    }
  )
  handleApi(
    'setDefaultSavedView',
    async (_event, projectId: string | null, viewType: SavedViewType, config: SavedViewConfig) => {
      if (projectId !== null) getProject(projectId)
      return views.setDefault(projectId, viewType, config)
    }
  )
  // All projects' views (projectId null): Customise board's "All projects".
  handleApi('listSharedSavedViews', async (_event, viewType?: SavedViewType) =>
    views.listShared(viewType ?? undefined)
  )
  handleApi(
    'clearDefaultSavedView',
    async (_event, projectId: string | null, viewType: SavedViewType) => {
      if (projectId !== null) getProject(projectId)
      return views.clearDefault(projectId, viewType)
    }
  )
}
