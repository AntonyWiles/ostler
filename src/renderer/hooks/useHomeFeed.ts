import { useCallback, useEffect, useRef, useState } from 'react'
import type { Result } from '@shared/ostler-api'
import { shownCache } from '../lib/shown-cache'

/** What each remembered feed read last, by its name and deps. */
const shownFeeds = shownCache<unknown>(32)

/**
 * Reads something Home or the Inbox shows, and reads it again whenever main
 * pushes `home` (P5.6): a task written anywhere, a reminder fired, an agent
 * asking, a project enabled or disabled. Null until the first read.
 *
 * A feed of a page that opens and closes is `shownAs` a name: opening the page
 * again shows what it read last at once, then reads again, instead of
 * building the page up piece by piece each time it opens.
 */
export function useHomeFeed<T>(
  load: () => Promise<Result<T>>,
  deps: unknown[] = [],
  shownAs?: string
) {
  const key = shownAs === undefined ? null : `${shownAs}:${JSON.stringify(deps)}`
  const [value, setValue] = useState<T | null>(() =>
    key === null ? null : ((shownFeeds.get(key) as T | undefined) ?? null)
  )
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(load)
  latest.current = load
  const latestKey = useRef(key)
  latestKey.current = key

  const reload = useCallback(async () => {
    const result = await latest.current()
    if (result.ok) {
      if (latestKey.current !== null) shownFeeds.set(latestKey.current, result.value)
      setValue(result.value)
      setError(null)
    } else setError(result.error)
  }, [])

  useEffect(() => {
    void reload()
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (update.field === 'home') void reload()
    })
  }, [reload, ...deps])

  return { value, setValue, error, reload }
}
