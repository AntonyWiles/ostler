import { isProjectViewId, type ProjectViewId } from './registry'

/**
 * The view each project was last opened on, so a project reopens where it
 * was left. A per-viewer convenience in localStorage, not data: when storage
 * is unavailable a project simply opens on Overview.
 */
const key = (projectId: string) => `ostler.lastView.${projectId}`

export function readLastView(projectId: string): ProjectViewId | null {
  try {
    const stored = localStorage.getItem(key(projectId))
    return isProjectViewId(stored) ? stored : null
  } catch {
    return null
  }
}

export function writeLastView(projectId: string, view: ProjectViewId): void {
  try {
    localStorage.setItem(key(projectId), view)
  } catch {
    // ignore -- see readLastView
  }
}

const LAST_PROJECT_KEY = 'ostler.lastProject'

/** The project open most recently, for "When Ostler starts: the last project". */
export function readLastProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY)
  } catch {
    return null
  }
}

export function writeLastProject(projectId: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, projectId)
    const recent = [projectId, ...readRecentProjects().filter((id) => id !== projectId)]
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(recent.slice(0, MAX_RECENT_PROJECTS)))
  } catch {
    // ignore -- see readLastView
  }
}

const RECENT_PROJECTS_KEY = 'ostler.recentProjects'
const MAX_RECENT_PROJECTS = 10

/** The projects opened most recently, most recent first: the jump list's Recent projects (P8.2). */
export function readRecentProjects(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) ?? '[]')
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT_PROJECTS)
      : []
  } catch {
    return []
  }
}
