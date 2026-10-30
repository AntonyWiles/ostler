import { useCallback, useEffect, useState } from 'react'
import type { UpdateState } from '@shared/ostler-api'

/**
 * Where updating stands (P10.1), kept current from main's pushes. Null until
 * the first answer. `run` sends one of the update calls and takes its state.
 */
export function useUpdateState(): {
  state: UpdateState | null
  error: string | null
  run(call: Promise<{ ok: true; value: UpdateState } | { ok: false; error: string }>): Promise<void>
} {
  const [state, setState] = useState<UpdateState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.ostlerAPI.getUpdateState().then((result) => {
      if (cancelled) return
      if (result.ok) setState(result.value)
      else setError(result.error)
    })
    const unsubscribe = window.ostlerAPI.onUpdateState((next) => {
      setState(next)
      setError(null)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const run = useCallback(
    async (call: Promise<{ ok: true; value: UpdateState } | { ok: false; error: string }>) => {
      const result = await call
      if (result.ok) {
        setState(result.value)
        setError(null)
      } else setError(result.error)
    },
    []
  )

  return { state, error, run }
}
