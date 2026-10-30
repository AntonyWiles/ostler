import type { OstlerAPI, SavedView, SavedViewConfig, SavedViewType } from '@shared/ostler-api'

/**
 * An in-memory saved views store with the same calls the app makes (P5.7),
 * so a view's state can be read back as the main process would hold it.
 */
export function fakeSavedViews(initial: SavedView[] = []) {
  const views: SavedView[] = [...initial]
  let next = 1
  const now = () => Date.now()
  const make = (
    projectId: string | null,
    viewType: SavedViewType,
    name: string,
    config: SavedViewConfig,
    isDefault: boolean
  ): SavedView => ({
    id: `view-${next++}`,
    projectId,
    name,
    viewType,
    config: JSON.parse(JSON.stringify(config)) as SavedViewConfig,
    position: views.length,
    isDefault,
    createdAt: now(),
    updatedAt: now()
  })
  const api: Partial<OstlerAPI> = {
    listSavedViews: async (projectId) => ({
      ok: true,
      value: views.filter((view) =>
        projectId === undefined
          ? !view.isDefault && view.projectId !== null
          : view.projectId === projectId
      )
    }),
    listSharedSavedViews: async (viewType) => ({
      ok: true,
      value: views.filter(
        (view) =>
          view.projectId === null &&
          !view.isDefault &&
          (viewType === undefined || view.viewType === viewType)
      )
    }),
    clearDefaultSavedView: async (projectId, viewType) => {
      const index = views.findIndex(
        (view) => view.projectId === projectId && view.viewType === viewType && view.isDefault
      )
      if (index === -1) return { ok: true, value: null }
      const [view] = views.splice(index, 1)
      return { ok: true, value: view }
    },
    getDefaultSavedView: async (projectId, viewType) => ({
      ok: true,
      value:
        views.find(
          (view) => view.projectId === projectId && view.viewType === viewType && view.isDefault
        ) ?? null
    }),
    setDefaultSavedView: async (projectId, viewType, config) => {
      const current = views.find(
        (view) => view.projectId === projectId && view.viewType === viewType && view.isDefault
      )
      if (current) {
        current.config = JSON.parse(JSON.stringify(config)) as SavedViewConfig
        return { ok: true, value: { ...current } }
      }
      const view = make(projectId, viewType, 'Default view', config, true)
      views.push(view)
      return { ok: true, value: view }
    },
    createSavedView: async (projectId, input) => {
      const view = make(projectId, input.viewType, input.name, input.config, false)
      views.push(view)
      return { ok: true, value: view }
    },
    updateSavedView: async (viewId, updates) => {
      const view = views.find((candidate) => candidate.id === viewId)
      if (!view) return { ok: false, error: 'Saved view not found' }
      Object.assign(view, JSON.parse(JSON.stringify(updates)) as object)
      return { ok: true, value: { ...view } }
    },
    deleteSavedView: async (viewId) => {
      const index = views.findIndex((candidate) => candidate.id === viewId)
      if (index === -1) return { ok: false, error: 'Saved view not found' }
      const [view] = views.splice(index, 1)
      return { ok: true, value: view }
    },
    restoreSavedView: async (view) => {
      views.push(view)
      return { ok: true, value: view }
    }
  }
  return {
    api,
    views,
    defaultOf: (projectId: string | null, viewType: SavedViewType) =>
      views.find(
        (view) => view.projectId === projectId && view.viewType === viewType && view.isDefault
      )
  }
}
