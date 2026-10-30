import { useCallback, useEffect, useState } from 'react'
import type { PersonalSpaceState } from '@shared/ostler-api'

/**
 * The personal space as Settings › Devices and the welcome show it. There is no change event for
 * it, so it is read again every `intervalMs` while `enabled` (the sync runs in main either way).
 */
export function usePersonalSpace({
  enabled,
  intervalMs
}: {
  enabled: boolean
  intervalMs: number
}) {
  const [state, setState] = useState<PersonalSpaceState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await window.ostlerAPI.getPersonalSpace()
    if (result.ok) {
      setState(result.value)
      setError(null)
    } else {
      setError(result.error)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    const timer = setInterval(() => void refresh(), intervalMs)
    return () => clearInterval(timer)
  }, [enabled, intervalMs, refresh])

  return { state, setState, error, setError, refresh }
}
