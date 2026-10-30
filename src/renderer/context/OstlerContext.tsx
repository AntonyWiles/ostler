import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode
} from 'react'
import type { EstimateUnit, RendererProject, WatchEvent, WatcherStatus } from '@shared/ostler-api'
import { t } from '@shared/i18n'
import type { ProjectArea } from '@shared/project-areas'

interface OstlerContextValue {
  projects: RendererProject[]
  /** The areas (N5.1) in their order; group projects with `groupProjectsByArea`. */
  areas: ProjectArea[]
  recentEvents: WatchEvent[]
  watcherStatus: WatcherStatus | null
  loading: boolean
  error: string | null
  refreshProjects: () => Promise<void>
  getProjectById: (id: string) => RendererProject | undefined
}

const OstlerContext = createContext<OstlerContextValue | undefined>(undefined)

export function OstlerProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<RendererProject[]>([])
  const [areas, setAreas] = useState<ProjectArea[]>([])
  const [recentEvents, setRecentEvents] = useState<WatchEvent[]>([])
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const hasLoadedOnce = useRef(false)

  /**
   * Reads the project list. Only the very first load shows the loading state:
   * toggling it on a background refresh made the whole project view flash to
   * a bare "Loading..." screen.
   */
  const refreshProjects = useCallback(async () => {
    if (!hasLoadedOnce.current) setLoading(true)
    try {
      // Areas change with the project list (the same push), so they load together.
      const [res, areasRes] = await Promise.all([
        window.ostlerAPI.getProjects(),
        window.ostlerAPI.getAreas()
      ])
      if (areasRes.ok && Array.isArray(areasRes.value)) setAreas(areasRes.value)
      if (res.ok) {
        // Settings obtains the full configuration separately so disabled
        // projects remain manageable there, but every operational surface
        // receives active projects only.
        setProjects(res.value.filter((project) => project.enabled))
        setError(null)
      } else {
        setError(res.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common:ostlerContext.unknownError'))
    } finally {
      hasLoadedOnce.current = true
      setLoading(false)
    }
  }, [])

  const refreshWatcherStatus = useCallback(async () => {
    const statusRes = await window.ostlerAPI.getWatcherStatus()
    if (statusRes.ok) setWatcherStatus(statusRes.value)
  }, [])

  const getProjectById = useCallback(
    (id: string) => {
      return projects.find((p) => p.id === id)
    },
    [projects]
  )

  useEffect(() => {
    void refreshProjects().then(() => refreshWatcherStatus())

    const cleanupWatchEvent = window.ostlerAPI.onWatchEvent((event) => {
      setRecentEvents((prev) => [event, ...prev].slice(0, 100))
    })

    // Main pushes 'projects' for every change to the project list or a
    // project's config, and 'watcher' when the watcher's status moves. Every
    // other push (a harness poll, say) has nothing for this context, and
    // re-reading on each of them was most of the app's idle IPC traffic.
    const cleanupProjectState = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'projects') void refreshProjects()
      else if (update.field === 'watcher') void refreshWatcherStatus()
    })

    const cleanupNotification = window.ostlerAPI.onNotification((notification) => {
      console.log('Notification:', notification)
    })

    return () => {
      cleanupWatchEvent()
      cleanupProjectState()
      cleanupNotification()
    }
  }, [refreshProjects, refreshWatcherStatus])

  return (
    <OstlerContext.Provider
      value={{
        projects,
        areas,
        recentEvents,
        watcherStatus,
        loading,
        error,
        refreshProjects,
        getProjectById
      }}
    >
      {children}
    </OstlerContext.Provider>
  )
}

export function useOstler() {
  const context = useContext(OstlerContext)
  if (context === undefined) {
    throw new Error('useOstler must be used within an OstlerProvider')
  }
  return context
}

/** The projects, or none outside an OstlerProvider (a component rendered on its own). */
export function useProjectList(): RendererProject[] {
  return useContext(OstlerContext)?.projects ?? []
}

/**
 * How a project counts estimates (D22): points unless it chose hours.
 * Outside an OstlerProvider (a component rendered on its own) it is points.
 */
export function useProjectEstimateUnit(projectId: string): EstimateUnit {
  const context = useContext(OstlerContext)
  return context?.getProjectById(projectId)?.estimateUnit ?? 'points'
}

/** The prefix of the project's task IDs (N9.8a), or null. Tolerates no provider, like the estimate unit. */
export function useProjectTaskPrefix(projectId: string): string | null {
  const context = useContext(OstlerContext)
  return context?.getProjectById(projectId)?.taskPrefix ?? null
}

/** The project's GitHub repository (`owner/repo`), or '' (R4.4). Tolerates no provider, like the estimate unit. */
export function useProjectGithubRepository(projectId: string): string {
  const context = useContext(OstlerContext)
  return context?.getProjectById(projectId)?.githubRepository ?? ''
}

/** The areas (N5.1); none outside an OstlerProvider. */
export function useAreas(): ProjectArea[] {
  return useContext(OstlerContext)?.areas ?? []
}
