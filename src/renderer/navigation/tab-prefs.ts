import { useEffect, useState } from 'react'
import { isProjectViewId, type ProjectViewId } from './registry'

/**
 * The project views the viewer pinned (always a tab) or unpinned (always in
 * More). Saved once for all projects; a project may keep its own choice, which
 * replaces the all-projects one. A per-viewer convenience in localStorage, like
 * last-view.ts: when storage is unavailable the registry's own placement applies.
 */
export interface TabPrefs {
  pinned: ProjectViewId[]
  unpinned: ProjectViewId[]
}

const GLOBAL_KEY = 'ostler.tabPrefs'
const projectKey = (projectId: string) => `ostler.tabPrefs.${projectId}`

/** The event every write and clear dispatches, so `useTabPrefs` re-reads. */
const CHANGED = 'ostler:tab-prefs'

/** Only ids that are still project views: a view removed later is dropped. */
function viewIds(value: unknown): ProjectViewId[] {
  return Array.isArray(value)
    ? value.filter((id): id is ProjectViewId => typeof id === 'string' && isProjectViewId(id))
    : []
}

function readPrefs(key: string): TabPrefs | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (typeof stored !== 'object' || stored === null) return null
    const { pinned, unpinned } = stored as { pinned?: unknown; unpinned?: unknown }
    return { pinned: viewIds(pinned), unpinned: viewIds(unpinned) }
  } catch {
    return null
  }
}

/** The all-projects choice, or null when none is saved. */
export function readGlobalTabPrefs(): TabPrefs | null {
  return readPrefs(GLOBAL_KEY)
}

/** The choice saved for one project, or null when it follows all projects. */
export function readProjectTabPrefs(projectId: string): TabPrefs | null {
  return readPrefs(projectKey(projectId))
}

/** The project's own choice if it has one, else the all-projects choice. */
export function effectiveTabPrefs(projectId?: string): TabPrefs | null {
  const own = projectId === undefined ? null : readProjectTabPrefs(projectId)
  return own ?? readGlobalTabPrefs()
}

export function writeTabPrefs(scope: 'global' | { projectId: string }, prefs: TabPrefs): void {
  const key = scope === 'global' ? GLOBAL_KEY : projectKey(scope.projectId)
  try {
    localStorage.setItem(key, JSON.stringify(prefs))
  } catch {
    // ignore -- see readPrefs
  }
  window.dispatchEvent(new Event(CHANGED))
}

/** Removes the project's own choice, so it follows all projects again. */
export function clearProjectTabPrefs(projectId: string): void {
  try {
    localStorage.removeItem(projectKey(projectId))
  } catch {
    // ignore -- see readPrefs
  }
  window.dispatchEvent(new Event(CHANGED))
}

/** `effectiveTabPrefs` for a project, re-read whenever the prefs change. */
export function useTabPrefs(projectId?: string): TabPrefs | null {
  const [prefs, setPrefs] = useState(() => effectiveTabPrefs(projectId))
  useEffect(() => {
    const refresh = () => setPrefs(effectiveTabPrefs(projectId))
    refresh()
    window.addEventListener(CHANGED, refresh)
    return () => window.removeEventListener(CHANGED, refresh)
  }, [projectId])
  return prefs
}
