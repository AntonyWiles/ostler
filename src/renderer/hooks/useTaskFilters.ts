import { useEffect, useRef, useState } from 'react'
import type { TaskContactMarks } from '@shared/contacts'
import { useOptionalSearchParams } from './useOptionalSearchParams'
import type {
  PlanningWorkItem,
  PlanningWorkItemStatus,
  SavedView,
  SavedViewConfig,
  SavedViewType
} from '@shared/ostler-api'
import {
  EMPTY_TASK_FILTER,
  effectiveFilter,
  matchesFilter,
  normalizeTaskFilter,
  parseTaskFilter,
  type TaskFilter,
  type TaskFilterContext
} from '@shared/task-filter'
import { todayIsoDate } from '@shared/dates'
import { matchingTasks } from '@shared/task-view-filter'
import { unwrapResult } from '../utils/unwrap-result'
import { useToast } from '../ui'
import type { TaskViewSpec } from './task-view-spec'
import { t } from '@shared/i18n'

/**
 * A task view's state (P5.7): its filter, the search box, Hide done and its
 * own options (sort, grouping, columns, zoom…), and the saved views it can
 * switch between. The Board, List, Calendar and Timeline all hold their
 * state here, so there is one place for it: the project's default saved view
 * for that view type, kept as the person changes it. A named saved view is
 * changed only by "Update".
 *
 * Views for all projects (`projectId` null) sit beside the project's own: a
 * named one is offered in every project, and the default one is what a
 * project's default view shows until the project keeps one of its own. "Reset
 * to default" removes the project's, so it follows the all-projects default
 * again, and that one falls back to the standard settings.
 *
 * Before P5.7 the List, Calendar and Timeline kept their options in
 * localStorage; the first load moves a project's entry into its default view
 * (`legacyKey`) and removes it.
 */

/** Where a view's Hide done lives inside its options. */
const HIDE_DONE = 'hideDone'

export type { TaskViewSpec } from './task-view-spec'

/** Where a saved view lives: this project, or every project. */
export type SavedViewScope = 'project' | 'allProjects'

/** What the default view shows: the project's own, the all-projects default, or the standard. */
export type DefaultViewSource = 'project' | 'allProjects' | 'standard'

export interface TaskView<O extends object> {
  filter: TaskFilter
  setFilter: (filter: TaskFilter) => void
  query: string
  setQuery: (query: string) => void
  hideDone: boolean
  setHideDone: (hideDone: boolean) => void
  /** A filter condition or search text is set (Hide done is a view option). */
  isFiltered: boolean
  /** Clears the filter and the search; Hide done stays. */
  clear: () => void
  options: O
  setOptions: (patch: Partial<O>) => void
  /** The named saved views of this view type, the project's then all projects', in order. */
  views: SavedView[]
  /** The named view showing, or null for the default view. */
  activeView: SavedView | null
  /** The named view showing differs from what was saved. */
  isChanged: boolean
  loaded: boolean
  selectView: (viewId: string | null) => void
  /** Saves what is showing as a new named view, in this project unless `scope` says all. */
  saveAs: (name: string, scope?: SavedViewScope) => Promise<void>
  updateActive: () => Promise<void>
  /** Puts back the named view showing as it was saved. */
  revert: () => void
  rename: (viewId: string, name: string) => Promise<void>
  remove: (viewId: string) => Promise<void>
  /** Makes what is showing what this view opens with in the project. */
  setAsDefault: () => Promise<void>
  /** What the default view shows now (see `DefaultViewSource`). */
  defaultSource: DefaultViewSource
  /** An all-projects default is kept for this view type. */
  hasAllProjectsDefault: boolean
  /** Forgets the project's own default: it follows the all-projects default again. */
  resetDefault: () => Promise<void>
  /** Makes what is showing what this view opens with in every project without its own. */
  setAsAllProjectsDefault: () => Promise<void>
  /** Forgets the all-projects default: projects without their own show the standard settings. */
  resetAllProjectsDefault: () => Promise<void>
}

interface Working<O> {
  filter: TaskFilter
  query: string
  hideDone: boolean
  options: O
}

function fromConfig<O extends object>(
  config: SavedViewConfig | undefined,
  normalize: (raw: unknown) => O
): Working<O> {
  const options = (config?.options ?? {}) as Record<string, unknown>
  return {
    filter: normalizeTaskFilter(config?.filter ?? EMPTY_TASK_FILTER),
    query: typeof config?.query === 'string' ? config.query : '',
    hideDone: options[HIDE_DONE] === true,
    options: normalize(options)
  }
}

function toConfig<O extends object>(working: Working<O>, keepQuery: boolean): SavedViewConfig {
  return {
    filter: working.filter,
    query: keepQuery ? working.query : '',
    options: { ...(working.options as Record<string, unknown>), [HIDE_DONE]: working.hideDone }
  }
}

const same = (a: SavedViewConfig, b: SavedViewConfig) => JSON.stringify(a) === JSON.stringify(b)

/** Takes a project's pre-P5.7 settings out of localStorage, once. */
function takeLegacy(key: string | undefined, projectId: string): unknown {
  if (!key) return undefined
  try {
    const store = JSON.parse(localStorage.getItem(key) ?? 'null') as {
      version?: number
      projects?: Record<string, unknown>
    } | null
    const entry = store?.projects?.[projectId]
    if (entry === undefined || !store?.projects) return undefined
    delete store.projects[projectId]
    if (Object.keys(store.projects).length === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(store))
    return entry
  } catch {
    return undefined
  }
}

export function useTaskView<O extends object>(
  projectId: string,
  viewType: SavedViewType,
  spec: TaskViewSpec<O>
): TaskView<O> {
  const { toastUndo } = useToast()
  const [params, setParams] = useOptionalSearchParams()
  const requested = params.get('view')
  const owner = `${projectId}:${viewType}`
  const specRef = useRef(spec)
  specRef.current = spec
  const blank = () => fromConfig(undefined, specRef.current.normalize)

  const fresh = () => ({
    owner,
    loaded: false,
    touched: false,
    views: [] as SavedView[],
    /** The named views for all projects of this type. */
    sharedViews: [] as SavedView[],
    /** The project's own default view, or null while it follows the all-projects one. */
    defaultConfig: null as SavedViewConfig | null,
    /** The all-projects default, or null for the standard settings. */
    sharedDefault: null as SavedViewConfig | null,
    activeId: null as string | null,
    working: blank()
  })
  const [state, setState] = useState(fresh)
  // Another project or view: start again (state adjusted during render).
  if (state.owner !== owner) setState(fresh())
  const current = state.owner === owner ? state : { ...state, loaded: false, working: blank() }

  const lastWritten = useRef<string | null>(null)

  // Load the default view and the saved views.
  useEffect(() => {
    lastWritten.current = null
    if (!projectId) return
    let cancelled = false
    void (async () => {
      try {
        const [defaultView, all, shared] = await Promise.all([
          window.ostlerAPI.getDefaultSavedView(projectId, viewType).then(unwrapResult),
          window.ostlerAPI.listSavedViews(projectId).then(unwrapResult),
          loadShared(viewType)
        ])
        let defaultConfig = defaultView?.config ?? null
        if (!defaultConfig) {
          const legacy = takeLegacy(specRef.current.legacyKey, projectId)
          if (legacy !== undefined) {
            const options = specRef.current.normalize(legacy) as Record<string, unknown>
            const saved = await window.ostlerAPI
              .setDefaultSavedView(projectId, viewType, {
                filter: EMPTY_TASK_FILTER,
                query: '',
                options
              })
              .then(unwrapResult)
            defaultConfig = saved.config
          }
        }
        if (cancelled) return
        setState((previous) =>
          previous.owner !== owner
            ? previous
            : {
                ...previous,
                loaded: true,
                views: all.filter((view) => view.viewType === viewType && !view.isDefault),
                sharedViews: shared.views,
                defaultConfig,
                sharedDefault: shared.defaultConfig,
                activeId: null,
                // A change made while loading wins over what was stored.
                working: previous.touched
                  ? previous.working
                  : fromConfig(
                      defaultConfig ?? shared.defaultConfig ?? undefined,
                      specRef.current.normalize
                    )
              }
        )
      } catch (error) {
        console.error('Could not load saved views:', error)
        if (!cancelled)
          setState((previous) =>
            previous.owner !== owner ? previous : { ...previous, loaded: true }
          )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [owner, projectId, viewType])

  const allViews = [...current.views, ...current.sharedViews]

  // Open a view named in the address (the command palette's "Open view").
  useEffect(() => {
    if (!requested || !current.loaded) return
    const view = [...current.views, ...current.sharedViews].find(
      (candidate) => candidate.id === requested
    )
    if (view)
      setState((previous) => ({
        ...previous,
        activeId: view.id,
        working: fromConfig(view.config, specRef.current.normalize)
      }))
    const next = new URLSearchParams(params)
    next.delete('view')
    setParams(next, { replace: true })
  }, [requested, current.loaded, current.views, current.sharedViews, params, setParams])

  // Open with a filter named in the address (a live list's "and 12 more",
  // N4.4c): its filter and search, read as untrusted input, on top of the
  // default view's options. The default view keeps them, as if typed.
  const requestedFilter = params.get('filter')
  useEffect(() => {
    if (requestedFilter === null || !current.loaded) return
    let filter: TaskFilter | null = null
    try {
      filter = parseTaskFilter(JSON.parse(requestedFilter))
    } catch {
      filter = null
    }
    const query = (params.get('q') ?? '').slice(0, 200)
    if (filter) {
      const chosen = filter
      change((working) => ({ ...working, filter: chosen, query, hideDone: false }))
      setState((previous) => ({ ...previous, activeId: null }))
    }
    const next = new URLSearchParams(params)
    next.delete('filter')
    next.delete('q')
    setParams(next, { replace: true })
  }, [requestedFilter, current.loaded, params, setParams])

  // The default view keeps its state as it changes, written at once: a
  // write is one row, and nothing is lost when the window closes.
  const persistDefault = (working: Working<O>) => {
    const config = toConfig(working, false)
    const text = JSON.stringify(config)
    if (text === lastWritten.current) return
    lastWritten.current = text
    void window.ostlerAPI
      .setDefaultSavedView(projectId, viewType, config)
      .then(unwrapResult)
      .catch((error) => console.error('Could not keep the view settings:', error))
  }

  const change = (patch: (working: Working<O>) => Working<O>, persist = true) =>
    setState((previous) => {
      if (previous.owner !== owner) return previous
      const working = patch(previous.working)
      if (persist && previous.loaded && previous.activeId === null) {
        persistDefault(working)
        return { ...previous, touched: true, working, defaultConfig: toConfig(working, false) }
      }
      return { ...previous, touched: true, working }
    })

  const { working } = current
  const activeView = allViews.find((view) => view.id === current.activeId) ?? null
  /** What the default view shows: the project's own, else all projects', else the standard. */
  const effectiveDefault = (from: typeof state) =>
    fromConfig(from.defaultConfig ?? from.sharedDefault ?? undefined, specRef.current.normalize)
  // Compared as this view reads them, so options it fills in are not a change.
  const isChanged =
    activeView !== null &&
    !same(
      toConfig(working, true),
      toConfig(fromConfig(activeView.config, specRef.current.normalize), true)
    )

  const replaceView = (view: SavedView) =>
    setState((previous) => {
      const key = view.projectId === null ? 'sharedViews' : 'views'
      const list = previous[key]
      return {
        ...previous,
        [key]: list.some((candidate) => candidate.id === view.id)
          ? list.map((candidate) => (candidate.id === view.id ? view : candidate))
          : [...list, view].sort((a, b) => a.position - b.position)
      }
    })

  return {
    filter: working.filter,
    setFilter: (filter) => change((value) => ({ ...value, filter })),
    query: working.query,
    // The search box is not kept in the default view; it is in a saved one.
    setQuery: (query) => change((value) => ({ ...value, query }), false),
    hideDone: working.hideDone,
    setHideDone: (hideDone) => change((value) => ({ ...value, hideDone })),
    isFiltered: working.query.trim() !== '' || working.filter.conditions.length > 0,
    clear: () => change((value) => ({ ...value, query: '', filter: EMPTY_TASK_FILTER })),
    options: working.options,
    setOptions: (patch) =>
      change((value) => ({ ...value, options: { ...value.options, ...patch } })),
    views: allViews,
    activeView,
    isChanged,
    loaded: current.loaded,
    selectView: (viewId) => {
      setState((previous) => {
        const view = [...previous.views, ...previous.sharedViews].find(
          (candidate) => candidate.id === viewId
        )
        return view
          ? {
              ...previous,
              activeId: view.id,
              working: fromConfig(view.config, specRef.current.normalize)
            }
          : { ...previous, activeId: null, working: effectiveDefault(previous) }
      })
    },
    saveAs: async (name, scope = 'project') => {
      const view = unwrapResult(
        await window.ostlerAPI.createSavedView(scope === 'allProjects' ? null : projectId, {
          name,
          viewType,
          config: toConfig(working, true)
        })
      )
      replaceView(view)
      setState((previous) => ({ ...previous, activeId: view.id }))
    },
    updateActive: async () => {
      if (!activeView) return
      replaceView(
        unwrapResult(
          await window.ostlerAPI.updateSavedView(activeView.id, { config: toConfig(working, true) })
        )
      )
    },
    revert: () =>
      setState((previous) => {
        const view = [...previous.views, ...previous.sharedViews].find(
          (candidate) => candidate.id === previous.activeId
        )
        return view
          ? { ...previous, working: fromConfig(view.config, specRef.current.normalize) }
          : previous
      }),
    rename: async (viewId, name) => {
      replaceView(unwrapResult(await window.ostlerAPI.updateSavedView(viewId, { name })))
    },
    remove: async (viewId) => {
      const deleted = unwrapResult(await window.ostlerAPI.deleteSavedView(viewId))
      setState((previous) => ({
        ...previous,
        views: previous.views.filter((view) => view.id !== viewId),
        sharedViews: previous.sharedViews.filter((view) => view.id !== viewId),
        activeId: previous.activeId === viewId ? null : previous.activeId,
        working: previous.activeId === viewId ? effectiveDefault(previous) : previous.working
      }))
      toastUndo(t('tasks:useTaskFilters.deletedView', { deletedName: deleted.name }), async () => {
        replaceView(unwrapResult(await window.ostlerAPI.restoreSavedView(deleted)))
      })
    },
    setAsDefault: async () => {
      // The default view's one rule: no search text, and the last write noted
      // so a later change back to an earlier state is still written.
      const config = toConfig(working, false)
      lastWritten.current = JSON.stringify(config)
      const saved = unwrapResult(
        await window.ostlerAPI.setDefaultSavedView(projectId, viewType, config)
      )
      setState((previous) => ({ ...previous, defaultConfig: saved.config }))
    },
    defaultSource:
      current.defaultConfig !== null
        ? 'project'
        : current.sharedDefault !== null
          ? 'allProjects'
          : 'standard',
    hasAllProjectsDefault: current.sharedDefault !== null,
    resetDefault: async () => {
      unwrapResult(await window.ostlerAPI.clearDefaultSavedView(projectId, viewType))
      lastWritten.current = null
      setState((previous) => {
        const next = { ...previous, defaultConfig: null }
        return previous.activeId === null ? { ...next, working: effectiveDefault(next) } : next
      })
    },
    setAsAllProjectsDefault: async () => {
      const saved = unwrapResult(
        await window.ostlerAPI.setDefaultSavedView(null, viewType, toConfig(working, false))
      )
      setState((previous) => ({ ...previous, sharedDefault: saved.config }))
    },
    resetAllProjectsDefault: async () => {
      unwrapResult(await window.ostlerAPI.clearDefaultSavedView(null, viewType))
      setState((previous) => {
        const next = { ...previous, sharedDefault: null }
        return previous.activeId === null && previous.defaultConfig === null
          ? { ...next, working: effectiveDefault(next) }
          : next
      })
    }
  }
}

/**
 * The views for all projects of one type, and their default. Read apart from
 * the project's own, so a store without them (an older test double, a failed
 * read) still opens the project's views.
 */
async function loadShared(
  viewType: SavedViewType
): Promise<{ views: SavedView[]; defaultConfig: SavedViewConfig | null }> {
  try {
    const [views, defaultView] = await Promise.all([
      window.ostlerAPI.listSharedSavedViews(viewType).then(unwrapResult),
      window.ostlerAPI.getDefaultSavedView(null, viewType).then(unwrapResult)
    ])
    return { views, defaultConfig: defaultView?.config ?? null }
  } catch {
    return { views: [], defaultConfig: null }
  }
}

/** What a view's tasks are filtered with: the view's records, as `matchesFilter` needs them. */
export interface TaskFilterSources {
  projectedStatus: (item: PlanningWorkItem) => PlanningWorkItemStatus
  goalIdForItem: (item: PlanningWorkItem) => string | null
  commentCounts?: Record<string, number>
  /** The contacts each task names (N6.5), for the Contact filter. */
  taskContacts?: TaskContactMarks
  meId: string | null
  /** The project's current iteration (R6.1), or null. */
  currentIterationId?: string | null
  /**
   * The sub-project a scoped view shows (a workstream's view). The scope is
   * applied before the view's own filter, and not a chip the person can remove.
   */
  subprojectId?: string | null
}

export function taskFilterContext(sources: TaskFilterSources): TaskFilterContext {
  return {
    today: todayIsoDate(),
    meId: sources.meId,
    projectedStatus: (task) => sources.projectedStatus(task as PlanningWorkItem),
    goalIdForTask: (task) => sources.goalIdForItem(task as PlanningWorkItem),
    commentCount: (task) => sources.commentCounts?.[task.id] ?? 0,
    contactsOf: (task) => sources.taskContacts?.[task.id] ?? [],
    currentIterationId: sources.currentIterationId ?? null
  }
}

/**
 * The tasks in a sub-project: the scope of a workstream's view, applied before the view's
 * own filter (so an "any" filter cannot let other work in), by the one `matchesFilter`.
 */
export function inSubproject<T extends PlanningWorkItem>(
  items: readonly T[],
  subprojectId: string,
  context: TaskFilterContext
): T[] {
  const scope: TaskFilter = {
    match: 'all',
    conditions: [{ field: 'subproject', op: 'is', value: [subprojectId] }]
  }
  return items.filter((item) => matchesFilter(item, scope, context))
}

/**
 * The tasks a view shows: its filter, its search text and Hide done, all
 * through the one `matchesFilter`, so every view and the automation API agree
 * on what a filter means.
 */
export function applyTaskFilters(
  items: readonly PlanningWorkItem[],
  view: Pick<TaskView<object>, 'filter' | 'query' | 'hideDone'>,
  sources: TaskFilterSources
): PlanningWorkItem[] {
  const context = taskFilterContext(sources)
  return matchingTasks(
    sources.subprojectId ? inSubproject(items, sources.subprojectId, context) : items,
    effectiveFilter(view.filter),
    view.query,
    context,
    view.hideDone
  )
}
