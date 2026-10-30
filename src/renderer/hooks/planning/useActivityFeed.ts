import { useCallback, useEffect, useRef, useState } from 'react'
import type { ActivityEntry, ActivityFilter, ProjectStateUpdate } from '@shared/ostler-api'
import { MAX_ACTIVITY_LIMIT } from '@shared/ostler-api'

/** Agent runs push harness state every poll; the feed re-reads at most this often for them. */
export const ACTIVITY_HARNESS_REFRESH_MS = 5_000

export interface ActivityFeed {
  entries: ActivityEntry[]
  /** True only until the first page arrives; later reloads keep the list on screen. */
  loading: boolean
  error: string | null
  hasMore: boolean
  loadingMore: boolean
  loadMore: () => Promise<void>
  reload: () => Promise<void>
}

/**
 * A task's activity (`workItemId`) or the project's (`workItemId` null),
 * newest first, a page at a time (P5.2). It re-reads what is shown when the
 * project's planning records change, and when an agent run moves on.
 */
export function useActivityFeed({
  projectId,
  workItemId,
  filter = 'all',
  pageSize
}: {
  projectId: string
  workItemId: string | null
  filter?: ActivityFilter
  pageSize: number
}): ActivityFeed {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // How many entries are shown, so a reload keeps the pages already opened.
  const shown = useRef(pageSize)
  const epoch = useRef(0)

  const read = useCallback(
    (limit: number, before?: string) =>
      workItemId
        ? window.ostlerAPI.getPlanningActivity(projectId, workItemId, { limit, before, filter })
        : window.ostlerAPI.getPlanningProjectActivity(projectId, { limit, before }),
    [projectId, workItemId, filter]
  )

  const reload = useCallback(async () => {
    const current = ++epoch.current
    const result = await read(Math.min(Math.max(shown.current, pageSize), MAX_ACTIVITY_LIMIT))
    if (current !== epoch.current) return
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    setEntries(result.value.entries)
    setNextBefore(result.value.nextBefore)
  }, [read, pageSize])

  const loadMore = useCallback(async () => {
    if (!nextBefore) return
    const current = epoch.current
    setLoadingMore(true)
    const result = await read(pageSize, nextBefore)
    setLoadingMore(false)
    if (current !== epoch.current) return
    if (!result.ok) {
      setError(result.error)
      return
    }
    setEntries((previous) => {
      const next = [...previous, ...result.value.entries]
      shown.current = next.length
      return next
    })
    setNextBefore(result.value.nextBefore)
  }, [read, pageSize, nextBefore])

  // A new task, project or filter starts from its first page.
  useEffect(() => {
    shown.current = pageSize
    setEntries([])
    setNextBefore(null)
    setLoading(true)
    void reload()
  }, [reload, pageSize])

  const reloadRef = useRef(reload)
  reloadRef.current = reload
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastHarnessReload = 0
    const schedule = (delay: number) => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        void reloadRef.current()
      }, delay)
    }
    const unsubscribe = window.ostlerAPI.onProjectStateChange((update: ProjectStateUpdate) => {
      if (update.projectId !== projectId) return
      if (update.field === 'planning' || update.field === 'taskReview') schedule(100)
      else if (update.field === 'harness') {
        const now = Date.now()
        if (now - lastHarnessReload < ACTIVITY_HARNESS_REFRESH_MS) return
        lastHarnessReload = now
        schedule(100)
      }
    })
    return () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [projectId])

  return {
    entries,
    loading,
    error,
    hasMore: nextBefore !== null,
    loadingMore,
    loadMore,
    reload
  }
}
