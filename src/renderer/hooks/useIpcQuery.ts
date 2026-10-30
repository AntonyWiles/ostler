import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import type { ProjectStateUpdate, Result } from '@shared/ostler-api'

export interface IpcQueryOptions {
  /** Read again when main pushes a change to one of these fields. */
  fields?: readonly ProjectStateUpdate['field'][]
  /** Only a push for this project reads again (a push for no project always does). */
  projectId?: string | null
  /** False: nothing is read, and `value` stays undefined. */
  enabled?: boolean
}

export interface IpcQuery<T> {
  /** The last value read, or undefined before the first read lands. */
  value: T | undefined
  /** True once a read has landed, whether or not it succeeded. */
  loaded: boolean
  /** The last read's error, or null. */
  error: string | null
  /** Reads again now. */
  reload: () => void
  /** Puts a value in place at once, e.g. what a write returned. */
  setValue: (value: T) => void
}

/**
 * Fetch, then fetch again on change: reads `fetcher` when `deps` change and
 * again whenever main pushes a change to one of `fields`. A read that lands
 * after a newer one started, or after unmount, is dropped.
 */
export function useIpcQuery<T>(
  fetcher: () => Promise<Result<T>>,
  deps: DependencyList,
  options: IpcQueryOptions = {}
): IpcQuery<T> {
  const { fields, projectId, enabled = true } = options
  const [state, setState] = useState<{
    value: T | undefined
    loaded: boolean
    error: string | null
  }>({ value: undefined, loaded: false, error: null })
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    if (!enabled) return
    let live = true
    void Promise.resolve()
      .then(() => fetcherRef.current())
      .then(
        (result) => {
          if (!live) return
          setState((prev) =>
            result.ok
              ? { value: result.value, loaded: true, error: null }
              : { value: prev.value, loaded: true, error: result.error }
          )
        },
        (err: unknown) => {
          if (!live) return
          setState((prev) => ({
            value: prev.value,
            loaded: true,
            error: err instanceof Error ? err.message : String(err)
          }))
        }
      )
    return () => {
      live = false
    }
  }, [...deps, enabled, version])

  const fieldKey = fields?.join('\n') ?? ''
  useEffect(() => {
    if (!enabled || !fieldKey) return
    if (typeof window.ostlerAPI?.onProjectStateChange !== 'function') return
    const watched = new Set(fieldKey.split('\n'))
    return window.ostlerAPI.onProjectStateChange((update) => {
      if (!watched.has(update.field)) return
      if (projectId && update.projectId && update.projectId !== projectId) return
      reload()
    })
  }, [enabled, fieldKey, projectId, reload])

  const setValue = useCallback((value: T) => setState({ value, loaded: true, error: null }), [])
  return { ...state, value: enabled ? state.value : undefined, reload, setValue }
}
