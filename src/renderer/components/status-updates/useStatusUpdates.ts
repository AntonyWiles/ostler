import { useCallback, useEffect, useState } from 'react'
import type { StatusUpdate } from '@shared/ostler-api'
import { shownCache } from '../../lib/shown-cache'

/** Each project's updates as last shown: its Overview opens with them, not a placeholder. */
const shownUpdates = shownCache<StatusUpdate[]>()

/**
 * A project's status updates (N5.5), newest first, in one call. Reloads when
 * main says something changed (a post from the automation API reaches here
 * the same way as one from this window).
 */
export function useStatusUpdates(projectId: string): {
  updates: StatusUpdate[] | null
  error: string | null
  reload: () => Promise<void>
} {
  const [updates, setUpdates] = useState<StatusUpdate[] | null>(
    () => shownUpdates.get(projectId) ?? null
  )
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const result = await window.ostlerAPI.listStatusUpdates(projectId)
    if (result.ok) {
      shownUpdates.set(projectId, result.value)
      setUpdates(result.value)
      setError(null)
    } else setError(result.error)
  }, [projectId])

  useEffect(() => {
    setUpdates(shownUpdates.get(projectId) ?? null)
    void reload()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'home') void reload()
    })
  }, [projectId, reload])

  return { updates, error, reload }
}

/** Each project's latest update, by project id, in one call (Home's cards and board). */
export function useLatestStatusUpdates(): Record<string, StatusUpdate> {
  const [latest, setLatest] = useState<Record<string, StatusUpdate>>({})
  useEffect(() => {
    let active = true
    const load = async () => {
      const result = await window.ostlerAPI.latestStatusUpdates()
      if (active && result.ok) setLatest(result.value)
    }
    void load()
    const unsubscribe = window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'home') void load()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  return latest
}
